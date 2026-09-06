#!/usr/bin/env python3
"""Delivery preflight for aeon's Resend senders (send-email, disclosure-emailer).

Run at the START of every Resend-backed skill. A 200 from POST /emails only means
"accepted for delivery" - the actual delivered/bounced outcome is decided async,
seconds to minutes later, so a send logged as email-sent can still have bounced.
This closes that blind spot: it polls Resend GET /emails/{id} for every recent
send in memory/email-log.json that has no terminal delivery status yet, records
the result back into the ledger, flags any hard-bounced disclosure draft so it is
never re-sent to a dead address, and prints a summary the caller ./notify's when a
new bounce/complaint appears.

Reads RESEND_API_KEY from os.environ (never argv - keeps the secret off the
analyzed command line, same as scripts/email_payload.py). Advisory only: no-ops
(exit 0) if the key is unset, the ledger is missing/empty, or a poll errors - it
must never block the skill's own send.

Output: a short human summary on stdout. When a NEW bounce/complaint is found this
run, the first line is exactly "BOUNCE_ALERT" so the caller knows to notify.
"""
import os
import sys
import json
import re
import urllib.request
from datetime import datetime, timezone, timedelta

LEDGER = "memory/email-log.json"
API = "https://api.resend.com/emails/"
MAX_AGE_DAYS = int(os.environ.get("EMAIL_BOUNCE_LOOKBACK_DAYS", "30"))

# Resend last_event -> our terminal delivery_status bucket.
GOOD = {"delivered", "opened", "clicked"}
BAD = {"bounced", "complained", "failed", "canceled", "cancelled"}
# Anything else (sent, scheduled, queued, delivery_delayed, ...) is still pending.


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_dt(s):
    try:
        return datetime.fromisoformat((s or "").replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def load_ledger():
    try:
        with open(LEDGER) as f:
            data = json.load(f)
        return data if isinstance(data, list) else None
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def get_email(eid, key):
    req = urllib.request.Request(API + eid, headers={"Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def flag_draft(path):
    """After a hard bounce, mark a disclosure draft's contact unverified so the
    emailer's eligibility gate never retries a dead address."""
    try:
        with open(path) as f:
            txt = f.read()
    except (FileNotFoundError, OSError):
        return
    if not re.search(r"(?m)^status:\s*email-sent\b", txt):
        return
    txt = re.sub(r"(?m)^status:\s*email-sent\b.*$", "status: contact-unverified", txt, count=1)
    if not re.search(r"(?m)^deliverability:", txt):
        txt = txt.replace("status: contact-unverified", "status: contact-unverified\ndeliverability: bounced", 1)
    try:
        with open(path, "w") as f:
            f.write(txt)
    except OSError:
        return


def main():
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        print("bounce-check: RESEND_API_KEY unset - skipped")
        return 0
    rows = load_ledger()
    if not rows:
        print("bounce-check: no ledger - skipped")
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    changed = False
    checked = 0
    alerts = []

    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("delivery_status") in GOOD or row.get("delivery_status") in BAD:
            continue  # already terminal
        eid = row.get("resend_id")
        if not eid:
            continue
        sent = parse_dt(row.get("sent_at"))
        if sent and sent < cutoff:
            continue  # too old to keep polling
        checked += 1
        try:
            data = get_email(eid, key)
        except Exception:
            continue  # advisory: a poll error must not block the skill
        last_event = (data.get("last_event") or "").lower()
        if not last_event:
            continue

        was = row.get("delivery_status")
        row["last_event"] = last_event
        row["delivery_checked_at"] = now_iso()
        if last_event in GOOD:
            row["delivery_status"] = "delivered"
            changed = True
        elif last_event in BAD:
            bucket = "canceled" if last_event == "cancelled" else last_event
            row["delivery_status"] = bucket
            bounce = data.get("bounce") or {}
            if bounce:
                row["bounce"] = {k: bounce[k] for k in ("type", "subType", "message") if bounce.get(k)}
            changed = True
            if was not in BAD:
                alerts.append(row)
                if bucket == "bounced" and row.get("draft_path"):
                    flag_draft(row["draft_path"])
        else:
            row["delivery_status"] = "pending"
            changed = True

    if changed:
        with open(LEDGER, "w") as f:
            json.dump(rows, f, indent=1)
            f.write("\n")

    if alerts:
        print("BOUNCE_ALERT")
        for r in alerts:
            b = r.get("bounce") or {}
            detail = " ({})".format(b.get("subType") or b.get("type")) if b else ""
            print("- {}{}: {} - {} [{}]".format(
                r.get("delivery_status"), detail, r.get("to"),
                (r.get("subject") or "")[:70], r.get("resend_id")))
    else:
        print("bounce-check: {} polled, no new bounces".format(checked))
    return 0


if __name__ == "__main__":
    sys.exit(main())
