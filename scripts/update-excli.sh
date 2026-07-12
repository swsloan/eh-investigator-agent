#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

EXCLI_INTERFACE="$ROOT_DIR/excli-interface"
EXCLI_BINARY="$ROOT_DIR/bin/excli"
LEGACY_EXCLI_WRAPPER="$ROOT_DIR/excli"
LEGACY_EXCLI_REAL="$ROOT_DIR/bin/excli-real"
BACKUP_DIR="$ROOT_DIR/bin/backups"
CREATE_BACKUP=1
SOURCE=""

usage() {
  cat <<'USAGE'
Usage: ./scripts/update-excli.sh [options] [path-or-url]

Replaces only bin/excli. The ./excli-interface broker interface is left intact.

To update the release bundled with the package, replace the vendor/excli/
directory with the new CLI release drop instead; bootstrap and this script
both select the right archive from it for this machine.

Inputs, in priority order:
  [path-or-url]                       Direct excli binary, excli archive,
                                      release directory of archives, or URL
  EXCLI_PATH=/path/to/excli
  EXCLI_ARCHIVE=/path/to/excli-*.tar.gz
  EXCLI_URL=https://.../excli-*.tar.gz

Options:
  --no-backup                         Do not save the current bin/excli
  --backup-dir /path/to/dir           Override backup location
  -h, --help                          Show this help

Examples:
  ./scripts/update-excli.sh ~/Downloads/excli
  ./scripts/update-excli.sh ~/Downloads/excli-darwin-arm64-0.0.108.tar.gz
  ./scripts/update-excli.sh ~/Downloads/excli-release-drop/
  ./scripts/update-excli.sh vendor/excli
  EXCLI_URL=https://internal.example/excli-linux-amd64.tar.gz ./scripts/update-excli.sh
USAGE
}

