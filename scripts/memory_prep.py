#!/usr/bin/env python3
"""
memory_prep - deterministic pre/post pass for the memory-flush skill.

memory-flush used to make the model do bookkeeping every run: parse the scan
window off a prose line, list in-window logs, and rotate memory/logs/ once it
grew past ~45 files. That is pure code, and doing it in the LLM made it costly
(7 instances, weekly) and unreliable (the window silently fell back to 3 days
whenever the prose watermark was edited away, losing un-promoted entries).

This module owns that mechanical work so the model is left with only the
judgment: what to promote, dedup, and prune.

Watermark source of truth is memory/memory-flush-state.json (structured,
skill-owned) - NOT memory/cron-state.json, whose schema is a fixed shape folded
by state_reduce.py that would drop an extra field under the Issues backend. The
memory/MEMORY.md "*Last consolidated: <date>*" line is kept as a human mirror.

Subcommands:
  window   pre-pass: rotate old logs, then print the scan window + the exact
           list of in-window log files to stdout for the model to read.
  stamp    post-pass: write today's date to the watermark file and mirror it
           into the MEMORY.md prose line.

The date planners are kept pure (no clock, no I/O) so they are unit-testable;
the today's-date reads and file writes live in the thin I/O wrappers.
"""
import datetime
import json
import os
import re
import subprocess
import sys

LOGS_DIR = "memory/logs"
ARCHIVE_DIR = "memory/logs/archive"
STATE_FILE = "memory/memory-flush-state.json"
MEMORY_MD = "memory/MEMORY.md"

ROTATE_THRESHOLD = 45   # only rotate once logs/ grows past this many dailies
SCAN_CLAMP_DAYS = 14    # a gap longer than this clamps the scan window
DEFAULT_LOOKBACK_DAYS = 3  # no watermark at all -> read the last 3 days

_DAILY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})\.md$")
_CONSOLIDATED_RE = re.compile(r"^\*Last consolidated:.*\*\s*$", re.IGNORECASE | re.MULTILINE)


# ---------------------------------------------------------------------------
# pure planners (unit-tested)
# ---------------------------------------------------------------------------

def parse_date(s):
    """'2026-08-16' -> date, or None if unparseable/blank/'never'."""
    if not s:
        return None
    s = s.strip()
    if s.lower() == "never":
        return None
    try:
        return datetime.date.fromisoformat(s)
    except ValueError:
        return None


def watermark_from_memory_md(text):
    """Recover the last-consolidated date from the MEMORY.md prose line."""
    if not text:
        return None
    m = _CONSOLIDATED_RE.search(text)
    if not m:
        return None
    inner = m.group(0).split(":", 1)[1]  # after 'Last consolidated:'
    return parse_date(inner.strip().strip("*").strip())


def resolve_watermark(state_json, memory_md):
    """
    Decide the last-consolidated date and where it came from.
    Prefer the structured state file; fall back to the MEMORY.md prose line
    (first-run migration); else None. Returns (date_or_None, source_str).
    """
    if state_json:
        try:
            d = parse_date(json.loads(state_json).get("last_consolidated"))
            if d:
                return d, "state-file"
        except (ValueError, AttributeError):
            pass
    d = watermark_from_memory_md(memory_md)
    if d:
        return d, "memory.md"
    return None, "none"


def compute_window(last_consolidated, today):
    """
    (start_date, clamped_bool) for the log scan.
      - no watermark          -> last DEFAULT_LOOKBACK_DAYS
      - gap > SCAN_CLAMP_DAYS  -> clamp to last SCAN_CLAMP_DAYS (agent was dark)
      - otherwise              -> from the watermark day (re-reading it is
                                  idempotent thanks to the skill's dedup step)
    """
    if last_consolidated is None:
        return today - datetime.timedelta(days=DEFAULT_LOOKBACK_DAYS), False
    gap = (today - last_consolidated).days
    if gap > SCAN_CLAMP_DAYS:
        return today - datetime.timedelta(days=SCAN_CLAMP_DAYS), True
    return last_consolidated, False


def parse_daily(fname):
    """'2026-08-16.md' -> date, or None if it is not a daily log filename."""
    m = _DAILY_RE.match(fname)
    if not m:
        return None
    try:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def select_logs(filenames, start_date, today):
    """In-window daily log filenames (start_date <= d <= today), date-sorted."""
    dated = [(parse_daily(f), f) for f in filenames]
    keep = [(d, f) for d, f in dated if d is not None and start_date <= d <= today]
    return [f for _, f in sorted(keep)]


def rotatable_months(filenames, today, threshold=ROTATE_THRESHOLD):
    """
    {YYYY-MM: [date-sorted filenames]} for whole months to roll into the
    archive. Only fires past the threshold, and only for months whose every
    daily is older than the 14-day scan floor (so nothing still in scope is
    touched). A month straddling the floor is left alone.
    """
    dailies = [(parse_daily(f), f) for f in filenames]
    dailies = [(d, f) for d, f in dailies if d is not None]
    if len(dailies) <= threshold:
        return {}
    cutoff = today - datetime.timedelta(days=SCAN_CLAMP_DAYS)
    by_month = {}
    for d, f in dailies:
        by_month.setdefault("%04d-%02d" % (d.year, d.month), []).append((d, f))
    out = {}
    for ym, items in by_month.items():
        if all(d < cutoff for d, _ in items):
            out[ym] = [f for _, f in sorted(items)]
    return out


