#!/usr/bin/env bash
# Removes per-feature scratch artifacts that are only useful *during* a
# pipeline run (pm<->dev Q&A thread, dev's raw context notes, dev's running
# log) and have no reader once the feature has merged into main. Durable
# artifacts (feature-brief.md, technical-plan.md, review-report.md,
# qa-report.md, issue-body.md) are left untouched — those are the record a
# human reviewer or a future feature actually wants to read.
set -euo pipefail

SCRATCH_FILES=(pm-dev-thread.md repository-context.md dev-log.md)

removed=()
for dir in .ai/artifacts/features/*/; do
  [ -d "$dir" ] || continue
  for name in "${SCRATCH_FILES[@]}"; do
    f="${dir}${name}"
    if [ -f "$f" ]; then
      git rm -q "$f"
      removed+=("$f")
    fi
  done
done

if [ "${#removed[@]}" -eq 0 ]; then
  echo "No scratch artifacts to prune."
  exit 0
fi

printf 'Pruned %d scratch artifact(s):\n' "${#removed[@]}"
printf '  %s\n' "${removed[@]}"
