#!/usr/bin/env bash
# Tests for scripts/secretcurl.sh. Run: bash scripts/tests/test_secretcurl.sh
#
# secretcurl exists to keep secret values off any command line an external
# observer (ps, /proc/<pid>/cmdline) could read. Substituting {ENV_NAME} inside
# this script was only half of that -- the substituted value still had to reach
# curl somehow, and handing it to curl as an argv element puts it right back in
# curl's OWN process argv. These tests check the actual curl subprocess argv,
# not just secretcurl's own behaviour, since that subprocess is the exposure
# surface this fix closes. All requests go to a local echo server -- no network
# dependency, no flakiness.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
S="./scripts/secretcurl.sh"
fail=0
pass() { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fail=1; }

export TEST_SECRETCURL_API_KEY='marker-secret-do-not-leak\"quote'

PORT=$((20000 + RANDOM % 20000))
ECHO_SRV=$(mktemp)
cat > "$ECHO_SRV" <<'PYEOF'
import http.server, json, sys
class H(http.server.BaseHTTPRequestHandler):
    def _reply(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8', 'replace') if length else ''
        payload = json.dumps({'headers': dict(self.headers), 'body': body}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def do_GET(self):
        if self.path == '/slow-enough':
            open(sys.argv[2], 'w').close()
            import time; time.sleep(2)
        self._reply()
    def do_POST(self): self._reply()
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
PYEOF
MARKER=$(mktemp -u)
rm -f "$MARKER"
python3 "$ECHO_SRV" "$PORT" "$MARKER" &
SRV_PID=$!
cleanup() { kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; rm -f "$ECHO_SRV" "$MARKER"; }
trap cleanup EXIT
for _ in 1 2 3 4 5; do
  curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/" && break
  sleep 0.2
done

# --- argv exposure: the real gap this fix closes ----------------------------
# The server touches $MARKER the instant it starts handling /slow-enough, then
# blocks for 2s before replying -- so once the marker exists, the curl process
# handling this request is guaranteed to still be alive and blocked server-side,
# with no race between "request sent" and "ps snapshot taken".
"$S" -s -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/slow-enough" \
  -H "Authorization: Bearer {TEST_SECRETCURL_API_KEY}" &
SC_PID=$!
for _ in $(seq 1 50); do [ -e "$MARKER" ] && break; sleep 0.1; done
SNAPSHOT=$(ps -ef 2>/dev/null || ps aux 2>/dev/null)
wait "$SC_PID" 2>/dev/null

if printf '%s' "$SNAPSHOT" | grep -q 'marker-secret-do-not-leak'; then
  bad "secret value must not appear in any process argv (found: $(printf '%s' "$SNAPSHOT" | grep 'marker-secret' | head -1))"
else
  pass "secret value does not appear in any process argv while the request is in flight"
fi
if printf '%s' "$SNAPSHOT" | grep -q '[c]url -K -'; then
  pass "curl subprocess invoked via -K (config on stdin), not inline args"
else
  bad "expected a 'curl -K -' subprocess in the ps snapshot (got: $(printf '%s' "$SNAPSHOT" | grep '[c]url'))"
fi

# --- functional correctness: substitution, headers, and -d @file all still work
OUT=$(mktemp)
"$S" -s -o "$OUT" --max-time 5 "http://127.0.0.1:$PORT/hdr" \
  -H "Authorization: Bearer {TEST_SECRETCURL_API_KEY}"
RESP=$(cat "$OUT")
case "$RESP" in
  *'marker-secret-do-not-leak\\\"quote'*) pass "substituted secret (incl. backslash+quote) reaches curl and the server intact" ;;
  *) bad "substituted header value did not round-trip intact (got: $RESP)" ;;
esac

PAYLOAD_FILE=$(mktemp)
printf '{"k":"v","n":1}' > "$PAYLOAD_FILE"
"$S" -s -o "$OUT" --max-time 5 -X POST "http://127.0.0.1:$PORT/body" -d "@$PAYLOAD_FILE"
case "$(cat "$OUT")" in
  *'{\"k\": \"v\", \"n\": 1}'*|*'{\"k\":\"v\",\"n\":1}'*) pass "'-d @file' still reads payload from file through -K" ;;
  *) bad "'-d @file' payload did not reach the server (got: $(cat "$OUT"))" ;;
esac
rm -f "$PAYLOAD_FILE"

"$S" -s -o "$OUT" --max-time 5 -X POST "http://127.0.0.1:$PORT/body" -d '{"inline":true}'
case "$(cat "$OUT")" in
  *'inline'*) pass "inline -d JSON payload still reaches the server" ;;
  *) bad "inline -d payload did not reach the server (got: $(cat "$OUT"))" ;;
esac
rm -f "$OUT"

# --- exit-code fidelity: a real curl failure still propagates -------------
"$S" -s -o /dev/null --max-time 2 "http://127.0.0.1:1/refused" >/dev/null 2>&1
RC=$?
[ "$RC" -ne 0 ] && pass "curl failure (connection refused) propagates as a real non-zero exit" \
  || bad "expected non-zero exit against a closed port, got 0"

# --- unclassifiable argument is refused, not silently mishandled -----------
ERR=$("$S" "bare-non-flag-non-url" 2>&1 >/dev/null)
RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$ERR" | grep -q "cannot classify"; then
  pass "an argument that is neither a flag nor a URL is refused, not guessed at"
else
  bad "expected a 'cannot classify' refusal for an unclassifiable argument (rc=$RC, err=$ERR)"
fi

echo "---"
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
