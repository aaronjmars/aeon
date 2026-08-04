---
name: schedule-ads
description: Manage paid ads on AdManage.ai from declarative config - default schedules launches across Meta/TikTok/Snapchat/Pinterest/LinkedIn (always PAUSED); create provisions Meta campaigns and ad sets.
metadata:
  title: Schedule Ads
  category: productivity
  var: |
    Selects which flow runs (parse from ${var}):
    - empty / unset (default) → SCHEDULE branch: read config.yaml, pick schedule
      entries matching today, and launch those ads in-run via AdManage.ai.
      Launches PAUSED by default; dailySpendCap circuit-breaker; never auto-activates
      live spend.
    - "create" → CREATE branch: read config.create.yaml, diff against
      .admanage-state/campaigns.json, and create the missing Meta campaigns + ad sets
      in-run. On-demand; creates entities PAUSED; returned IDs are written back into
      state so the schedule branch can launch into them.
  schedule: "0 8 * * *"
  commits: true
  permissions:
    - contents:write
  tags:
    - growth
    - ads
  requires:
    - ADMANAGE_API_KEY
---

> **${var}** selects the flow. Empty/unset = **schedule** (launch ads into existing ad sets). `create` = **create-campaign** (provision Meta campaigns + ad sets). Both are config-driven, PAUSED-by-default, and make the AdManage API calls **in-run** via `./secretcurl` (the `{ADMANAGE_API_KEY}` placeholder keeps the key off the command line), behind fail-closed spend guardrails.

Reads a declarative config, computes what to do, and makes the AdManage.ai API calls **in-run** via `./secretcurl`. The calls are an irreversible outbound side-effect (real ad spend), so they are each branch's **final** actions and run only behind the guardrails below (PAUSED-by-default, `dailySpendCap` circuit-breaker, dry-run). `ADMANAGE_API_KEY` is injected in-run via this skill's `requires:` — always write it as the `{ADMANAGE_API_KEY}` placeholder, never a bare `$ADMANAGE_API_KEY` (the Bash permission layer refuses that).

## Preamble (both branches)

1. Read `memory/MEMORY.md` for context. Read the last ~3 days of `memory/logs/` for recent launch / provisioning activity — don't re-report a signal already logged.
2. Parse `${var}`:
   - empty / unset → run the **Schedule branch** below.
   - `create` → run the **Create branch** below.
   - anything else → log `SCHEDULE_ADS_UNKNOWN_SELECTOR: <value>` and exit cleanly (no notify).
3. Both branches spend real money on ad platforms. The shared safety posture (see each branch) is: PAUSED by default, config-only (never invent campaigns/creative/targeting), dry-run available, and exit silently when there's nothing to do.

---

# Schedule branch (default — empty `${var}`)

Reads `skills/schedule-ads/config.yaml`, picks schedule entries matching today, and launches those ads **in-run** via AdManage.ai (`POST /v1/launch` through `./secretcurl`), behind the spend guardrails below.

## Safety defaults (schedule)

This branch **spends real money on ad platforms**. Guardrails, in priority order:

1. **PAUSED by default.** Every launch request sets the entity to PAUSED. The operator has to resume manually in the AdManage dashboard before spend starts. `launchPaused: false` in config is the explicit opt-out.
2. **Daily spend cap.** Before launching, the branch checks `GET /v1/spend/daily` for today. If spend ≥ `dailySpendCap` in the config, all launches are skipped and a warning is notified. If the spend figure can't be verified (malformed / empty response), **fail closed** — skip and notify, don't launch. This is a circuit breaker, not a budget enforcer — platform budgets still apply.
3. **Dry-run mode.** If `DRY_RUN=true` in env or `dryRun: true` in config, the branch builds the payloads, writes them to `.pending-admanage/dryrun/`, notifies what *would* launch, and exits without calling the API.
4. **Config-only.** The branch does not invent campaigns, creative, or targeting. If there's no schedule for today, it exits cleanly with no API calls.
5. **Single source of truth.** All ads/campaigns/targeting live in `config.yaml`. The branch never generates new creative on the fly.

## Network note (schedule)

Launching ads is an irreversible outbound side-effect (real ad spend), so it is the branch's **final** action and runs only after the guardrails above pass:

- Auth'd calls go through `./secretcurl` with the `{ADMANAGE_API_KEY}` placeholder — never a bare `$ADMANAGE_API_KEY` (the Bash permission layer refuses that). `ADMANAGE_API_KEY` is injected in-run via `requires:`.
- The branch checks the daily spend cap (`GET /v1/spend/daily`), then per batch calls `POST /v1/launch`, polls `GET /v1/batch-status/{id}` to a terminal state, and reports via `./notify`.
- If `ADMANAGE_API_KEY` is unset, or the launch/spend call fails, skip the launch and notify — do not retry blindly. There is no deferred postprocess fallback.

## Steps (schedule)

1. **Load config.** Read `skills/schedule-ads/config.yaml`. If the file doesn't exist, log `SCHEDULE_ADS_NOT_CONFIGURED` and exit cleanly (no notify, no error). The example template lives next to this file as `config.example.yaml`.

2. **Validate config shape.** Required top-level keys: `defaults` (with `adAccountId`, `workspaceId`, `page`), and `schedules` (array). If either is missing, file an issue in `memory/issues/` per the CLAUDE.md issue tracker convention, notify once, and exit.

3. **Pick today's schedule entries.** For each entry in `schedules`, match against today's date:
   - `when.everyDay: true` → always matches.
   - `when.dayOfWeek: monday` (or any weekday name, lowercase) → matches if today is that weekday (UTC).
   - `when.date: "2026-04-25"` → matches only on that exact date.
   - `when.dates: ["2026-04-25", "2026-05-02"]` → matches if today is in the list.
   - `when.cron: "0 8 * * 1"` → (advanced) matches if today satisfies the cron. Optional — skip if it's too much parsing effort.

   If no entries match today, log `SCHEDULE_ADS_NOTHING_TODAY` and exit cleanly (no notify).

4. **Build launch payloads.** For each matching schedule entry, construct the AdManage `POST /v1/launch` body:
   ```json
   {
     "ads": [
       {
         "adName": "<templated from ad.adName, {date} replaced>",
         "adAccountId": "<from defaults or entry override>",
         "workspaceId": "<from defaults or entry override>",
         "title": "<from ad>",
         "description": "<from ad>",
         "cta": "<from ad or defaults.cta>",
         "link": "<from ad>",
         "page": "<from defaults>",
         "insta": "<from defaults, Meta only>",
         "adSets": [ { "value": "<id>", "label": "<name>" } ],
         "media": [ { "url": "<media url>" } ],
         "status": "PAUSED"
       }
     ]
   }
   ```
   Enforce `status: PAUSED` on every ad unless `defaults.launchPaused` is explicitly `false`. Never strip it silently.

   Template substitutions inside string fields:
   - `{date}` → today's ISO date (YYYY-MM-DD)
   - `{dateHuman}` → "April 21, 2026" style

5. **Pre-flight validation.** For each payload:
   - `media[*].url` must be an absolute `https://` URL. Reject entries with local paths or obviously broken URLs.
   - `adSets[*].value` must be a non-empty string. If missing, skip the entry with a warning in the log.
   - For Meta entries (`adAccountId` starts with `act_`): `page` and `insta` must be set. TikTok/Snapchat/etc. have their own requirements — don't block on Meta-specific fields for other platforms.
   - `title` and `description` must be non-empty.

   Drop invalid entries, keep going. Log which ones were skipped and why.

6. **Handle dry-run.** If `DRY_RUN=true` or `config.dryRun: true`:
   - Write payloads to `.pending-admanage/dryrun/{schedule-name}-{timestamp}.json`.
   - Notify a preview (see step 9) but with `[DRY RUN]` prefix.
   - Skip step 7.
   - This mode exists for the operator to sanity-check before arming real launches.

