#!/usr/bin/env python3
"""
notify_format — pure formatting/chunking core for ./notify.

No network, no env, no deps (stdlib only) so it is unit-testable in isolation.
`notify.sh` shells out to this to build per-channel payloads; the channel POSTs
stay in bash.

Channels & limits:
  - telegram : Markdown -> Telegram HTML (parse_mode=HTML), chunks <= 3900; base64 per line
  - discord  : embeds, description <= 4096; one JSON POST body per line
  - slack    : Block Kit, section text <= 3000; one JSON POST body (stdout)
  - buzz     : raw Markdown (Buzz renders it natively), chunks <= 15000; base64 per line

Two correctness properties this guarantees and the tests pin:
  1. No chunk exceeds its channel limit.
  2. No chunk ever ends inside an unbalanced ``` code fence — if a split lands
     mid-fence, the open fence is closed and reopened on the next chunk, so every
     chunk renders as valid Markdown on its own.

Telegram note: skills write ordinary Markdown (`**bold**`, `## headings`,
`- bullets`, `| tables |`). Telegram's legacy Markdown parse_mode supports none
of those and 400s on any unbalanced `*`/`_` (which silently drops the whole
message to raw-syntax plaintext). So the telegram() path normalizes Markdown to
Telegram's safe HTML subset (<b>/<i>/<code>/<pre>/<a>/<blockquote>) — deterministic
escaping means the output is always valid and never collapses to plaintext.
Skills should NOT hand-format for Telegram; just write clean Markdown.
"""
import argparse
import base64
import json
import re
import sys

SEVERITY = {
    "info":     {"emoji": "ℹ️",  "color": 0x3498DB},
    "success":  {"emoji": "✅",  "color": 0x2ECC71},
    "warn":     {"emoji": "⚠️",  "color": 0xF1C40F},
    "critical": {"emoji": "🚨",  "color": 0xE74C3C},
}
DEFAULT_SEVERITY = "info"


def _fence_count(s: str) -> int:
    """Number of ``` fence markers (line-leading) in s."""
    return sum(1 for ln in s.split("\n") if ln.lstrip().startswith("```"))


def _pack(parts, sep, limit):
    """Greedy-pack parts on `sep`, recursing paragraph -> line, hard-split last."""
    out, cur = [], ""
    for p in parts:
        glue = sep if cur else ""
        if len(cur) + len(glue) + len(p) <= limit:
            cur += glue + p
        else:
            if cur:
                out.append(cur)
                cur = ""
            if len(p) > limit and sep == "\n\n":
                out.extend(_pack(p.split("\n"), "\n", limit))
            elif len(p) > limit:
                while len(p) > limit:
                    out.append(p[:limit])
                    p = p[limit:]
                cur = p
            else:
                cur = p
    if cur:
        out.append(cur)
    return out


def _balance_fences(chunks):
    """Close a dangling ``` at a chunk end and reopen at the next chunk's start.

    Keeps each chunk individually valid Markdown. Reserves a little headroom so
    the added fence lines don't push a chunk back over the limit (the caller
    packs to limit-8 to leave room)."""
    out, carry_open = [], False
    for c in chunks:
        if carry_open:
            c = "```\n" + c
        opens = _fence_count(c) % 2 == 1
        if opens:
            c = c + "\n```"
            carry_open = True
        else:
            carry_open = False
        out.append(c)
    return out


def chunk(text: str, limit: int):
    """Split text into <=limit chunks on paragraph/line boundaries, fence-safe."""
    text = text.rstrip("\n")
    if not text:
        return []
    # leave headroom for the "\n```" / "```\n" a fence rebalance may add
    pack_limit = max(1, limit - 8)
    if len(text) <= pack_limit:
        raw = [text]
    else:
        raw = _pack(text.split("\n\n"), "\n\n", pack_limit)
    return _balance_fences(raw)


# ---- Markdown -> Telegram HTML normalizer ---------------------------------
# Telegram's HTML parse_mode supports a small tag set (<b> <i> <u> <s> <code>
# <pre> <a> <blockquote>); everything else must be escaped. We convert ordinary
# Markdown to that subset. It is deterministic and cannot 400 the way legacy
# Markdown does: we only ever emit balanced tags we generate, and every run of
# literal text is HTML-escaped, so the result is always valid Telegram HTML.