def stamp_memory_md(text, today):
    """
    Return MEMORY.md text with the '*Last consolidated: <date>*' line set to
    today. Update in place if present, else insert under the first H1 title.
    """
    line = "*Last consolidated: %s*" % today.isoformat()
    if _CONSOLIDATED_RE.search(text):
        return _CONSOLIDATED_RE.sub(line, text, count=1)
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        if ln.startswith("# "):
            lines.insert(i + 1, "")
            lines.insert(i + 2, line)
            return "\n".join(lines)
    # no title -> prepend
    return line + "\n\n" + text


# ---------------------------------------------------------------------------
# thin I/O wrappers
# ---------------------------------------------------------------------------

def _read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except FileNotFoundError:
        return None


def _git_rm(root, relpaths):
    """git rm the given repo-relative paths (best-effort; rm is not granted)."""
    if not relpaths:
        return
    subprocess.run(["git", "-C", root, "rm", "--quiet", "--"] + relpaths, check=False)


def do_window(root, today):
    logs_dir = os.path.join(root, LOGS_DIR)
    try:
        entries = os.listdir(logs_dir)
    except FileNotFoundError:
        entries = []

    state_json = _read(os.path.join(root, STATE_FILE))
    memory_md = _read(os.path.join(root, MEMORY_MD))
    last, source = resolve_watermark(state_json, memory_md)
    start, clamped = compute_window(last, today)

    # rotate before selecting so the archive never overlaps the window
    rotated = rotatable_months(entries, today)
    archived_months = 0
    if rotated:
        archive_dir = os.path.join(root, ARCHIVE_DIR)
        os.makedirs(archive_dir, exist_ok=True)
        for ym, files in sorted(rotated.items()):
            chunks = []
            for f in files:
                body = _read(os.path.join(logs_dir, f))
                if body is not None:
                    chunks.append("<!-- %s -->\n%s" % (f, body.rstrip()))
            with open(os.path.join(archive_dir, ym + ".md"), "a", encoding="utf-8") as out:
                out.write("\n\n".join(chunks) + "\n")
            _git_rm(root, [os.path.join(LOGS_DIR, f) for f in files])
            archived_months += 1
        # drop rotated files from the in-memory listing before selecting
        rolled = {f for files in rotated.values() for f in files}
        entries = [e for e in entries if e not in rolled]

    in_window = select_logs(entries, start, today)

    out = []
    out.append("SCAN WINDOW for memory-flush")
    out.append("Watermark: %s (source: %s)" % (last.isoformat() if last else "none", source))
    out.append("Scan start: %s   Today: %s%s" % (
        start.isoformat(), today.isoformat(), "   [CLAMPED: >14d gap, older entries unrecoverable]" if clamped else ""))
    if in_window:
        out.append("Read these %d in-window log file(s):" % len(in_window))
        out.extend("  %s/%s" % (LOGS_DIR, f) for f in in_window)
    else:
        out.append("No in-window log files. If nothing to promote, log MEMORY_FLUSH_OK.")
    remaining = len([e for e in entries if parse_daily(e) is not None])
    out.append("Log rotation: archived %d month(s); %d daily file(s) remain (threshold %d)." % (
        archived_months, remaining, ROTATE_THRESHOLD))
    out.append("Do NOT recompute the window or rotate logs yourself. Run "
               "`python3 scripts/memory_prep.py stamp` as your final step.")
    print("\n".join(out))
    return 0


def do_stamp(root, today):
    # structured watermark = source of truth
    state_path = os.path.join(root, STATE_FILE)
    with open(state_path, "w", encoding="utf-8") as fh:
        json.dump({
            "last_consolidated": today.isoformat(),
            "updated_at": datetime.datetime.now(datetime.timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ"),
        }, fh, indent=2)
        fh.write("\n")

    # mirror into the human-readable MEMORY.md line
    memory_path = os.path.join(root, MEMORY_MD)
    text = _read(memory_path)
    if text is not None:
        with open(memory_path, "w", encoding="utf-8") as fh:
            fh.write(stamp_memory_md(text, today))

    print("Stamped last_consolidated=%s (%s + MEMORY.md mirror)." % (today.isoformat(), STATE_FILE))
    return 0


def main(argv):
    root = os.environ.get("AEON_REPO_ROOT", ".")
    if "--root" in argv:
        root = argv[argv.index("--root") + 1]
    today = datetime.date.today()
    cmd = argv[0] if argv else ""
    if cmd == "window":
        return do_window(root, today)
    if cmd == "stamp":
        return do_stamp(root, today)
    sys.stderr.write("usage: memory_prep.py {window|stamp} [--root DIR]\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
