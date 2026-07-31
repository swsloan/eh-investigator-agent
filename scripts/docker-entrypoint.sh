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

# Non-root worker runtime (#97). When worker isolation is enabled (EH_WORKER_UID
# set — the hardened profile), the control plane spawns the agent lowered to that
# UID. Hand the agent-writable volumes (session workspaces + the re-homed Pi/Claude
# auth dirs) to the worker, and keep the secret/config store (/app/data) root-only
# so the worker cannot read secrets.json. Fail CLOSED: if the chown cannot be done
# we refuse to start rather than silently run the agent as root without the boundary.
# No-op in the default local profile (variable unset).
prepare_worker_runtime() {
  local uid="${EH_WORKER_UID:-}"
  [[ -n "$uid" ]] || return 0
  local gid="${EH_WORKER_GID:-$uid}"
  local home="${EH_WORKER_HOME:-/home/worker}"

  if [[ "$(id -u)" != "0" ]]; then
    log "FATAL: worker isolation is enabled (EH_WORKER_UID=$uid) but the entrypoint is not root; cannot establish the non-root boundary. Refusing to start."
    exit 1
  fi

  log "Worker isolation enabled (uid=$uid gid=$gid); preparing agent-writable volumes"
  # Secrets/config stay root-only; the worker must never read them.
  chmod 700 "$ROOT_DIR/data" 2>/dev/null || true

  local d
  for d in "$ROOT_DIR/workspaces" "$home/.claude" "$home/.pi"; do
    if ! mkdir -p "$d" || ! chown -R "$uid:$gid" "$d"; then
      log "FATAL: could not prepare the non-root worker runtime (chown $d failed). Refusing to start."
      exit 1
    fi
  done
}

install_custom_ca || exit 1
prepare_worker_runtime

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
