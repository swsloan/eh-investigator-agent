#!/usr/bin/env bash
# One command: (re)build the image, bring up a read-only eval instance on a
# separate project/port (production on 3100 is never touched), run the eval
# harness live over the labeled cases, build the dashboard, and tear the eval
# instance down.
#
#   bash scripts/run-eval-live.sh                 # all cases in eval/cases
#   CASES=eval/cases RUN_ID=eval-manual bash scripts/run-eval-live.sh
#
# Requires: the production stack has been configured once (ExtraHop creds set in
# Settings), so its config_data volume holds the credentials this clones.
set -euo pipefail
cd "$(dirname "$0")/.."

PROD_PROJECT="${PROD_PROJECT:-eh-investigator}"
PROD_CONFIG_VOL="${PROD_CONFIG_VOL:-eh-investigator_config_data}"
EVAL_CONFIG_VOL="eh-eval_config_data"
COMPOSE=(docker compose -p eh-eval -f docker-compose.yml -f docker-compose.eval.yml)
URL="http://127.0.0.1:3101"
CASES="${CASES:-eval/cases}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${RUN_ID:-eval-$STAMP}"

echo "== 1/5 build image (production container is not recreated) =="
docker compose -p "$PROD_PROJECT" -f docker-compose.yml build eh-investigator

echo "== 2/5 clone production creds volume -> eval (read-only source) =="
docker volume create "$EVAL_CONFIG_VOL" >/dev/null
docker run --rm -v "$PROD_CONFIG_VOL":/from:ro -v "$EVAL_CONFIG_VOL":/to alpine \
  sh -c 'cp -a /from/. /to/ 2>/dev/null || true'

echo "== 3/5 start read-only eval instance on $URL =="
"${COMPOSE[@]}" up -d eh-investigator
for i in $(seq 1 60); do
  if curl -fsS "$URL/" >/dev/null 2>&1; then echo "  up after ${i}s"; break; fi
  sleep 2
  [ "$i" = 60 ] && { echo "  eval instance did not become ready"; "${COMPOSE[@]}" logs --tail 40 eh-investigator; exit 1; }
done

echo "== 4/5 run eval harness live over $CASES (run-id $RUN_ID) =="
EVAL_STAMP="$(date -u +%FT%TZ)" node eval/harness/run-eval.js \
  --live --url "$URL" --cases "$CASES" --reports eval/reports \
  --run-id "$RUN_ID" --backend claude --skill-version evidence-ladder@v3 || true
node eval/dashboard/build.js --data eval/reports --out eval/dashboard/out || true

echo "== 5/5 tear down eval instance + volumes, incl. the cloned creds (production untouched) =="
"${COMPOSE[@]}" down -v
docker volume rm "$EVAL_CONFIG_VOL" >/dev/null 2>&1 || true
echo "Done. Dashboard: eval/dashboard/out/index.html  (run detail: eval/reports/$RUN_ID.json)"