7. **Launch in-run.** This is the branch's final action — spends real money, so run the guardrails first. Only `./secretcurl`, `jq`, `date`, `echo`, `mkdir`, `grep`, `python3`, and the `Write` tool are available.

   a. **Config check.** `[ -n "${ADMANAGE_API_KEY:+x}" ]` (the `${VAR:+x}` form — a bare `$ADMANAGE_API_KEY` trips the secret-expansion analyzer and reads as unset). If unset → notify "ads computed but ADMANAGE_API_KEY missing — nothing launched" and stop.

   b. **Daily spend circuit-breaker (once).** Take the strictest `dailySpendCap` (`CAP`) across today's payloads. If set, read today's spend and **fail closed** unless it's a clean number *below* the cap:
      ```bash
      SPEND=$(./secretcurl -sS --max-time 30 -H "Authorization: Bearer {ADMANAGE_API_KEY}" \
        "https://api.admanage.ai/v1/spend/daily?startDate=$TODAY&endDate=$TODAY" | jq -r '.metadata.totalSpend // ""')
      echo "$SPEND" | grep -qE '^[0-9]+(\.[0-9]+)?$' || { echo "spend unverifiable — fail closed"; exit 0; }
      echo "$CAP"   | grep -qE '^[0-9]+(\.[0-9]+)?$' || { echo "dailySpendCap not numeric — fail closed"; exit 0; }
      python3 -c "import sys; sys.exit(0 if float(sys.argv[1])>=float(sys.argv[2]) else 1)" "$SPEND" "$CAP" \
        && { echo "daily spend cap tripped (today=$SPEND cap=$CAP) — launching nothing"; exit 0; }
      ```
   c. **Per batch: launch, then poll.** For each payload `{ ads: [ ... ] }`:
      ```bash
      RESP=$(./secretcurl -sS --max-time 60 -w 'http=%{http_code}\n' -X POST "https://api.admanage.ai/v1/launch" \
        -H "Authorization: Bearer {ADMANAGE_API_KEY}" -H "Content-Type: application/json" -d "$PAYLOAD")
      # success => .success==true and .adBatchId set; else record FAILED (.message/.error) and continue.
      # Poll GET /v1/batch-status/$BATCH_ID (~90s, 5s interval) until .summaryStatus is success|error.
      ```
      Record each batch's outcome (ok / error / still-running-after-timeout) for the notify. Ads launch **PAUSED** (the payload sets it) unless `launchPaused: false`.

8. **Write artifact to `output/.chains/schedule-ads.md`** so downstream chain consumers can read what was queued. Format:
   ```markdown
   # Schedule Ads — ${today}

   Queued: N launches across M schedules.
   Dry-run: yes|no.

   ## Entries
   - <schedule name>: <ad count> ads, platform=<meta|tiktok|…>, paused=<bool>
     - <adName> — <title>
   ```

9. **Notify** via `./notify`. Keep it tight:
   ```
   *Ads queued — ${today}${dryRunSuffix}*

   <N> launches queued from <M> schedules.

   - <schedule name> → <ad count> ads <platform> <paused|LIVE>
     "<first adName>"
   - ...

   <if dry-run>
   no API calls made — remove DRY_RUN to arm.
   <else>
   launched via AdManage (PAUSED) — resume in the dashboard to start delivery.
   ```
   If nothing matched today (no launches), don't notify at all.

10. **Log** — see the shared **Log** section below (discriminator: `schedule`).

## Config schema (schedule)

See `skills/schedule-ads/config.example.yaml` for a filled-in template. Minimum viable config:

```yaml
defaults:
  adAccountId: act_XXXXXXXXXX
  workspaceId: XXXXXXXXXXXX
  page: XXXXXXXXXXXX         # Meta Page ID
  insta: XXXXXXXXXXXX        # Instagram user ID
  cta: LEARN_MORE
  launchPaused: true         # NEVER change this without thought
  dailySpendCap: 50          # USD. Circuit breaker.
  dryRun: false

schedules:
  - name: weekly-promo
    platform: meta
    when: { dayOfWeek: monday }
    adSets:
      - { value: "120xxxxxxxxxxxxx", label: "US Broad 25-55" }
    ads:
      - adName: "Weekly promo — {date}"
        title: "Headline copy here"
        description: "Supporting copy in a sentence or two."
        cta: LEARN_MORE
        link: https://example.com
        media:
          - url: https://media.admanage.ai/your-account/hero.mp4
```

## What the schedule branch does NOT do

- **Does not create campaigns or ad sets.** Those must pre-exist in AdManage — use the **`create` branch** (`${var}=create`), the dashboard, or `POST /v1/manage/create-campaign` separately. This branch only launches *ads into existing ad sets*.
- **Does not upload creative.** Media URLs must be hosted somewhere accessible (AdManage CDN, your own CDN, Supabase, wherever). If you need upload, add a separate `upload-ad-media` skill that calls `POST /v1/media/upload/url`.
- **Does not generate copy.** Titles/descriptions come from config. If the operator wants AI-written variants, a separate skill can write them into `config.yaml` and commit — keeps the launch path boring and auditable.
- **Does not manage budgets, bids, or targeting.** Everything downstream of launch (scaling, pausing losers, budget shifts) lives in follow-up skills or the dashboard.
- **Does not launch to Google Ads, Axon, or Taboola** in v1. Config schema is deliberately Meta/TikTok/Snapchat/Pinterest/LinkedIn-shaped. Adding Google/Axon later is straightforward but their launch shapes differ enough to need their own validation.

