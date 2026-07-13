#!/usr/bin/env bash
# Deploy the app to the local prod stack (compose project eh-investigator, port
# 3100) FROM THIS GIT CHECKOUT — the single source of truth. Edit, commit, and
# deploy all act on one tree, so the running app and the repo never drift.
#
# Rebuilds the image from the current working tree and recreates ONLY the app
# container; falkordb / graphiti-mcp / ollama and all named volumes are untouched.
# Runtime secrets live in the config_data volume (+ the gitignored .env fallback
# in this dir for compose interpolation), never in git.
#
#   ./scripts/deploy.sh
#
# Recreating the app interrupts any in-flight investigation. Hard-refresh the
# browser (Cmd-Shift-R) after a UI deploy.
set -euo pipefail

# Run from the repo root regardless of where the script was invoked.
cd "$(dirname "$0")/.."

head="$(git rev-parse --short HEAD 2>/dev/null || echo 'no-git')"
echo "Deploying from: $(pwd)  @ ${head}"

# Surface drift: deploying uncommitted work is allowed, but the repo should be
# committed + pushed so the running app stays reproducible from git.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "⚠  Uncommitted changes present — deploying them, but commit + push to keep the repo in sync with prod."
  fi
fi

docker compose -p eh-investigator -f docker-compose.yml up -d --build eh-investigator

echo "✔ Deployed. Hard-refresh the browser (Cmd-Shift-R) at http://127.0.0.1:3100"
