#!/usr/bin/env python3
"""render_card.py — build the Weekly Aeon Card image from memory/token-usage.csv.

Pure-stdlib, deterministic (today is passed in, never read from the clock), no
network. Emits a self-contained SVG (the canonical image — renders on GitHub and
any browser) and, best-effort, a PNG for chat/social sharing.

Usage:
  python3 skills/weekly-aeoncard/render_card.py \
    --csv memory/token-usage.csv --out output/images/weekly-aeoncard-2026-08-05.svg \
    --instance aeon --today 2026-08-05 --window-days 7 [--png <path>] [--json <path>]

Exit 0 prints a one-line JSON summary to stdout (the skill parses it for notify).
Exit 3 = no usable rows (empty/absent ledger).
"""
import argparse, csv, json, sys
from collections import defaultdict
from datetime import date, timedelta

COLS = ("input_tokens", "output_tokens", "cache_read", "cache_creation")


def human(n):
    n = float(n)
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= div:
            v = n / div
            return (f"{v:.2f}{suf}" if v < 10 else f"{v:.1f}{suf}" if v < 100 else f"{v:.0f}{suf}")
    return f"{int(n)}"


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def parse_rows(path):
    rows = []
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh):
            try:
                r["_d"] = date.fromisoformat(r["date"].strip())
                for c in COLS:
                    r[c] = int(r[c])
                rows.append(r)
            except (ValueError, KeyError, TypeError):
                continue  # skip malformed rows, never crash the card
    return rows


def totals(rows):
    t = {c: sum(r[c] for r in rows) for c in COLS}
    t["total"] = sum(t[c] for c in COLS)
    t["runs"] = len(rows)
    return t


def by_skill(rows, top=5):
    agg = defaultdict(lambda: [0, 0])  # tokens, runs
    for r in rows:
        agg[r["skill"]][0] += sum(r[c] for c in COLS)
        agg[r["skill"]][1] += 1
    ranked = sorted(agg.items(), key=lambda kv: -kv[1][0])
    return ranked[:top]