log() {
  printf '\n==> %s\n' "$*" >&2
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-backup)
      CREATE_BACKUP=0
      ;;
    --backup-dir)
      shift
      [[ $# -gt 0 ]] || die "--backup-dir requires a path."
      BACKUP_DIR="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      die "Unknown option: $1"
      ;;
    *)
      [[ -z "$SOURCE" ]] || die "Only one path-or-url input is allowed."
      SOURCE="$1"
      ;;
  esac
  shift
done

if [[ -z "$SOURCE" && -n "${EXCLI_PATH:-}" ]]; then
  SOURCE="$EXCLI_PATH"
fi
if [[ -z "$SOURCE" && -n "${EXCLI_ARCHIVE:-}" ]]; then
  SOURCE="$EXCLI_ARCHIVE"
fi
if [[ -z "$SOURCE" && -n "${EXCLI_URL:-}" ]]; then
  SOURCE="$EXCLI_URL"
fi
[[ -n "$SOURCE" ]] || die "Provide a path/URL or set EXCLI_PATH, EXCLI_ARCHIVE, or EXCLI_URL."

is_excli_interface() {
  [[ -f "$EXCLI_INTERFACE" ]] && grep -q 'EH_EXCLI_BROKER_SOCKET' "$EXCLI_INTERFACE" 2>/dev/null
}

is_legacy_excli_wrapper() {
  [[ -f "$LEGACY_EXCLI_WRAPPER" ]] && grep -q 'EH_EXCLI_BROKER_SOCKET' "$LEGACY_EXCLI_WRAPPER" 2>/dev/null
}

if [[ ! -f "$EXCLI_INTERFACE" && -f "$LEGACY_EXCLI_WRAPPER" ]] && is_legacy_excli_wrapper; then
  log "Renaming legacy root ./excli wrapper to ./excli-interface"
  mv "$LEGACY_EXCLI_WRAPPER" "$EXCLI_INTERFACE"
fi

if [[ ! -x "$EXCLI_BINARY" && -x "$LEGACY_EXCLI_REAL" ]]; then
  log "Renaming legacy bin/excli-real binary to bin/excli"
  mv "$LEGACY_EXCLI_REAL" "$EXCLI_BINARY"
fi

if [[ ! -x "$EXCLI_BINARY" && -x "$LEGACY_EXCLI_WRAPPER" ]] && ! is_legacy_excli_wrapper; then
  log "Moving existing root excli binary to bin/excli"
  mkdir -p "$ROOT_DIR/bin"
  mv "$LEGACY_EXCLI_WRAPPER" "$EXCLI_BINARY"
fi

if [[ -f "$LEGACY_EXCLI_WRAPPER" ]] && is_legacy_excli_wrapper; then
  log "Removing legacy root ./excli wrapper"
  rm -f "$LEGACY_EXCLI_WRAPPER"
fi

[[ -f "$EXCLI_INTERFACE" ]] || die "./excli-interface is missing."
is_excli_interface || die "./excli-interface is not the broker interface. Restore it before replacing bin/excli."

TMP_DIR="$(mktemp -d)"
TMP_INSTALL=""
cleanup() {
  rm -rf "$TMP_DIR"
  if [[ -n "$TMP_INSTALL" ]]; then
    rm -f "$TMP_INSTALL"
  fi
}
trap cleanup EXIT

download_source() {
  local url="$1"
  local out="$TMP_DIR/excli-download"
  log "Downloading excli"
  if have curl; then
    curl -fsSL "$url" -o "$out"
  elif have wget; then
    wget -qO "$out" "$url"
  else
    die "Install curl or wget, or use a local EXCLI_PATH/EXCLI_ARCHIVE."
  fi
  printf '%s\n' "$out"
}

verify_excli_checksum() {
  # Release drops ship a sha256 checksums file next to the archives; verify
  # against it when the archive has an entry there.
  local archive="$1"
  local dir base sums expected actual
  dir="$(dirname "$archive")"
  base="$(basename "$archive")"
  shopt -s nullglob
  local sums_files=( "$dir"/excli*checksums*.txt )
  shopt -u nullglob
  [[ "${#sums_files[@]}" -gt 0 ]] || return 0
  sums="${sums_files[0]}"
  expected="$(awk -v f="$base" '$2 == f || $2 == "*" f { print $1; exit }' "$sums")"
  [[ -n "$expected" ]] || return 0
  if have sha256sum; then
    actual="$(sha256sum "$archive" | awk '{ print $1 }')"
  elif have shasum; then
    actual="$(shasum -a 256 "$archive" | awk '{ print $1 }')"
  else
    return 0
  fi
  [[ "$actual" == "$expected" ]] || die "Checksum mismatch for $base against $(basename "$sums"). Replace the archive and rerun."
  log "Verified checksum for $base"
}

host_platform() {
  local sys arch
  sys="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="amd64" ;;
  esac
  printf '%s-%s\n' "$sys" "$arch"
}

candidate_from_release_dir() {
  local dir="$1"
  shopt -s nullglob
  local matches=( "$dir"/excli-"$(host_platform)"-*.tar.gz )
  shopt -u nullglob
  [[ "${#matches[@]}" -gt 0 ]] || die "Release directory has no excli archive for this platform ($(host_platform)): $dir"
  candidate_from_archive "${matches[0]}"
}

candidate_from_archive() {
  local archive="$1"
  verify_excli_checksum "$archive"
  local extract_dir="$TMP_DIR/archive"
  mkdir -p "$extract_dir"
  tar -xzf "$archive" -C "$extract_dir"
  local found
  found="$(find "$extract_dir" -type f -name excli -perm -111 -print -quit)"
  if [[ -z "$found" ]]; then
    found="$(find "$extract_dir" -type f -name excli -print -quit)"
  fi
  [[ -n "$found" ]] || die "Archive did not contain an excli executable: $archive"
  printf '%s\n' "$found"
}

candidate_from_source() {
  local source="$1"
  local local_source="$source"
  if [[ "$source" =~ ^https?:// ]]; then
    local_source="$(download_source "$source")"
  fi
  if [[ -d "$local_source" ]]; then
    candidate_from_release_dir "$local_source"
    return
  fi
  [[ -f "$local_source" ]] || die "excli source does not exist: $local_source"
  if tar -tzf "$local_source" >/dev/null 2>&1; then
    candidate_from_archive "$local_source"
  else
    printf '%s\n' "$local_source"
  fi
}

clear_quarantine() {
  local file="$1"
  if [[ "$(uname -s)" == "Darwin" ]] && have xattr; then
    xattr -dr com.apple.quarantine "$file" 2>/dev/null || true
  fi
}

probe_version() {
  local file="$1"
  local version=""
  version="$("$file" -version 2>/dev/null | head -1 || true)"
  if [[ -z "$version" ]]; then
    version="$("$file" --version 2>/dev/null | head -1 || true)"
  fi
  printf '%s\n' "$version"
}

validate_candidate() {
  local file="$1"
  chmod 0755 "$file" 2>/dev/null || true
  clear_quarantine "$file"
  "$file" -help >/dev/null || die "Candidate excli failed '-help'; refusing to install it."
}

CANDIDATE="$(candidate_from_source "$SOURCE")"
validate_candidate "$CANDIDATE"
VERSION="$(probe_version "$CANDIDATE")"

mkdir -p "$ROOT_DIR/bin"
if [[ "$CREATE_BACKUP" -eq 1 && -e "$EXCLI_BINARY" ]]; then
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/excli-$(date +%Y%m%d-%H%M%S)"
  cp -p "$EXCLI_BINARY" "$BACKUP_FILE"
  log "Backed up current binary to ${BACKUP_FILE#$ROOT_DIR/}"
fi

TMP_INSTALL="$(mktemp "$ROOT_DIR/bin/excli.XXXXXX")"
cp "$CANDIDATE" "$TMP_INSTALL"
chmod 0755 "$TMP_INSTALL"
clear_quarantine "$TMP_INSTALL"
mv "$TMP_INSTALL" "$EXCLI_BINARY"
TMP_INSTALL=""

log "Installed ${EXCLI_BINARY#$ROOT_DIR/}"
if [[ -n "$VERSION" ]]; then
  printf 'Detected version: %s\n' "$VERSION"
fi
printf 'The ./excli-interface broker interface was not changed.\n'