def _esc(s):
    """Escape literal text for Telegram HTML (only & < > are special)."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


_RE_CODE = re.compile(r"`([^`]+)`")
_RE_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_RE_BOLD = re.compile(r"\*\*(.+?)\*\*|__(.+?)__")
_RE_STRIKE = re.compile(r"~~(.+?)~~")
_RE_ITAL_STAR = re.compile(r"\*(?!\s)(.+?)(?<!\s)\*")
_RE_ITAL_UND = re.compile(r"(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)")
_RE_FENCE = re.compile(r"^\s*```(\w*)\s*$")
_RE_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")
_RE_HR = re.compile(r"^\s*([-*_])\1\1+\s*$")
_RE_QUOTE = re.compile(r"^\s*>\s?")
_RE_BULLET = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_RE_ORDERED = re.compile(r"^(\s*)(\d+)[.)]\s+(.*)$")
_RE_TABLE_SEP = re.compile(r"^\s*\|?[\s:\-|]+\|?\s*$")


def _inline(text):
    """Convert inline Markdown in one line/cell to Telegram HTML."""
    store = []

    def _stash(frag):
        store.append(frag)
        return "\x00%d\x00" % (len(store) - 1)

    # Protect code spans and links first — their contents must not be reprocessed.
    text = _RE_CODE.sub(lambda m: _stash("<code>%s</code>" % _esc(m.group(1))), text)
    text = _RE_LINK.sub(
        lambda m: _stash('<a href="%s">%s</a>' % (_esc(m.group(2)), _esc(m.group(1)))),
        text,
    )
    # Escape remaining literal text; emphasis markers (* _ ~) survive escaping.
    text = _esc(text)
    # Bold before italic so ** is never read as two single-* italics.
    text = _RE_BOLD.sub(lambda m: "<b>%s</b>" % (m.group(1) or m.group(2)), text)
    text = _RE_STRIKE.sub(lambda m: "<s>%s</s>" % m.group(1), text)
    text = _RE_ITAL_STAR.sub(lambda m: "<i>%s</i>" % m.group(1), text)
    text = _RE_ITAL_UND.sub(lambda m: "<i>%s</i>" % m.group(1), text)
    # Restore protected fragments (already valid HTML).
    text = re.sub(r"\x00(\d+)\x00", lambda m: store[int(m.group(1))], text)
    return text


def _split_row(row):
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [c.strip() for c in row.split("|")]


def md_to_telegram_html(text):
    """Convert a Markdown string to Telegram's safe HTML subset."""
    lines = text.split("\n")
    out, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]

        # Fenced code block -> <pre>. Content escaped, inline rules skipped.
        m = _RE_FENCE.match(line)
        if m:
            lang, code, i = m.group(1), [], i + 1
            while i < n and not _RE_FENCE.match(lines[i]):
                code.append(lines[i])
                i += 1
            i += 1  # consume closing fence
            body = _esc("\n".join(code))
            if lang:
                out.append('<pre><code class="language-%s">%s</code></pre>' % (lang, body))
            else:
                out.append("<pre>%s</pre>" % body)
            continue

        # Table: a "| … |" row followed by a "| --- |" separator. Telegram can't
        # render tables — flatten to bold-header + " | "-joined rows.
        if "|" in line and i + 1 < n and "-" in lines[i + 1] and _RE_TABLE_SEP.match(lines[i + 1]):
            out.append(" | ".join("<b>%s</b>" % _inline(c) for c in _split_row(line)))
            i += 2
            while i < n and "|" in lines[i] and lines[i].strip():
                out.append(" | ".join(_inline(c) for c in _split_row(lines[i])))
                i += 1
            continue

        # Heading -> bold line.
        m = _RE_HEADING.match(line)
        if m:
            out.append("<b>%s</b>" % _inline(m.group(2).strip().rstrip("#").strip()))
            i += 1
            continue

        # Horizontal rule.
        if _RE_HR.match(line):
            out.append("———")
            i += 1
            continue

        # Blockquote (consume consecutive > lines).
        if _RE_QUOTE.match(line):
            quote = []
            while i < n and _RE_QUOTE.match(lines[i]):
                quote.append(_inline(_RE_QUOTE.sub("", lines[i])))
                i += 1
            out.append("<blockquote>%s</blockquote>" % "\n".join(quote))
            continue

        # Bullet -> "• " (keep indentation; harmless in HTML mode).
        m = _RE_BULLET.match(line)
        if m:
            out.append("%s• %s" % (m.group(1), _inline(m.group(2))))
            i += 1
            continue

        # Ordered list -> keep the number.
        m = _RE_ORDERED.match(line)
        if m:
            out.append("%s%s. %s" % (m.group(1), m.group(2), _inline(m.group(3))))
            i += 1
            continue

        # Blank line or plain paragraph.
        out.append("" if line.strip() == "" else _inline(line))
        i += 1
    return "\n".join(out)