---

# Create branch (`${var}=create`)

Reads `skills/schedule-ads/config.create.yaml`, figures out which campaigns/ad sets don't exist yet, and creates them **in-run** via AdManage.ai (`/v1/manage/create-*` through `./secretcurl`) — campaigns first, then ad sets referencing the returned campaign IDs — writing the new IDs back to `.admanage-state/campaigns.json`.

This branch is **on-demand** — invoke it manually when you want to provision new campaigns, then reference the returned IDs in `skills/schedule-ads/config.yaml` (schedule branch) to launch creatives into them.

Read `.admanage-state/campaigns.json` (if it exists) to see what's already created.

## What this branch provisions

Two entity types only:
1. **Meta campaigns** — name, objective, budget, bid strategy, promoted object.
2. **Meta ad sets** — name, budget, optimization goal, targeting (geo/age/platforms), destination.

Everything else (TikTok/Snapchat/Pinterest/LinkedIn campaigns, advanced Meta fields like valueRuleSetId or Advantage+ catalog) is v2+. The shape below is intentionally minimal.

## Safety defaults (create)

Same posture as the schedule branch:

1. **PAUSED by default.** Every campaign + ad set is created with `status: PAUSED`. No surprise spend.
2. **Idempotent.** The branch tracks created entities in `.admanage-state/campaigns.json`. If a campaign name already exists in state, it's skipped. Run it twice → no duplicates.
3. **Dry-run mode.** `DRY_RUN=true` or `config.dryRun: true` → payloads written to `.pending-admanage/dryrun-create/`, notified, no API calls.
4. **Config-only.** No config file → exit silently. No invented campaigns, no autonomous provisioning.

## Network note (create)

Provisioning campaigns and ad sets is an irreversible outbound side-effect, so it is the branch's **final** action and runs in-run only after the diff + validation pass:

- Auth'd calls go through `./secretcurl` with the `{ADMANAGE_API_KEY}` placeholder — never a bare `$ADMANAGE_API_KEY`. The key is injected in-run via `requires:`.
- **Order matters:** create all campaigns first (`POST /v1/manage/create-campaign`), keep a config-name → campaignId map, then create ad sets (`POST /v1/manage/create-adset`) substituting each parent's real campaign ID. Write every new ID back to `.admanage-state/campaigns.json` as you go (the workflow's Commit step persists it).
- If `ADMANAGE_API_KEY` is unset, or a create call fails, record the failure and continue with the rest — never retry blindly, never invent IDs. An ad set whose parent campaign failed to create is skipped. There is no deferred postprocess fallback.

## Steps (create)

1. **Load config.** Read `skills/schedule-ads/config.create.yaml`. If it doesn't exist, log `CREATE_CAMPAIGN_NOT_CONFIGURED` and exit cleanly (no notify). The example template lives next to this file as `config.create.example.yaml`.

2. **Load state.** Read `.admanage-state/campaigns.json`. If it doesn't exist, treat as empty. Shape:
   ```json
   {
     "campaigns": [
       {
         "configName": "Prospecting — Q2 2026",
         "campaignId": "120251616228380456",
         "adAccountId": "act_xxx",
         "createdAt": "2026-04-21T08:00:00Z",
         "adSets": [
           {
             "configName": "US Broad 25-54",
             "adSetId": "120251616242460456",
             "createdAt": "2026-04-21T08:00:04Z"
           }
         ]
       }
     ]
   }
   ```

3. **Validate config shape.** Required: `defaults.adAccountId`, `defaults.workspaceId`, `campaigns[]`. Each campaign needs `name` and `objective`. Each ad set needs `name`, and either `optimizationGoal` (explicit) or a compatible parent objective. If validation fails, file an issue in `memory/issues/` and exit.

4. **Compute diff.** For each campaign in config:
   - Match against state by exact `name`. If present, mark as `existing`.
   - If missing, mark as `new` and queue a campaign create.
   - For each ad set under the campaign, match against the parent's `adSets[]` in state by name. If missing, mark it for creation (carrying a `parentCampaignConfigName` reference you resolve to a real campaign ID in-run, once the parent campaign create returns).

   If nothing is new, log `CREATE_CAMPAIGN_ALL_EXIST` and exit without notify.

