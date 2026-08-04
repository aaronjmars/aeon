---
name: [REPLACE: SKILL_NAME]
description: Watch Vercel deploys for [REPLACE: VERCEL_PROJECT] — alert on [REPLACE: ALERT_ON] in the last [REPLACE: LOOKBACK_HOURS] hours
metadata:
  category: dev
  var: ""
  tags:
    - dev
  requires:
    - VERCEL_TOKEN
---

> **${var}** — Optional. Override the Vercel project slug. If empty, watches `[REPLACE: VERCEL_PROJECT]`.

Today is ${today}. Watch Vercel deployments for **[REPLACE: VERCEL_PROJECT]** and alert on **[REPLACE: ALERT_ON]** within the last **[REPLACE: LOOKBACK_HOURS]** hours.

## Required secrets

- `VERCEL_TOKEN` — personal access token from https://vercel.com/account/tokens. Read scope is enough.
- (optional) `VERCEL_TEAM_ID` — if the project lives under a team, set this so the API queries the right scope.

If either secret is missing, log `DEPLOY_WATCH_NO_TOKEN` and exit cleanly — never abort the workflow.

## Steps

1. **Resolve scope**:
   ```bash
   PROJECT="${var:-[REPLACE: VERCEL_PROJECT]}"
   SCOPE_QS=""
   if [ -n "${VERCEL_TEAM_ID:-}" ]; then
     SCOPE_QS="&teamId=$VERCEL_TEAM_ID"
   fi
   ```

2. **Fetch recent deploys** — Vercel API v6 lists deployments for a project:
   ```bash
   SINCE_MS=$(( $(date -u +%s) * 1000 - [REPLACE: LOOKBACK_HOURS] * 3600 * 1000 ))
   URL="https://api.vercel.com/v6/deployments?projectId=$PROJECT&since=$SINCE_MS$SCOPE_QS&limit=20"
   curl -sf -H "Authorization: Bearer $VERCEL_TOKEN" "$URL" > .vercel-deploys.json || \
     echo "DEPLOY_WATCH_FETCH_FAIL: $?"
   ```

   Make every Vercel call in-run with `./secretcurl` (write the key as `{VERCEL_TOKEN}` — a bare `$VERCEL_TOKEN` on the line is refused by the Bash permission layer). Read-only status checks and any **irreversible action** (e.g. triggering a deploy) both run in-run — the irreversible one as the skill's final, fail-closed action. Never defer a read.

3. **Parse and classify** — for each deploy, capture: `uid`, `state` (READY / ERROR / CANCELED / BUILDING / QUEUED), `url`, `target` (production / preview), `creator`, `createdAt`, `meta.githubCommitMessage`.

4. **Apply the alert filter** — `[REPLACE: ALERT_ON]` is one of:
   - `production-failures` → alert when `target=production` AND `state in {ERROR, CANCELED}`.
   - `any-failures` → alert on any `state in {ERROR, CANCELED}`.
   - `slow-builds` → alert when build time > 10× the last-week median for this project.
   - `all` → alert on every state transition (noisy — only useful while debugging the skill).

5. **Compare against last-success baseline** — if alerting on a failure, also fetch the most recent successful production deploy and include in the notification: "last green: [commit] · [N hours] ago".

6. **Dedup** — track alerted deploy UIDs in `memory/topics/[REPLACE: SKILL_NAME]-alerted.json`. Never re-alert for the same UID.

7. **Notify on every new alert** via `./notify`:
   ```
   *Deploy alert — [REPLACE: VERCEL_PROJECT]*
   ${state}: ${commit_message}
   ${target} build by ${creator} · ${ago}
   Last green: ${last_green_commit} · ${last_green_ago}
   Inspect: https://vercel.com/${owner}/${PROJECT}/${uid}
   ```

8. **Write a roll-up** to `output/articles/[REPLACE: SKILL_NAME]-${today}.md`: total deploys, success/fail counts per target, average build time, list of failed UIDs with commit messages.

9. **Log** to `memory/logs/${today}.md`:
   ```
   ## [REPLACE: SKILL_NAME]
   - **Deploys (${LOOKBACK_HOURS}h)**: total=N, ready=X, error=Y, canceled=Z, building=W
   - **Alerts fired**: N (deduped from M raw matches)
   - **Status**: DEPLOY_OK | DEPLOY_QUIET (no deploys) | DEPLOY_ALERT | DEPLOY_DEGRADED
   ```

## Network note

The Vercel API requires `Authorization: Bearer {VERCEL_TOKEN}`. A bare `$SECRET` on a command line is refused by the Bash permission layer, so make **every** Vercel call in-run with `./secretcurl` (write the key as the `{VERCEL_TOKEN}` placeholder — it keeps the secret off the line). Both the read-only status checks and any **irreversible** action (like triggering a deploy) run in-run; the irreversible one goes last, as the skill's final fail-closed action. Never defer a read.

## Constraints

- **Dedup is non-negotiable**. Re-running the same alert for the same deploy will train operators to mute the channel — once alerted, never again unless the deploy changes state.
- **Production beats preview** for alerting. A failed preview deploy is interesting but not urgent. Default to `production-failures` until the operator opts into more.
- **Compare against baseline**. A failed build means more when paired with "last green was 3 hours ago" than alone.