def svg(instance, today, wd, life, week, week_skills, life_skills, models, span):
    W, H = 1200, 630
    bg0, bg1 = "#0d1117", "#161b22"
    fg, muted, line = "#e6edf3", "#8b949e", "#30363d"
    acc, acc2 = "#7c9cff", "#34d399"
    cache_pct = (100 * life["cache_read"] / life["total"]) if life["total"] else 0
    rows = week_skills if week_skills else life_skills
    bar_label = "Top skills this week" if week_skills else "Top skills (all-time)"
    maxtok = max((v[0] for _, v in rows), default=1) or 1

    def bars():
        out, y = [], 356
        for name, (tok, runs) in rows:
            w = int(300 * tok / maxtok)
            out.append(
                f'<text x="64" y="{y+13}" font-size="19" fill="{fg}" '
                f'font-family="monospace">{esc(name)[:22]}</text>'
                f'<rect x="330" y="{y}" width="{w}" height="18" rx="4" fill="{acc}"/>'
                f'<text x="{330+w+10}" y="{y+14}" font-size="16" fill="{muted}" '
                f'font-family="monospace">{human(tok)} · {runs}r</text>')
            y += 40
        return "\n".join(out)

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="-apple-system,Segoe UI,Roboto,sans-serif">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="{bg0}"/><stop offset="1" stop-color="{bg1}"/></linearGradient></defs>
<rect width="{W}" height="{H}" fill="url(#bg)"/>
<rect x="0" y="0" width="{W}" height="6" fill="{acc}"/>
<text x="64" y="78" font-size="30" font-weight="700" fill="{fg}">◆ AEON</text>
<text x="{W-64}" y="70" text-anchor="end" font-size="22" fill="{acc2}" font-weight="600">{esc(instance)}</text>
<text x="{W-64}" y="98" text-anchor="end" font-size="17" fill="{muted}" font-family="monospace">week of {esc(today)}</text>
<text x="64" y="150" font-size="40" font-weight="800" fill="{fg}">Weekly Consumption</text>
<line x1="64" y1="178" x2="{W-64}" y2="178" stroke="{line}" stroke-width="1"/>
<!-- this week -->
<text x="64" y="222" font-size="18" fill="{muted}" letter-spacing="2">THIS WEEK ({wd}D)</text>
<text x="64" y="288" font-size="72" font-weight="800" fill="{acc}">{human(week['total'])}</text>
<text x="64" y="320" font-size="20" fill="{muted}" font-family="monospace">tokens · {week['runs']} runs · out {human(week['output_tokens'])}</text>
<!-- all time -->
<text x="640" y="222" font-size="18" fill="{muted}" letter-spacing="2">ALL-TIME</text>
<text x="640" y="288" font-size="72" font-weight="800" fill="{acc2}">{human(life['total'])}</text>
<text x="640" y="320" font-size="20" fill="{muted}" font-family="monospace">tokens · {life['runs']} runs · since {esc(span)}</text>
<line x1="64" y1="342" x2="{W-64}" y2="342" stroke="{line}" stroke-width="1"/>
<text x="64" y="336" font-size="15" fill="{muted}">{esc(bar_label)}</text>
{bars()}
<line x1="64" y1="560" x2="{W-64}" y2="560" stroke="{line}" stroke-width="1"/>
<text x="64" y="592" font-size="16" fill="{muted}" font-family="monospace">cache-read {cache_pct:.0f}% of tokens · {len(models)} model(s): {esc(', '.join(models)[:60])}</text>
<text x="{W-64}" y="592" text-anchor="end" font-size="14" fill="{line}">generated {esc(today)}</text>
</svg>'''


def report_md(instance, today, wd, life, week, week_sk, life_sk, models, span, cache_pct, img_link):
    def tbl(rows):
        out = ["| skill | tokens | runs |", "|---|---|---|"]
        for n, (tok, runs) in rows:
            out.append(f"| `{n}` | {human(tok)} | {runs} |")
        return "\n".join(out)
    return f"""---
type: Article
title: Weekly Aeon Card — {instance} — {today}
description: Token-consumption recap for {instance} — {human(week['total'])} tokens over the last {wd}d, {human(life['total'])} all-time.
tags: [monitoring, meta, tokens]
timestamp: {today}
---

# Weekly Aeon Card — {instance} — {today}

**This week ({wd}d):** {human(week['total'])} tokens across {week['runs']} runs
**All-time:** {human(life['total'])} tokens across {life['runs']} runs (since {span})
**Cache-read:** {cache_pct:.0f}% of all tokens · **Models:** {', '.join(models)}

![Weekly Aeon Card]({img_link})

## Top skills this week
{tbl(week_sk)}

## Top skills all-time
{tbl(life_sk)}

---
*Consumption recap from `memory/token-usage.csv`. Weekly window = last {wd} days ending {today}. Every number is measured from the ledger; nothing is fetched or estimated.*
"""


def dashboard_json(instance, today, wd, life, week, cache_pct, img_link):
    import json as _j
    def txt(t, variant=None):
        p = {"text": t}
        if variant:
            p["variant"] = variant
        return {"type": "Text", "props": p}
    els = {
        "card": {"type": "Card", "props": {"title": f"Weekly Aeon Card — {instance}"}, "children": ["stack"]},
        "stack": {"type": "Stack", "props": {"direction": "vertical", "gap": "md"}, "children": ["wk", "life", "cache", "img"]},
        "wk": {**txt(f"This week ({wd}d): {human(week['total'])} tokens · {week['runs']} runs")},
        "life": {**txt(f"All-time: {human(life['total'])} tokens · {life['runs']} runs")},
        "cache": {**txt(f"cache-read {cache_pct:.0f}% of tokens", "muted")},
        "img": {**txt(f"Image: {img_link}", "muted")},
    }
    return _j.dumps({"root": "card", "state": {}, "elements": els}, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--instance", default="aeon")
    ap.add_argument("--today", required=True)
    ap.add_argument("--window-days", type=int, default=7)
    ap.add_argument("--png", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--report", default="")
    ap.add_argument("--dashboard", default="")
    ap.add_argument("--log", default="")
    ap.add_argument("--img-link", default="")
    a = ap.parse_args()

    try:
        rows = parse_rows(a.csv)
    except FileNotFoundError:
        print(json.dumps({"error": "ledger-absent"}))
        return 3
    if not rows:
        print(json.dumps({"error": "no-rows"}))
        return 3

    today = date.fromisoformat(a.today)
    start = today - timedelta(days=a.window_days - 1)
    wk = [r for r in rows if start <= r["_d"] <= today]

    life, week = totals(rows), totals(wk)
    span = min(r["_d"] for r in rows).isoformat()
    models = sorted({r.get("model", "?") for r in rows if r.get("model")})
    week_sk, life_sk = by_skill(wk), by_skill(rows)
    cache_pct = (100 * life["cache_read"] / life["total"]) if life["total"] else 0
    img_link = a.img_link or a.out
    doc = svg(a.instance, a.today, a.window_days, life, week,
              week_sk, life_sk, models, span)

    with open(a.out, "w") as fh:
        fh.write(doc)

    if a.report:
        with open(a.report, "w") as fh:
            fh.write(report_md(a.instance, a.today, a.window_days, life, week,
                               week_sk, life_sk, models, span, cache_pct, img_link))
    if a.dashboard:
        try:
            with open(a.dashboard, "w") as fh:
                fh.write(dashboard_json(a.instance, a.today, a.window_days, life, week, cache_pct, img_link))
        except OSError:
            pass  # dashboard spec is a convenience; never fail the run over it
    if a.log:
        with open(a.log, "a") as fh:
            fh.write(
                f"\n### weekly-aeoncard\n"
                f"- Window: last {a.window_days}d ({start.isoformat()} -> {a.today})\n"
                f"- This week: {human(week['total'])} tokens / {week['runs']} runs\n"
                f"- All-time: {human(life['total'])} tokens / {life['runs']} runs (since {span})\n"
                f"- Top this week: {', '.join(f'{n} {human(v[0])}' for n, v in week_sk[:3]) or 'none'}\n"
                f"- Image: {a.out}\n"
                f"- Status: WEEKLY_AEONCARD_OK\n")

    png_ok = False
    if a.png:
        try:
            import cairosvg  # optional; ubuntu-latest ships libcairo2
            cairosvg.svg2png(bytestring=doc.encode(), write_to=a.png,
                             output_width=1200, output_height=630)
            png_ok = True
        except Exception:
            png_ok = False
        if not png_ok:  # fallback: rsvg-convert if it's on PATH (librsvg2-bin)
            import shutil, subprocess
            if shutil.which("rsvg-convert"):
                try:
                    subprocess.run(["rsvg-convert", "-w", "1200", "-h", "630",
                                    a.out, "-o", a.png], check=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    png_ok = True
                except Exception:
                    png_ok = False  # SVG stands alone; never fail the run over the PNG

    summary = {
        "instance": a.instance, "today": a.today, "window_days": a.window_days,
        "week_total": week["total"], "week_runs": week["runs"],
        "life_total": life["total"], "life_runs": life["runs"],
        "since": span, "cache_read_pct": round(100 * life["cache_read"] / life["total"], 1) if life["total"] else 0,
        "week_human": human(week["total"]), "life_human": human(life["total"]),
        "top_week": [[n, v[0], v[1]] for n, v in by_skill(wk, 5)],
        "svg": a.out, "png": a.png if png_ok else "", "models": models,
    }
    if a.json:
        with open(a.json, "w") as fh:
            json.dump(summary, fh, indent=2)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
