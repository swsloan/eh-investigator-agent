#!/usr/bin/env bash
# Supply-chain check for excli: verify the PINNED upstream source against the
# committed checksums. The binaries are not redistributed in this repo (see
# vendor/excli/source.env); this fetches every release archive from the pinned
# commit and confirms its sha256 matches the committed trust anchor, so a bad
# pin or a tampered checksums file fails CI.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor/excli"
# The pinned source config is committed static data, not resolvable at lint time.
# shellcheck source=vendor/excli/source.env disable=SC1091
. "$VENDOR_DIR/source.env"

CHECKSUMS="$VENDOR_DIR/excli_${EXCLI_VERSION}_checksums.txt"
[[ -f "$CHECKSUMS" ]] || { printf 'Missing checksum manifest: %s\n' "$CHECKSUMS" >&2; exit 1; }

base_url="https://raw.githubusercontent.com/${EXCLI_REPO}/${EXCLI_COMMIT}/dist"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

count=0
while read -r expected filename; do
  [[ -n "${filename:-}" ]] || continue
  count=$((count + 1))
  curl -fsSL "$base_url/$filename" -o "$tmp/$filename"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$filename" | awk '{ print $1 }')"
  else
    actual="$(shasum -a 256 "$tmp/$filename" | awk '{ print $1 }')"
  fi
  [[ "$actual" == "$expected" ]] || {
    printf 'Checksum mismatch for %s (pinned source vs committed anchor)\n' "$filename" >&2
    exit 1
  }
  printf 'Verified %s against %s@%s\n' "$filename" "$EXCLI_REPO" "${EXCLI_COMMIT:0:12}"
done < "$CHECKSUMS"

[[ "$count" -gt 0 ]] || { printf 'No checksum entries in %s\n' "$CHECKSUMS" >&2; exit 1; }
printf 'All %d pinned excli artifacts verified against the committed checksums.\n' "$count"
