#!/usr/bin/env bash
# Regression test for chain-runner's run-name correlation.
# Two same-skill dispatches must resolve their own runs when GitHub lists both.
set -uo pipefail

WORKFLOW="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.github/workflows/chain-runner.yml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

pass=0
fail=0
ok() { pass=$((pass + 1)); }
no() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }

# The fake CLI records dispatches and returns both runs in reverse order.
cat > "$TMP/bin/gh" <<'FAKE_GH'
#!/usr/bin/env bash
set -euo pipefail
STATE=${FAKE_GH_STATE:?}

if [ "${1:-} ${2:-}" = "workflow run" ]; then
  shift 2
  skill=''
  var=''
  dispatch_id=''
  while [ "$#" -gt 0 ]; do
    if [ "$1" = '-f' ]; then
      key=${2%%=*}
      value=${2#*=}
      case "$key" in
        skill) skill=$value ;;
        var) var=$value ;;
        dispatch_id) dispatch_id=$value ;;
      esac
      shift 2
    else
      shift
    fi
  done
  printf '%s\t%s\t%s\n' "$skill" "$var" "$dispatch_id" >> "$STATE"
  exit 0
fi

if [ "${1:-} ${2:-}" = "run list" ]; then
  # Make each poll observe the two concurrent dispatches, regardless of order.
  for _ in $(seq 1 100); do
    [ "$(wc -l < "$STATE" | tr -d ' ')" -ge 2 ] && break
    sleep 0.01
  done
  rows=()
  while IFS= read -r row; do
    rows+=("$row")
  done < "$STATE"
  entries=()
  for ((i=${#rows[@]} - 1; i >= 0; i--)); do
    IFS=$'\t' read -r skill var dispatch_id <<< "${rows[$i]}"
    case "$skill:$var" in
      digest:alpha) db_id=1001 ;;
      digest:beta) db_id=1002 ;;
      *) db_id=1999 ;;
    esac
    entries+=("$(jq -cn --arg id "$db_id" --arg skill "$skill" --arg var "$var" \
      --arg dispatch_id "$dispatch_id" \
      '{databaseId:($id|tonumber), displayTitle:("skill: "+$skill+" ("+$var+") [dispatch: "+$dispatch_id+"]"), createdAt:"2099-01-01T00:00:00Z"}')")
  done
  printf '%s\n' "${entries[@]}" | jq -s .
  exit 0
fi

printf 'unexpected fake gh invocation: %s\n' "$*" >&2
exit 2
FAKE_GH
chmod +x "$TMP/bin/gh"

# Execute the workflow's actual helper rather than a duplicate test implementation.
sed -n '/^          dispatch_skill() {/,/^          }$/p' "$WORKFLOW" | sed 's/^          //' > "$TMP/dispatch-helper.sh"
# The helper's polling delay is irrelevant to this deterministic fake.
sleep() { :; }
# shellcheck source=/dev/null
source "$TMP/dispatch-helper.sh"

export PATH="$TMP/bin:$PATH"
export FAKE_GH_STATE="$TMP/dispatches"
: > "$FAKE_GH_STATE"
export GITHUB_RUN_ID=4242
export GITHUB_RUN_ATTEMPT=1

dispatch_skill digest alpha > "$TMP/alpha.out" &
alpha_pid=$!
dispatch_skill digest beta > "$TMP/beta.out" &
beta_pid=$!
wait "$alpha_pid" || no 'alpha dispatch failed'
wait "$beta_pid" || no 'beta dispatch failed'

alpha_id=$(tail -n 1 "$TMP/alpha.out")
beta_id=$(tail -n 1 "$TMP/beta.out")
[ "$alpha_id" = 1001 ] && ok || no "alpha resolved wrong run: $alpha_id"
[ "$beta_id" = 1002 ] && ok || no "beta resolved wrong run: $beta_id"

ids=$(cut -f3 "$FAKE_GH_STATE")
[ "$(printf '%s\n' "$ids" | sort -u | wc -l | tr -d ' ')" = 2 ] && ok || no 'dispatch IDs were not unique'
while IFS= read -r id; do
  [[ "$id" =~ ^chain-[0-9a-f]{32}$ ]] && ok || no "dispatch ID was not shell-safe and bounded: $id"
done <<< "$ids"

printf '\nchain-runner correlation: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
