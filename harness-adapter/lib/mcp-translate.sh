# mcp-translate.sh — translate a Claude-style project .mcp.json for harnesses
# that don't read it natively.
#
#   claude   — reads it via --mcp-config (no translation)
#   grok     — discovers it natively incl. ${VAR} expansion (only needs allow rules)
#   codex    — no project .mcp.json support (openai/codex#13056): -> -c overrides
#   opencode — own config shape: -> "mcp" object for a generated opencode.json
#   pi       — rejects MCP by design: adapter warns and skips

mcp_expand_vars() {
  # mcp_expand_vars IN OUT — expand ${VAR} refs from the environment into OUT.
  # Unset vars are LEFT AS-IS (unlike envsubst, which silently empties them);
  # their names are printed one per line so callers can warn.
  # Caveat: values containing double quotes would corrupt the JSON — secrets
  # virtually never do, but it's worth knowing.
  local in="$1" out="$2"
  perl -pe 's/\$\{([A-Z_][A-Z0-9_]*)\}/defined $ENV{$1} ? $ENV{$1} : "\${$1}"/ge' \
    < "$in" > "$out"
  grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' "$out" 2>/dev/null | sed -E 's/[${}]//g' | sort -u || true
}

mcp_server_names() {
  jq -r '.mcpServers // {} | keys[]' "$1"
}

mcp_to_codex_flags() {
  # .mcp.json -> repeated `-c mcp_servers.<name>.<key>=<value>` overrides,
  # one argv token per line (read into an array with a while-read loop).
  # NOTE: codex parses -c values as TOML. JSON strings and arrays are valid TOML;
  # the env OBJECT is emitted as JSON and may need `key = value` inline-table
  # syntax on some codex versions — verify against your installed codex.
  #
  # Scalars and arrays round-trip as JSON because JSON strings/arrays ARE valid
  # TOML. OBJECTS do not: `{"Authorization":"Bearer x"}` is a JSON object, and
  # TOML wants an inline table `{ "Authorization" = "Bearer x" }` (`:` vs `=`).
  # Passing the JSON form makes codex refuse to load its config at all —
  #   Error loading config.toml: invalid type: string "{\"Authorization\":...}",
  #   expected a map in `mcp_servers.probe.http_headers`
  # — so the whole run dies before the model starts, not just MCP. Measured on
  # codex-cli 0.144.6 with an http server carrying an auth header (the shape
  # every real remote MCP server uses). Keys are emitted QUOTED so header names
  # like `X-Api-Key`, which are not TOML bare keys, stay valid.
  jq -r '
    def inline_table: "{ " + ([to_entries[] | "\(.key|tojson) = \(.value|tojson)"] | join(", ")) + " }";
    .mcpServers // {} | to_entries[] |
    .key as $k | .value as $s |
    ( if $s.command then
        ["mcp_servers.\($k).command=\($s.command | tojson)"]
        + (if $s.args then ["mcp_servers.\($k).args=\($s.args | tojson)"] else [] end)
        + (if $s.env then ["mcp_servers.\($k).env=\($s.env | inline_table)"] else [] end)
      elif $s.url then
        ["mcp_servers.\($k).url=\($s.url | tojson)"]
        + (if $s.headers then ["mcp_servers.\($k).http_headers=\($s.headers | inline_table)"] else [] end)
      else [] end
    ) | .[] | "-c", .' "$1"
}

mcp_to_vibe_toml() {
  # .mcp.json -> [[mcp_servers]] array-of-tables for Mistral Vibe's config.toml.
  # Vibe declares `mcp_servers = []` (an inline empty array); the adapter strips
  # that line before appending these tables, since TOML forbids extending an
  # inline-declared array with [[table]] syntax ("immutable namespace").
  # env/headers become TOML inline tables ({ K = "V" }), not JSON objects.
  jq -r '
    .mcpServers // {} | to_entries[] |
    (["", "[[mcp_servers]]", "name = \(.key|tojson)"] +
     ( if .value.command then
         ["transport = \"stdio\"", "command = \(.value.command|tojson)"]
         + (if .value.args then ["args = \(.value.args|tojson)"] else [] end)
         + (if .value.env then ["env = { \(.value.env|to_entries|map("\(.key) = \(.value|tojson)")|join(", ")) }"] else [] end)
       elif .value.url then
         ["transport = \"http\"", "url = \(.value.url|tojson)"]
         + (if .value.headers then ["headers = { \(.value.headers|to_entries|map("\(.key) = \(.value|tojson)")|join(", ")) }"] else [] end)
       else [] end)) | .[]' "$1"
}

mcp_to_opencode_json() {
  # .mcp.json -> the "mcp" object for a generated opencode.json.
  # stdio: {type:"local", command:[cmd, ...args], environment}; http: {type:"remote", url, headers}
  jq -c '
    (.mcpServers // {}) | to_entries | map(
      select(.value.command or .value.url) | {
        key: .key,
        value: (
          if .value.command then
            ({type: "local",
              command: ([.value.command] + (.value.args // [])),
              enabled: true}
             + (if .value.env then {environment: .value.env} else {} end))
          else
            ({type: "remote", url: .value.url, enabled: true}
             + (if .value.headers then {headers: .value.headers} else {} end))
          end)
      }) | from_entries' "$1"
}
