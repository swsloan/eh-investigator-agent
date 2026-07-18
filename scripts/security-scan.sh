#!/usr/bin/env bash
set -euo pipefail

TRIVY_IMAGE="aquasec/trivy:latest@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${TRIVY_OUTPUT_DIR:-$ROOT_DIR/artifacts/security}"
CACHE_DIR="${TRIVY_CACHE_DIR:-$ROOT_DIR/.runtime/trivy-cache}"

# Merge gate (see docs/SECURITY-HARDENING.md -> "Vulnerability baseline").
# Every image is still scanned and reported for fixable HIGH+CRITICAL; the gate
# only decides what FAILS the build. Policy: block on CRITICAL in our own
# application image; leave HIGH report-only, and leave third-party images (e.g.
# eh-graphiti-mcp, built FROM an upstream base we do not control) entirely
# report-only and tracked via issues instead of blocking. Override with
# TRIVY_GATE_IMAGES / TRIVY_GATE_SEVERITY; set TRIVY_ENFORCE=0 to report without
# failing.
GATE_SEVERITY="${TRIVY_GATE_SEVERITY:-CRITICAL}"
ENFORCE="${TRIVY_ENFORCE:-1}"
read -r -a GATE_IMAGES <<<"${TRIVY_GATE_IMAGES:-eh-investigator-agent:ci}"

if [[ $# -eq 0 ]]; then
  set -- eh-investigator-agent:ci eh-graphiti-mcp:ci
fi

mkdir -p "$OUTPUT_DIR" "$CACHE_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
CACHE_DIR="$(cd "$CACHE_DIR" && pwd)"

# Comma list -> jq array of upper-cased, trimmed severities, e.g.
# "HIGH,CRITICAL" -> ["HIGH","CRITICAL"].
gate_sev_json="$(printf '%s' "$GATE_SEVERITY" | jq -R 'split(",") | map(ascii_upcase | gsub("^\\s+|\\s+$";""))')"

is_gated() {
  local image="$1" g
  for g in ${GATE_IMAGES[@]+"${GATE_IMAGES[@]}"}; do
    [[ "$image" == "$g" ]] && return 0
  done
  return 1
}

gate_failed=0

for image in "$@"; do
  filename="$(printf '%s' "$image" | tr '/:@' '____').trivy.json"
  printf '\nScanning %s for HIGH and CRITICAL fixable vulnerabilities\n' "$image"
  # Always report-only at the scan step (--exit-code 0) so every image produces
  # a full report artifact; the merge gate below is what fails the build.
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$CACHE_DIR:/root/.cache/trivy" \
    -v "$OUTPUT_DIR:/out" \
    "$TRIVY_IMAGE" image \
    --scanners vuln \
    --severity HIGH,CRITICAL \
    --ignore-unfixed \
    --exit-code 0 \
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

  if is_gated "$image"; then
    gate_count="$(jq --argjson sev "$gate_sev_json" '
      [.Results[]?.Vulnerabilities[]? | select(.Severity as $s | $sev | index($s) != null)] | length
    ' "$OUTPUT_DIR/$filename")"
    if [[ "$gate_count" -gt 0 ]]; then
      printf '  GATE: %s has %s fixable vulnerability(ies) at [%s] -> blocks merge\n' \
        "$image" "$gate_count" "$GATE_SEVERITY"
      gate_failed=1
    else
      printf '  GATE: %s clean at [%s]\n' "$image" "$GATE_SEVERITY"
    fi
  else
    printf '  report-only: %s (not gated)\n' "$image"
  fi
done

if [[ "$gate_failed" -ne 0 ]]; then
  if [[ "$ENFORCE" == "1" ]]; then
    printf '\nMerge gate FAILED: a gated image has fixable vulnerabilities at [%s].\n' "$GATE_SEVERITY" >&2
    exit 1
  fi
  printf '\nMerge gate would fail at [%s] (TRIVY_ENFORCE=%s, not enforcing).\n' "$GATE_SEVERITY" "$ENFORCE" >&2
fi
