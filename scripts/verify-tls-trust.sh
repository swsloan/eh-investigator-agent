#!/usr/bin/env bash
# Verifies the excli (Go) half of the TLS trust matrix in docs/SECURITY-HARDENING.md.
#
# The Node half runs in CI as lib/tls-trust.test.js. excli cannot: bin/excli is
# fetched at image-build time and is not in the working tree, so this half needs
# a built image.
#
# Run it in a DISPOSABLE container — installing a CA runs update-ca-certificates
# and mutates the image's trust store:
#
#   docker run --rm --entrypoint bash eh-investigator-agent:local \
#     /app/scripts/verify-tls-trust.sh
#
# Method: point excli at a local stub presenting a certificate issued by a
# throwaway private CA, with a dummy API key. The TLS handshake happens before
# authentication, so a TLS error means verification rejected the peer, while an
# HTTP 401 from the stub means the handshake completed. No appliance, no
# credentials, no network.
set -uo pipefail

APP_DIR="${APP_DIR:-/app}"
EXCLI="$APP_DIR/bin/excli"
PORT=8443
WORK="$(mktemp -d)"
STUB_PID=""
FAILURES=0

# Invoked indirectly by the EXIT trap below, which ShellCheck cannot see. Older
# versions flag the body as unreachable (SC2317), newer ones flag the function
# as uncalled (SC2329); suppress both so this lints the same in CI and locally.
# shellcheck disable=SC2317,SC2329
cleanup() {
  [[ -n "$STUB_PID" ]] && kill "$STUB_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n       expected: %s\n       actual:   %s\n' "$1" "$2" "$3"; FAILURES=$((FAILURES + 1)); }

# Assert that running excli under the given environment produces output matching
# the expected pattern.
expect_excli() {
  local label="$1" pattern="$2" desc="$3"; shift 3
  local out
  out="$(env "$@" EXTRAHOP_HOST="127.0.0.1:$PORT" EXTRAHOP_API_KEY=dummy-key \
    "$EXCLI" search_detections -json '{"from":-3600000,"limit":1}' 2>&1 | tr '\n' ' ')"
  if [[ "$out" =~ $pattern ]]; then pass "$label"; else fail "$label" "$desc" "$out"; fi
}

[[ -x "$EXCLI" ]] || { echo "ERROR: $EXCLI not found or not executable — run this inside a built image."; exit 1; }

bash "$APP_DIR/scripts/make-test-ca.sh" "$WORK" 127.0.0.1

# Stub appliance. Note it logs only to stdout: a handler that wrote to a file
# under $WORK would crash the stub once cleanup removed the directory.
cat > "$WORK/stub.js" <<'STUB'
const fs = require('fs');
const https = require('https');
const dir = process.argv[2];
https
  .createServer(
    { key: fs.readFileSync(`${dir}/leaf.key`), cert: fs.readFileSync(`${dir}/leaf.crt`) },
    (req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'stub-unauthorized' }));
    },
  )
  .on('tlsClientError', (e) => console.log(`tlsClientError: ${e.code || e.message}`))
  .listen(Number(process.argv[3]), '127.0.0.1', () => console.log('stub listening'));
STUB

node "$WORK/stub.js" "$WORK" "$PORT" > "$WORK/stub.log" 2>&1 &
STUB_PID=$!

for _ in $(seq 1 30); do
  grep -q 'stub listening' "$WORK/stub.log" 2>/dev/null && break
  sleep 0.2
done
grep -q 'stub listening' "$WORK/stub.log" || { echo "ERROR: stub server failed to start"; cat "$WORK/stub.log"; exit 1; }

echo "excli TLS trust:"

expect_excli "untrusted CA fails closed" \
  'unknown authority|certificate' \
  'a TLS verification error' \
  EH_UNUSED=1

expect_excli "insecure override connects" \
  '401' \
  'HTTP 401 from the stub' \
  EXTRAHOP_INSECURE=true

# The shipped entrypoint installs the CA and exports SSL_CERT_FILE, then execs
# its arguments — so running excli through it tests the real deployment path.
out="$(EH_CUSTOM_CA_CERT="$WORK/ca.crt" EXTRAHOP_HOST="127.0.0.1:$PORT" EXTRAHOP_API_KEY=dummy-key \
  "$APP_DIR/scripts/docker-entrypoint.sh" \
  "$EXCLI" search_detections -json '{"from":-3600000,"limit":1}' 2>&1 | tr '\n' ' ')"
if [[ "$out" =~ 401 ]]; then
  pass "private CA honoured via entrypoint (SSL_CERT_FILE)"
else
  fail "private CA honoured via entrypoint (SSL_CERT_FILE)" 'HTTP 401 from the stub' "$out"
fi

echo "entrypoint CA misconfiguration:"

: > "$WORK/empty.crt"
for case_ in "missing:$WORK/nope.crt" "empty:$WORK/empty.crt"; do
  label="${case_%%:*}"; certpath="${case_#*:}"
  if EH_CUSTOM_CA_CERT="$certpath" "$APP_DIR/scripts/docker-entrypoint.sh" true >/dev/null 2>&1; then
    fail "$label CA aborts startup" 'non-zero exit' 'exit 0 — startup continued'
  else
    pass "$label CA aborts startup"
  fi
done

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "All excli TLS trust checks passed."
else
  echo "$FAILURES check(s) failed."
fi
exit "$FAILURES"