5. **Build campaign create payloads.** Per the AdManage `POST /v1/manage/create-campaign` shape:
   ```json
   {
     "businessId": "<adAccountId>",
     "workspaceId": "<workspaceId>",
     "name": "<campaign.name>",
     "objective": "<campaign.objective>",
     "status": "PAUSED",
     "buyingType": "AUCTION",
     "specialAdCategories": [],
     "dailyBudget": <number>,
     "bidStrategy": "<LOWEST_COST_WITHOUT_CAP | LOWEST_COST_WITH_BID_CAP | COST_CAP | ...>",
     "promotedObject": { ... }
   }
   ```
   Skip keys that are `null`/absent in config — don't send empty strings. Always force `status: PAUSED` unless `defaults.launchPaused: false` is set explicitly.

6. **Build ad-set create payloads.** Per `POST /v1/manage/create-adset`:
   ```json
   {
     "businessId": "<adAccountId>",
     "workspaceId": "<workspaceId>",
     "campaignId": "__RESOLVE_FROM_PARENT__",
     "parentCampaignConfigName": "<campaign.name>",
     "name": "<adSet.name>",
     "status": "PAUSED",
     "dailyBudget": <number>,
     "billingEvent": "IMPRESSIONS",
     "optimizationGoal": "<LANDING_PAGE_VIEWS | OFFSITE_CONVERSIONS | ...>",
     "destinationType": "<WEBSITE | PHONE_CALL | MESSAGING_... | ...>",
     "targeting": { ... },
     "promotedObject": { ... }
   }
   ```

   The `__RESOLVE_FROM_PARENT__` sentinel + `parentCampaignConfigName` marks an ad set whose `campaignId` you fill in-run, from the map built as each campaign create returns (step 9b). If the parent campaign was *existing* (already in state), write the real campaign ID directly and drop the sentinel.

7. **Pre-flight validation.**
   - `adAccountId` must start with `act_` (this branch is Meta-only in v1).
   - `dailyBudget` must be a positive number in dollars (not cents).
   - `objective` must be one of the documented Meta objectives: `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_AWARENESS`, `OUTCOME_SALES`, `OUTCOME_APP_PROMOTION`.
   - Targeting `geo_locations.countries` must be a non-empty array.
   Drop invalid entries, keep going, log what was skipped and why.

8. **Handle dry-run.** If `DRY_RUN=true` or `config.dryRun: true`: write payloads to `.pending-admanage/dryrun-create/` instead, notify with a `[DRY RUN]` prefix, skip step 9.

9. **Create in-run.** This is the branch's final action — provisions real entities, so run only after the diff + pre-flight pass. Only `./secretcurl`, `jq`, `date`, `echo`, `python3`, and the `Write` tool are available (no `mv`). Seed `.admanage-state/campaigns.json` to `{"campaigns":[]}` if missing.

   a. **Config check.** `[ -n "${ADMANAGE_API_KEY:+x}" ]` (the `${VAR:+x}` form — a bare `$ADMANAGE_API_KEY` trips the secret-expansion analyzer and reads as unset). If unset, notify "campaigns computed but ADMANAGE_API_KEY missing — nothing created" and stop (state unchanged).

   b. **Campaigns first.** For each *new* campaign, `POST /v1/manage/create-campaign`:
      ```bash
      RESP=$(./secretcurl -sS --max-time 60 -w 'http=%{http_code}\n' -X POST \
        "https://api.admanage.ai/v1/manage/create-campaign" \
        -H "Authorization: Bearer {ADMANAGE_API_KEY}" -H "Content-Type: application/json" -d "$PAYLOAD")
      # success => .success==true and .campaignId set.
      ```
      On success: remember `configName → campaignId` (for step 9c) and append `{configName, campaignId, adAccountId, createdAt, adSets:[]}` to `.admanage-state/campaigns.json`. On failure: record the error, skip this campaign's ad sets.

   c. **Then ad sets.** For each new ad set, resolve `campaignId`: if it's `__RESOLVE_FROM_PARENT__`, look it up by `parentCampaignConfigName` in the map from 9b **or** existing state — if the parent isn't found (its create failed), skip the ad set with a warning. Then `POST /v1/manage/create-adset` (same `./secretcurl` shape). On success: append `{configName, adSetId, createdAt}` under the parent campaign in `.admanage-state/campaigns.json` (via `python3`/`Write` — no `mv`).

   Ordering is explicit here (campaigns loop fully before the ad-sets loop), so children always reference a resolved parent ID.

10. **Write artifact to `output/.chains/create-campaign.md`** so chain consumers can see what was queued:
    ```markdown
    # Create Campaign — ${today}

    New campaigns: N.
    New ad sets: M.
    Dry-run: yes|no.

    ## Campaigns
    - <name> — <objective>, $<dailyBudget>/day
      - ad set: <name> — <optimizationGoal>, $<dailyBudget>/day, <countries>

    ## Skipped (already exist)
    - <name>
    ```

