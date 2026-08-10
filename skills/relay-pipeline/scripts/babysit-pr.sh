#!/usr/bin/env bash
# Babysit a PR's CI checks and, when safe, auto-stamp it — AI Feature
# Pipeline module.
#
# run-pipeline.sh gets a PR to green code + PASS reviews, then stops: from
# there, watching CI and re-running flaky jobs was a manual chore, and a
# human still had to re-open every PR just to bless the boring ones. This
# script is the loop that does both: poll `gh pr checks`, rerun failed runs
# a bounded number of times (real infra flakiness, not a fix-it retry), and
# — only with --auto-stamp — approve the PR itself when every objective
# signal this pipeline already produced says it's safe to.
#
# Usage:
#   bash scripts/babysit-pr.sh <branch> [--project-root=<path>] \
#     [--max-reruns=N] [--poll-interval=SECONDS] [--max-polls=N] \
#     [--auto-stamp] [--max-diff-lines=N]
#
# Intended to be run by a human, or looped externally (e.g. `/loop`, a
# cron job) — it is NOT invoked by run-pipeline.sh itself. Watching CI can
# take anywhere from seconds to tens of minutes; that has no business being
# on the critical path of the pipeline run that opened the PR.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
BRANCH="${1:?Usage: $0 <branch> [--project-root=<path>] [--max-reruns=N] [--poll-interval=SECONDS] [--max-polls=N] [--auto-stamp] [--max-diff-lines=N]}"

MAX_RERUNS=2
POLL_INTERVAL=30
MAX_POLLS=40
AUTO_STAMP="false"
MAX_DIFF_LINES=300

for arg in "${@:2}"; do
  case "$arg" in
    --project-root=*) ROOT="${arg#*=}" ;;
    --max-reruns=*) MAX_RERUNS="${arg#*=}" ;;
    --poll-interval=*) POLL_INTERVAL="${arg#*=}" ;;
    --max-polls=*) MAX_POLLS="${arg#*=}" ;;
    --auto-stamp) AUTO_STAMP="true" ;;
    --max-diff-lines=*) MAX_DIFF_LINES="${arg#*=}" ;;
  esac
done

cd "$ROOT"

PR_NUMBER=$(gh pr list --head "$BRANCH" --json number --jq '.[0].number' 2>/dev/null || echo "")
if [ -z "$PR_NUMBER" ]; then
  echo "  No open PR found for branch '$BRANCH'."
  exit 1
fi
echo "==> Babysitting PR #$PR_NUMBER ($BRANCH)"

# --- 1. Poll checks, rerunning failed runs up to $MAX_RERUNS times ---
#
# `gh pr checks` exit codes: 0 = all pass, 1 = some pending, 8 = some failed
# (per `gh` docs) — anything else is treated as "still settling," not a
# hard failure, so a transient `gh` hiccup doesn't get misread as CI failure.
reruns=0
poll=0
FINAL_STATE="unknown"
while [ "$poll" -lt "$MAX_POLLS" ]; do
  poll=$((poll + 1))
  set +e
  CHECKS_OUTPUT=$(gh pr checks "$PR_NUMBER" 2>&1)
  CHECKS_EXIT=$?
  set -e

  if [ "$CHECKS_EXIT" -eq 0 ]; then
    echo "  [poll $poll/$MAX_POLLS] All checks passed."
    FINAL_STATE="pass"
    break
  fi

  if [ "$CHECKS_EXIT" -eq 8 ]; then
    if [ "$reruns" -lt "$MAX_RERUNS" ]; then
      reruns=$((reruns + 1))
      echo "  [poll $poll/$MAX_POLLS] Some checks failed — rerunning failed jobs (attempt $reruns/$MAX_RERUNS)..."
      FAILED_RUN_ID=$(gh run list --branch "$BRANCH" --json databaseId,conclusion --jq '[.[] | select(.conclusion=="failure")][0].databaseId' 2>/dev/null || echo "")
      if [ -n "$FAILED_RUN_ID" ]; then
        gh run rerun "$FAILED_RUN_ID" --failed 2>&1 || echo "  (rerun request failed, will re-poll anyway)"
      fi
    else
      echo "  [poll $poll/$MAX_POLLS] Checks still failing after $MAX_RERUNS rerun(s). Stopping."
      FINAL_STATE="fail"
      break
    fi
  else
    echo "  [poll $poll/$MAX_POLLS] Checks still pending..."
  fi

  sleep "$POLL_INTERVAL"
done

if [ "$FINAL_STATE" = "unknown" ]; then
  echo "  Gave up after $MAX_POLLS polls — checks never settled. Leaving PR #$PR_NUMBER for a human."
  exit 1
fi

if [ "$FINAL_STATE" = "fail" ]; then
  gh pr comment "$PR_NUMBER" --body "Babysitter: CI still failing after $MAX_RERUNS automatic rerun(s). Needs a human look." 2>&1 || true
  exit 1
fi

# --- 2. Auto-stamp, only when explicitly requested and only when every
#        signal the pipeline already produced says this PR is low-risk ---
#
# "Low-risk" here is deliberately narrow and made of things this repo's own
# gates already computed — never a new judgment call by this script:
#   - Review panel verdict is PASS (not PASS_WITH_NOTES or FAIL)
#   - QA verdict is PASS
#   - the diff is small enough that a human skim is cheap even if this
#     auto-approval is wrong
# Anything else falls through to a comment, not a silent skip, so a human
# still knows this PR was checked and why it wasn't auto-stamped.
if [ "$AUTO_STAMP" != "true" ]; then
  echo "  CI green. --auto-stamp not requested — leaving approval to a human."
  exit 0
fi

SLUG="${BRANCH#*/}"
ARTIFACTS_DIR=".ai/artifacts/features/$SLUG"
REVIEW_VERDICT=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$ARTIFACTS_DIR/.agent-status-review.json','utf-8')).verdict)}catch(e){console.log('')}" 2>/dev/null)
QA_VERDICT=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$ARTIFACTS_DIR/.agent-status-qa.json','utf-8')).verdict)}catch(e){console.log('')}" 2>/dev/null)
DIFF_LINES=$(gh pr diff "$PR_NUMBER" 2>/dev/null | grep -Ec '^[+-]' || echo "999999")

REASONS=()
[ "$REVIEW_VERDICT" != "PASS" ] && REASONS+=("Review verdict is '${REVIEW_VERDICT:-unknown}', not PASS")
[ "$QA_VERDICT" != "PASS" ] && REASONS+=("QA verdict is '${QA_VERDICT:-unknown}', not PASS")
if [ "$DIFF_LINES" -gt "$MAX_DIFF_LINES" ] 2>/dev/null; then
  REASONS+=("diff is $DIFF_LINES changed lines, over the $MAX_DIFF_LINES-line auto-stamp threshold")
fi

if [ "${#REASONS[@]}" -gt 0 ]; then
  comment_body="Babysitter: CI is green, but this PR doesn't meet the auto-stamp bar:
$(printf '- %s\n' "${REASONS[@]}")
Needs a human review."
  echo "  Not auto-stamping: ${REASONS[*]}"
  gh pr comment "$PR_NUMBER" --body "$comment_body" 2>&1 || true
  exit 0
fi

echo "  All auto-stamp conditions met (Review: PASS, QA: PASS, diff: $DIFF_LINES lines) — approving."
gh pr review "$PR_NUMBER" --approve --body "Babysitter: CI green, Review PASS, QA PASS, diff within the auto-stamp threshold ($DIFF_LINES lines). Auto-approved — still a human's call to merge." 2>&1
