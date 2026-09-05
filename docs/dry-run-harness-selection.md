# local skill dry runs

The local dry-run gate now uses `harness-adapter/run-harness`. Choose the CLI
separately from its native model identifier:

```bash
bash scripts/dry-run.sh run <skill> '<input>' --harness codex --model gpt-6-astra
bash scripts/dry-run.sh run <skill> '<input>' --harness claude --model sonnet
```

Only Claude and Codex are supported by this local gate. With no options it retains
Claude as the default; no model argument means the selected CLI's own default.
`DRYRUN_HARNESS` and `DRYRUN_MODEL` also work; explicit flags take precedence.
This does not change `aeon.yml`, Actions model choices, dashboard settings, or login
state. The selected CLI must already be installed and authenticated. An unavailable
model fails through that CLI; there is no retry on a different harness. Receipt
`requested_model` records the request, not independent server-side model attestation.

## scope and safety

- Use a disposable, clean checkout and a reviewed skill. Existing uncommitted paths
  are included in the structural write check; this is not a per-run filesystem audit.
- Declared task credentials and default GitHub/Telegram tokens are synthetic;
  notifications use the existing capture mode. Model authentication remains real.
- This is **not** a complete security sandbox: undeclared environment credentials,
  SSH/git helpers, local CLI profiles and MCP connections are not isolated by fake
  tokens. Do not use it to execute an untrusted skill on a credentialed workstation.
- Capability mode and tool permissions come from `skill_mode.sh` (including nested
  `metadata.mode`). Read-only requires the dispatcher's OS sandbox; missing support
  fails closed. A parent sandbox can reject nested `sandbox-exec`; do not disable
  the read-only wrapper to make a test pass.
- `DRYRUN_TIMEOUT` defaults to 300 seconds and requires `timeout` or `gtimeout`.
- Exit zero alone is insufficient: the result must be non-empty, the envelope must
  be valid, and raw-output wrapper fallbacks are rejected. Structural checks still
  do not establish semantic task completion or prove absence of secret access.
- The existing explicit `SKILL_DRYRUN=0` bypass remains; its receipt says `skipped`.

The JSON receipt is at `output/.dry-run/<skill>.json` (or `DRYRUN_VERDICT`, relative
to the checkout unless absolute). It includes harness, requested model, exit code,
elapsed time, result character count and reason. Stdout/stderr are captured in the
private temporary directory printed at startup. Treat those files as private: inspect
locally when diagnosing a failure, never commit them or publish them without review.

## verification - 2026-09-05

The existing CI step invokes `scripts/tests/test_dry_run.sh`; that test now invokes
`test_dry_run_dispatch.sh` too. Offline tests use the real dry-run and mode/requires
helpers with a deliberately stubbed dispatcher: they do not spend model credits.

Local checks: 19 primitive assertions and 35 dispatch assertions pass. `bash -n`
and `git diff --check` pass. ShellCheck is not installed in the test environment;
no ShellCheck or GitHub CI pass is claimed before publishing this branch.

Mutation checks, one source change at a time:

| mutation | observed test failure |
| --- | --- |
| remove `args+=(--model "$model")` | `FAIL: grep -qx -- --model output/args` |
| restore old `skill_mode.sh <skill>` call / fallback | `FAIL: grep -q Bash(./notify: output/args` |
| remove rejection of `rh-wrap-fallback:` | `FAIL: expected rejection` on the wrapped-output case |

All three mutations were restored before rerunning the full green suite.

Real local probes used the actual dispatcher, adapters, installed CLIs and existing
logins in an isolated fixture, with `mode: read-only`, no task credentials, no tools
requested, and a 90-second ceiling. Both returned exactly
`AEON_DRYRUN_ROUTING_OK_20260905`:

```text
dry-run: harness=codex model=gpt-6-astra mode=read-only timeout=90s
dry-run: harness=codex exit=0 elapsed=11s result_chars=31 reason=ok
dry-run: harness=claude model=sonnet mode=read-only timeout=90s
dry-run: harness=claude exit=0 elapsed=41s result_chars=31 reason=ok
```

Earlier attempts are not hidden: empty requirements first triggered Bash 3.2's
`keys[@]: unbound variable`; after that correction, requirements-to-JSON conversion
also needed a newline for an empty list. Both cases have regression coverage. The
parent execution sandbox rejected the first nested sandbox attempt with exit 71,
`sandbox-exec: sandbox_apply: Operation not permitted`. An approved execution outside
that parent sandbox succeeded **with Aeon's read-only wrapper still enabled**.

These probes prove live routing and responses, not game acceptance, self-healing,
CI authentication or the cause of the previous arena skill's 180-second timeout.