11. **Notify via `./notify`.** Tight format:
    ```
    *Campaigns queued — ${today}${dryRunSuffix}*

    <N> campaigns, <M> ad sets queued for creation.

    - <campaign name>
      - adset: <adset name> — <country>, $<budget>/day

    <if dry-run>
    no API calls made — remove DRY_RUN to arm.
    <else>
    created via AdManage (PAUSED); new IDs written to .admanage-state/campaigns.json.
    ```
    If nothing is new, don't notify at all.

12. **Log** — see the shared **Log** section below (discriminator: `create`).

## Config schema (create)

See `skills/schedule-ads/config.create.example.yaml` for a filled-in template. Minimum viable config:

```yaml
defaults:
  adAccountId: act_XXXXXXXXXX
  workspaceId: XXXXXXXXXXXX
  launchPaused: true               # never flip without a reason
  dryRun: false                    # true = build, don't call

campaigns:
  - name: "Prospecting — Q2 2026"
    objective: OUTCOME_TRAFFIC
    dailyBudget: 50
    bidStrategy: LOWEST_COST_WITHOUT_CAP
    promotedObject:
      pixel_id: "123456789012345"
    adSets:
      - name: "US Broad 25-54"
        dailyBudget: 15
        optimizationGoal: LANDING_PAGE_VIEWS
        destinationType: WEBSITE
        targeting:
          geo_locations: { countries: ["US"] }
          age_min: 25
          age_max: 54
          publisher_platforms: [facebook, instagram]
```

## Interaction with the schedule branch

The create branch writes new IDs to `.admanage-state/campaigns.json` **within the same run**; from there they're yours to reference in `skills/schedule-ads/config.yaml` (schedule branch) under `adSets[].value`. The two flows are intentionally decoupled:

- **create branch** provisions structure (container).
- **schedule branch** launches creative into that structure (contents).

They still don't auto-chain — the schedule branch reads `config.yaml`, which you edit by hand. Pattern is: run `${var}=create` (provisions + writes IDs in-run) → read the new IDs from `.admanage-state/campaigns.json` / the create-run notify → copy them into `config.yaml` → next default (schedule) run launches into them.

## What the create branch does NOT do

- **Doesn't touch existing campaigns.** Once a campaign is in state, this branch leaves it alone. Budget changes, bid changes, status flips, renames — all handled elsewhere (dashboard or a separate skill).
- **Doesn't delete or archive.** No destructive paths.
- **Doesn't provision media, pages, or pixels.** Pixel IDs must already exist in AdManage. Use `GET /v1/conversions/pixels` to discover them.
- **Doesn't create TikTok / Snapchat / Pinterest / LinkedIn** structures. Those have different payload shapes and live in v2.
- **Doesn't resume paused campaigns.** PAUSED is the end state; the operator unpauses manually when ready.

---

## Log (both branches)

Append to `memory/logs/${today}.md` under ONE `### schedule-ads` heading. First bullet is a discriminator naming which branch ran.

**Schedule branch:**
```
### schedule-ads
- Branch: schedule
- Schedules matching today: <names>
- Launches: <count> (dry-run: <bool>)
- Batch results: <ok/error/timeout summary> (live) | dry-run preview in .pending-admanage/dryrun/
```

**Create branch:**
```
### schedule-ads
- Branch: create
- New campaigns created: <count> (ok/fail)
- New ad sets created: <count> (ok/fail)
- State: new IDs written to .admanage-state/campaigns.json (live) | dry-run preview in .pending-admanage/dryrun-create/
```

## Environment Variables

- `ADMANAGE_API_KEY` — the AdManage.ai API key, injected in-run via this skill's `requires:` and used by both branches for the `/v1/*` calls. Always pass it as the `{ADMANAGE_API_KEY}` placeholder to `./secretcurl`, never a bare `$ADMANAGE_API_KEY` on the command line.
- `DRY_RUN` — optional. If `true`, forces dry-run mode regardless of config, in whichever branch runs.
- Notification channels configured via repo secrets (see CLAUDE.md).

## Output

End with a `## Summary` block naming the branch that ran:
- **schedule:** schedules matched today, payload count, dry-run yes/no, files written.
- **create:** new campaigns queued, new ad sets queued, skipped (already-exist) count, dry-run yes/no, files written.
