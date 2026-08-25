# shellcheck shell=bash
# schema-retry.sh — structured output for harnesses without a --json-schema flag
# (opencode, pi). Prompt-with-schema + pragmatic validation + one retry — the
# same pattern aeon's post-run scorer uses.
#
# "Pragmatic" validation: full JSON Schema validation in bash is unrealistic;
# we check (a) the text parses as a single JSON value, (b) top-level `type`
# matches if declared, (c) all `required` keys exist. That catches the failure
# modes that actually occur (prose, fences, missing fields).

schema_prompt_suffix() {
  # schema_prompt_suffix SCHEMA -> text to append to the prompt
  printf '\n\nRespond with ONLY a single JSON value that validates against this JSON Schema. No prose, no markdown fences, nothing before or after the JSON:\n%s\n' "$1"
}

schema_retry_suffix() {
  printf '\n\nYour previous response was NOT valid against the schema. Respond again with ONLY the JSON value — no explanation, no fences.'
}

schema_extract_json() {
  # Recover the JSON value from whatever the model actually emitted. Ordered
  # cheapest-first; each step is only taken if the previous output isn't already
  # parseable, so a clean response is passed through untouched.
  local text="$1" cand pat
  jq -e . >/dev/null 2>&1 <<<"$text" && { printf '%s' "$text"; return; }

  # 1. markdown fences — ANYWHERE, not just alone on a line. (The previous
  #    version anchored to whole lines with ^...$, so ```json immediately
  #    followed by the object on the same line survived and broke parsing.)
  text=$(sed -e 's/```[a-zA-Z]*//g' <<<"$text")
  jq -e . >/dev/null 2>&1 <<<"$text" && { printf '%s' "$text"; return; }

  # 2. Prose around the JSON. Models do this constantly despite being told not
  #    to — opencode prefaces with "I'll read the skill definition and execute
  #    it." and only then emits the object. Take the widest {...} / [...] span
  #    and let schema_validate be the judge. Newlines are swapped for \036 so
  #    grep's `.` spans lines, then restored. Same flatten-and-grab aeon's own
  #    post-run scorer uses on model JSON.
  for pat in '{.*}' '\[.*\]'; do
    cand=$(printf '%s' "$text" | tr '\n' '\036' | grep -o "$pat" | head -1 | tr '\036' '\n')
    [ -n "$cand" ] && jq -e . >/dev/null 2>&1 <<<"$cand" && { printf '%s' "$cand"; return; }
  done

  printf '%s' "$text"   # nothing extractable — let schema_validate fail loudly
}

schema_validate() {
  # schema_validate SCHEMA TEXT -> exit 0 iff TEXT pragmatically satisfies SCHEMA
  local schema="$1" text="$2" want_type req k
  jq -e . >/dev/null 2>&1 <<<"$text" || return 1
  want_type=$(jq -r '.type // empty' <<<"$schema" 2>/dev/null)
  if [ -n "$want_type" ] && [ "$want_type" != "null" ]; then
    jq -e --arg t "$want_type" '
      (type) as $got |
      ($t == $got) or ($t == "integer" and $got == "number")' >/dev/null 2>&1 <<<"$text" || return 1
  fi
  req=$(jq -r '.required // [] | .[]' <<<"$schema" 2>/dev/null)
  for k in $req; do
    jq -e --arg k "$k" 'type == "object" and has($k)' >/dev/null 2>&1 <<<"$text" || return 1
  done
  return 0
}
