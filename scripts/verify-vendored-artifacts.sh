#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor/excli"
CHECKSUMS="$VENDOR_DIR/excli_0.0.107-c8d63d1bce_checksums.txt"

[[ -f "$CHECKSUMS" ]] || { printf 'Missing checksum manifest: %s\n' "$CHECKSUMS" >&2; exit 1; }

shopt -s nullglob
artifacts=("$VENDOR_DIR"/excli-*.tar.gz "$VENDOR_DIR"/excli-*.exe)
shopt -u nullglob
[[ "${#artifacts[@]}" -gt 0 ]] || { printf 'No vendored excli artifacts found.\n' >&2; exit 1; }

for artifact in "${artifacts[@]}"; do
  filename="$(basename "$artifact")"
  expected="$(awk -v filename="$filename" '$2 == filename || $2 == "*" filename { print $1; exit }' "$CHECKSUMS")"
  [[ -n "$expected" ]] || { printf 'No checksum entry for %s\n' "$filename" >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$artifact" | awk '{ print $1 }')"
  else
    actual="$(shasum -a 256 "$artifact" | awk '{ print $1 }')"
  fi
  [[ "$actual" == "$expected" ]] || { printf 'Checksum mismatch for %s\n' "$filename" >&2; exit 1; }
  printf 'Verified %s\n' "$filename"
done
