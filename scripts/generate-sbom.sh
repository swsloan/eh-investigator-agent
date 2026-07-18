#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${SBOM_OUTPUT_DIR:-$ROOT_DIR/artifacts/sbom}"
SYFT_IMAGE="anchore/syft:latest@sha256:b4f1df79f97b817682d8b5ff941eb6bfe74f6172553a5e312c75bbc2eabc405c"

if [[ $# -eq 0 ]]; then
  set -- eh-investigator-agent:ci eh-graphiti-mcp:ci
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

for image in "$@"; do
  filename="$(printf '%s' "$image" | tr '/:@' '____').spdx.json"
  printf 'Generating SBOM for %s -> %s/%s\n' "$image" "$OUTPUT_DIR" "$filename"
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$OUTPUT_DIR:/out" \
    "$SYFT_IMAGE" "$image" \
    -o "spdx-json=/out/$filename"
done
