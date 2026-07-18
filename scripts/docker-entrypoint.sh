#!/usr/bin/env bash
# Container startup helper. bin/excli is normally fetched at image-build time
# (see Dockerfile / scripts/fetch-excli.sh) from the pinned upstream source and
# checksum-verified. This only re-fetches if bin/excli is missing or can't run
# here (e.g. the image was built for a different arch than it's running on) —
# best-effort, needs network — then execs the CMD.
set -uo pipefail

ROOT_DIR="/app"
EXCLI_BINARY="$ROOT_DIR/bin/excli"

log() { printf '\n[entrypoint] %s\n' "$*"; }

install_custom_ca() {
  local source="${EH_CUSTOM_CA_CERT:-}"
  local target="/usr/local/share/ca-certificates/eh-investigator-custom-ca.crt"
  [[ -n "$source" ]] || return 0
  [[ -f "$source" && -s "$source" ]] || { log "ERROR: EH_CUSTOM_CA_CERT is missing or empty: $source"; return 1; }
  if [[ "$source" != "$target" ]]; then
    cp "$source" "$target"
  fi
  chmod 0644 "$target"
  update-ca-certificates >/dev/null
  export NODE_EXTRA_CA_CERTS="$target"
  export SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"
  log "Installed the configured private CA for Node.js, excli, and system HTTPS clients."
}

excli_runs() {
  [[ -x "$EXCLI_BINARY" ]] && { "$EXCLI_BINARY" -version >/dev/null 2>&1 || "$EXCLI_BINARY" -help >/dev/null 2>&1; }
}

install_custom_ca || exit 1

if excli_runs; then
  log "excli ready ($("$EXCLI_BINARY" -version 2>/dev/null | head -n1 || echo present))"
else
  log "bin/excli missing or not runnable here — fetching for $(uname -m)"
  bash "$ROOT_DIR/scripts/fetch-excli.sh" "$EXCLI_BINARY" \
    || log "WARNING: excli unavailable (fetch failed — offline?); ExtraHop tool calls will fail until fixed."
fi

# Verify the Claude Agent SDK's arch-native CLI binary matches THIS machine. If
# the image was built for a different CPU arch, the Claude Code backend would
# otherwise fail only at the first agent turn; this surfaces it now (warns and
# continues — the Pi backend is unaffected).
node "$ROOT_DIR/scripts/check-claude-native.js" || true

exec "$@"
