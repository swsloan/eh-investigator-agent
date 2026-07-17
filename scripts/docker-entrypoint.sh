#!/usr/bin/env bash
# Container startup helper. bin/excli is normally extracted at image-build time
# (see Dockerfile) from the platform archives bundled in vendor/excli/. This
# only re-extracts if bin/excli is missing or can't run here (e.g. the image
# was built for a different arch than it's running on), then execs the CMD.
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

install_excli_for_arch() {
  local arch exarch archive tmp found
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64) exarch=arm64 ;;
    x86_64|amd64)  exarch=amd64 ;;
    *) log "WARNING: unsupported arch $arch; cannot auto-select excli."; return 1 ;;
  esac
  # Loose drop-ins in vendor/ win over the bundled vendor/excli/ release.
  shopt -s nullglob
  local candidates=( "$ROOT_DIR"/vendor/excli-linux-"$exarch"-*.tar.gz "$ROOT_DIR"/vendor/excli/excli-linux-"$exarch"-*.tar.gz )
  shopt -u nullglob
  [[ "${#candidates[@]}" -gt 0 ]] || { log "WARNING: no excli-linux-$exarch archive found under vendor/."; return 1; }
  archive="${candidates[0]}"
  tmp="$(mktemp -d)"
  tar -xzf "$archive" -C "$tmp" 2>/dev/null
  found="$(find "$tmp" -type f -name excli -perm -111 -print -quit)"
  [[ -n "$found" ]] || found="$(find "$tmp" -type f -name excli -print -quit)"
  if [[ -z "$found" ]]; then
    log "WARNING: archive contained no excli executable: $archive"
    rm -rf "$tmp"; return 1
  fi
  mkdir -p "$ROOT_DIR/bin"
  cp "$found" "$EXCLI_BINARY"
  chmod 0755 "$EXCLI_BINARY"
  rm -rf "$tmp"
  log "Installed excli from $(basename "$archive")"
}

install_custom_ca || exit 1

if excli_runs; then
  log "excli ready ($("$EXCLI_BINARY" -version 2>/dev/null | head -n1 || echo present))"
else
  log "bin/excli missing or not runnable here — re-extracting for $(uname -m)"
  install_excli_for_arch || log "WARNING: excli unavailable; ExtraHop tool calls will fail until fixed."
fi

# Verify the Claude Agent SDK's arch-native CLI binary matches THIS machine. If
# the image was built for a different CPU arch, the Claude Code backend would
# otherwise fail only at the first agent turn; this surfaces it now (warns and
# continues — the Pi backend is unaffected).
node "$ROOT_DIR/scripts/check-claude-native.js" || true

exec "$@"
