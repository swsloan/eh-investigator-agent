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

validate_proxy_token() {
  local token="$1"
  [[ "$token" != "$LOCAL_DEFAULT" ]] || die "The hardened profile cannot use the local default proxy token."
  [[ "${#token}" -ge 32 ]] || die "EH_MEMORY_PROXY_TOKEN must contain at least 32 characters."
}

validate_auth_token() {
  local token="$1"
  [[ "${#token}" -ge 32 ]] || die "EH_AUTH_TOKEN must contain at least 32 characters."
}

# Ensure a token is available to compose for interpolation: prefer a value already
# exported in the environment; otherwise generate one once and persist it to the
# shared 0600 token file so it is stable across restarts.
ensure_token() {
  local key="$1" validator="$2" current
  current="$(printenv "$key" || true)"
  if [[ -n "$current" ]]; then
    "$validator" "$current"
    return
  fi
  if [[ -s "$TOKEN_ENV" ]] && grep -q "^${key}=" "$TOKEN_ENV"; then
    return  # already persisted from a prior run
  fi
  local token; token="$(generate_token)"
  "$validator" "$token"
  printf '%s=%s\n' "$key" "$token" >> "$TOKEN_ENV"
  printf 'Generated a persistent %s in %s\n' "$key" "$TOKEN_ENV" >&2
}

umask 077
mkdir -p "$RUNTIME_DIR"
touch "$TOKEN_ENV"
# The memory proxy token (graphiti sidecar -> app) and the UI/API auth token.
ensure_token EH_MEMORY_PROXY_TOKEN validate_proxy_token
ensure_token EH_AUTH_TOKEN validate_auth_token
chmod 0600 "$TOKEN_ENV" 2>/dev/null || true

compose_env=()
if [[ -f "$ROOT_DIR/.env" ]]; then
  compose_env+=(--env-file "$ROOT_DIR/.env")
fi
# Only load the generated token file when it exists. When EH_MEMORY_PROXY_TOKEN
# is supplied via the environment we deliberately don't write it, and Compose
# reads it straight from the shell env — passing --env-file for a missing file
# would make `docker compose` abort.
if [[ -s "$TOKEN_ENV" ]]; then
  compose_env+=(--env-file "$TOKEN_ENV")
fi

cd "$ROOT_DIR"
# ${arr[@]+"${arr[@]}"} expands to nothing when the array is empty, instead of
# tripping `set -u` on bash < 4.4 (e.g. macOS's default bash 3.2) when neither
# a .env nor a generated token file was added.
exec docker compose ${compose_env[@]+"${compose_env[@]}"} \
  -f docker-compose.yml \
  -f docker-compose.hardened.yml \
  "$@"
