#!/usr/bin/env bash
# Static analysis for shell scripts (ShellCheck) and Dockerfiles (Hadolint).
# Run locally via `npm run lint` and in CI. Both tools must be installed; the
# script fails if either is missing so a check is never silently skipped.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

status=0

if command -v shellcheck >/dev/null 2>&1; then
  echo "== ShellCheck =="
  shellcheck scripts/*.sh start.sh || status=1
else
  echo "ERROR: shellcheck not installed — https://github.com/koalaman/shellcheck#installing" >&2
  status=1
fi

if command -v hadolint >/dev/null 2>&1; then
  echo "== Hadolint =="
  hadolint Dockerfile graphiti/Dockerfile || status=1
else
  echo "ERROR: hadolint not installed — https://github.com/hadolint/hadolint#install" >&2
  status=1
fi

[[ "$status" -eq 0 ]] && echo "Lint OK."
exit "$status"
