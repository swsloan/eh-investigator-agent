#!/usr/bin/env bash
# CI entry for the eval dashboard.
#   1. validate the fixtures against the data contract (contract self-test),
#   2. build the dashboard HTML,
#   3. fail the build if the latest run's autonomy gate fails.
#
# Point at real harness output instead of fixtures with DATA:
#   DATA=eval/reports bash eval/dashboard/ci.sh
# Also fail on any regressed case (even if the gate still passes):
#   FAIL_ON_REGRESSION=1 bash eval/dashboard/ci.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DATA="${DATA:-eval/dashboard/fixtures}"
OUT="${OUT:-eval/dashboard/out}"
EXTRA=""
[ "${FAIL_ON_REGRESSION:-0}" = "1" ] && EXTRA="--fail-on-regression"

echo "== validating fixtures (contract self-test) =="
python3 eval/dashboard/validate.py

echo "== building dashboard from ${DATA} =="
node eval/dashboard/build.js --data "$DATA" --out "$OUT" --check $EXTRA

echo "== dashboard artifact: ${OUT} =="
