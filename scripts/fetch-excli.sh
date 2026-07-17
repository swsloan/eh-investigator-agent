#!/usr/bin/env bash
# Fetch the architecture-matched excli release from the pinned upstream source
# (vendor/excli/source.env) and verify it against the committed checksums, then
# install it to $1 (default bin/excli). We do not redistribute the binary —
# ExtraHop/agent-cli grants no redistribution rights — so it is downloaded at
# build/install time instead of being committed here.
#
# Usage: fetch-excli.sh [DEST]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor/excli"
# The pinned source config is committed static data, not resolvable at lint time.
# shellcheck source=vendor/excli/source.env disable=SC1091
. "$VENDOR_DIR/source.env"

DEST="${1:-$ROOT_DIR/bin/excli}"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="amd64" ;;
  *) echo "fetch-excli: unsupported CPU arch: $arch" >&2; exit 1 ;;
esac
case "$os" in
  linux|darwin) ;;
  *) echo "fetch-excli: unsupported OS: $os" >&2; exit 1 ;;
esac

archive="excli-${os}-${arch}-${EXCLI_VERSION}.tar.gz"
url="https://raw.githubusercontent.com/${EXCLI_REPO}/${EXCLI_COMMIT}/dist/${archive}"
checksums="$VENDOR_DIR/excli_${EXCLI_VERSION}_checksums.txt"

expected="$(awk -v f="$archive" '$2 == f { print $1; exit }' "$checksums")"
[[ -n "$expected" ]] || { echo "fetch-excli: no committed checksum for $archive in $(basename "$checksums")" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "fetch-excli: downloading $archive from ${EXCLI_REPO}@${EXCLI_COMMIT:0:12}" >&2
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp/$archive"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp/$archive" "$url"
else
  echo "fetch-excli: need curl or wget to download excli (or provide it via EXCLI_ARCHIVE/EXCLI_PATH)" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$archive" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$tmp/$archive" | awk '{print $1}')"
fi
[[ "$actual" == "$expected" ]] || {
  echo "fetch-excli: checksum mismatch for $archive" >&2
  echo "  expected $expected" >&2
  echo "  actual   $actual" >&2
  exit 1
}

tar -xzf "$tmp/$archive" -C "$tmp"
found="$(find "$tmp" -type f -name excli -perm -111 -print -quit)"
[[ -n "$found" ]] || found="$(find "$tmp" -type f -name excli -print -quit)"
[[ -n "$found" ]] || { echo "fetch-excli: archive contained no excli binary: $archive" >&2; exit 1; }

mkdir -p "$(dirname "$DEST")"
cp "$found" "$DEST"
chmod 0755 "$DEST"
echo "fetch-excli: installed excli ${EXCLI_VERSION} to ${DEST}" >&2
