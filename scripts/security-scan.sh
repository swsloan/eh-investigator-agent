#!/usr/bin/env bash
set -euo pipefail

TRIVY_IMAGE="aquasec/trivy:latest@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f"
EXIT_CODE="${TRIVY_EXIT_CODE:-0}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${TRIVY_OUTPUT_DIR:-$ROOT_DIR/artifacts/security}"
CACHE_DIR="${TRIVY_CACHE_DIR:-$ROOT_DIR/.runtime/trivy-cache}"

if [[ $# -eq 0 ]]; then
  set -- eh-investigator-agent:ci eh-graphiti-mcp:ci
fi

mkdir -p "$OUTPUT_DIR" "$CACHE_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
CACHE_DIR="$(cd "$CACHE_DIR" && pwd)"

for image in "$@"; do
  filename="$(printf '%s' "$image" | tr '/:@' '____').trivy.json"
  printf '\nScanning %s for HIGH and CRITICAL fixable vulnerabilities\n' "$image"
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$CACHE_DIR:/root/.cache/trivy" \
    -v "$OUTPUT_DIR:/out" \
    "$TRIVY_IMAGE" image \
    --scanners vuln \
    --severity HIGH,CRITICAL \
    --ignore-unfixed \
    --exit-code "$EXIT_CODE" \
    --format json \
    --output "/out/$filename" \
    "$image"
  jq -r --arg image "$image" '
    [.Results[]?.Vulnerabilities[]?]
    | group_by(.Severity)
    | map({ key: .[0].Severity, value: length })
    | from_entries
    | "\($image): HIGH=\(.HIGH // 0) CRITICAL=\(.CRITICAL // 0)"
  ' "$OUTPUT_DIR/$filename"
done