# ---- per-channel payload builders -----------------------------------------

def telegram(text, title, severity, limit=3900):
    meta = SEVERITY.get(severity, SEVERITY[DEFAULT_SEVERITY])
    body = text
    if title:
        body = "**%s %s**\n\n%s" % (meta["emoji"], title, body)
    # Chunk the Markdown first (fence-safe, tested), leaving headroom for the
    # HTML growth (<b></b>, <a href=…>) that md_to_telegram_html adds per chunk.
    md_chunks = chunk(body, min(limit, 3400))
    n = len(md_chunks)
    out = []
    for i, c in enumerate(md_chunks):
        suffix = f"\n\n[{i + 1}/{n}]" if n > 1 else ""
        out.append(md_to_telegram_html(c) + suffix)
    return out  # list[str] of Telegram HTML


def discord(text, title, severity, limit=4096):
    meta = SEVERITY.get(severity, SEVERITY[DEFAULT_SEVERITY])
    chunks = chunk(text, limit)
    payloads = []
    n = len(chunks)
    for i, c in enumerate(chunks):
        embed = {"description": c, "color": meta["color"]}
        if title and i == 0:
            embed["title"] = f"{meta['emoji']} {title}"
        if n > 1:
            embed["footer"] = {"text": f"{i + 1}/{n}"}
        payloads.append({"embeds": [embed]})
    return payloads  # list[dict]


def slack(text, title, severity, limit=3000):
    meta = SEVERITY.get(severity, SEVERITY[DEFAULT_SEVERITY])
    blocks = []
    if title:
        blocks.append({
            "type": "header",
            "text": {"type": "plain_text", "text": f"{meta['emoji']} {title}"[:150]},
        })
    for c in chunk(text, limit):
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": c}})
    return {"blocks": blocks}  # dict


def buzz(text, title, severity, limit=15000):
    # Buzz (Block's Nostr-relay workspace) renders Markdown natively, so unlike the
    # Telegram/Slack paths there is no HTML or Block-Kit transform — just chunk the
    # Markdown fence-safely. `limit` sits well under the relay's 65,536-byte per-message
    # cap and small enough to stay readable in a chat channel. One `buzz messages send`
    # per chunk; the caller base64-decodes each line and pipes it to the CLI's stdin.
    meta = SEVERITY.get(severity, SEVERITY[DEFAULT_SEVERITY])
    body = text
    if title:
        body = "%s **%s**\n\n%s" % (meta["emoji"], title, body)
    chunks = chunk(body, limit)
    n = len(chunks)
    if n > 1:
        chunks = [c + f"\n\n[{i + 1}/{n}]" for i, c in enumerate(chunks)]
    return chunks  # list[str] of Markdown, one message per chunk


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("channel", choices=["telegram", "discord", "slack", "buzz"])
    ap.add_argument("--title", default="")
    ap.add_argument("--severity", default=DEFAULT_SEVERITY)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    text = sys.stdin.read()

    if args.channel == "telegram":
        lim = args.limit or 3900
        for c in telegram(text, args.title, args.severity, lim):
            sys.stdout.write(base64.b64encode(c.encode()).decode() + "\n")
    elif args.channel == "discord":
        lim = args.limit or 4096
        for p in discord(text, args.title, args.severity, lim):
            sys.stdout.write(json.dumps(p) + "\n")
    elif args.channel == "slack":
        lim = args.limit or 3000
        sys.stdout.write(json.dumps(slack(text, args.title, args.severity, lim)) + "\n")
    elif args.channel == "buzz":
        lim = args.limit or 15000
        for c in buzz(text, args.title, args.severity, lim):
            sys.stdout.write(base64.b64encode(c.encode()).decode() + "\n")


if __name__ == "__main__":
    main()
