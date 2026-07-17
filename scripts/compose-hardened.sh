#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
TOKEN_ENV="$RUNTIME_DIR/hardened.env"
LOCAL_DEFAULT="eh-memory-proxy-local"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

generate_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

validate_token() {
  local token="$1"
  [[ "$token" != "$LOCAL_DEFAULT" ]] || die "The hardened profile cannot use the local default proxy token."
  [[ "${#token}" -ge 32 ]] || die "The hardened proxy token must contain at least 32 characters."
}

umask 077
mkdir -p "$RUNTIME_DIR"

if [[ -n "${EH_MEMORY_PROXY_TOKEN:-}" ]]; then
  validate_token "$EH_MEMORY_PROXY_TOKEN"
elif [[ ! -s "$TOKEN_ENV" ]]; then
  token="$(generate_token)"
  validate_token "$token"
  printf 'EH_MEMORY_PROXY_TOKEN=%s\n' "$token" > "$TOKEN_ENV"
  printf 'Generated a persistent hardened proxy token in %s\n' "$TOKEN_ENV" >&2
fi

chmod 0600 "$TOKEN_ENV" 2>/dev/null || true

compose_env=()
if [[ -f "$ROOT_DIR/.env" ]]; then
  compose_env+=(--env-file "$ROOT_DIR/.env")
fi
compose_env+=(--env-file "$TOKEN_ENV")

cd "$ROOT_DIR"
exec docker compose "${compose_env[@]}" \
  -f docker-compose.yml \
  -f docker-compose.hardened.yml \
  "$@"
