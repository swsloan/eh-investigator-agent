#!/usr/bin/env bash
set -euo pipefail

node --check server.js

for dir in lib routes public smoke; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' file; do
    node --check "$file"
  done < <(find "$dir" -type f -name '*.js' -print0)
done
