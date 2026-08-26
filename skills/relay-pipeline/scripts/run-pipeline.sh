#!/usr/bin/env bash
# Run the full agent pipeline — Relay module
# Usage: bash scripts/run-pipeline.sh <slug> [issue-body.md] [--dry-run] [--approve-design] [--upload-build] [--project-root=<path>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# Check for --project-root in args
for arg in "$@"; do
  case "$arg" in
    --project-root=*) ROOT="${arg#*=}" ;;
  esac
done
SLUG="${1:?Usage: $0 <slug> [issue-body.md] [--dry-run] [--approve-design] [--project-root=<path>]}"
ISSUE_BODY=""
DRY_RUN=""
APPROVE_DESIGN="false"
UPLOAD_BUILD="false"
for arg in "${@:2}"; do
  if [ "$arg" = "--dry-run" ]; then
    DRY_RUN="--dry-run"
  elif [ "$arg" = "--approve-design" ]; then
    APPROVE_DESIGN="true"
  elif [ "$arg" = "--upload-build" ]; then
    UPLOAD_BUILD="true"
  elif [ -z "$ISSUE_BODY" ] && [[ "$arg" != --* ]]; then
    ISSUE_BODY="$arg"
  fi
done
ARTIFACTS_DIR=".ai/artifacts/features/$SLUG"
MAX_LOOPS=3
MAX_REVIEW_RETRIES=1

# Load config
read_config() {
  # Strip a leading '.' before splitting — '.commands.typecheck'.split('.')
  # otherwise yields a leading empty segment and every lookup silently
  # falls through to the default value below, even when the key exists.
  node -e "try{var c=JSON.parse(require('fs').readFileSync('$ROOT/.ai/config.json','utf-8'));var p='$1'.replace(/^\./,'').split('.');for(var k of p)c=c[k];if(c===undefined)throw new Error('undefined');console.log(c)}catch(e){console.log('$2')}"
}
PACKAGE_MANAGER=$(read_config ".commands.packageManager" "npm")
INSTALL_CMD=$(read_config ".commands.install" "$PACKAGE_MANAGER install")
RUN_SCRIPT=$(read_config ".commands.runScript" "npx tsx")
TYPECHECK_CMD=$(read_config ".commands.typecheck" "tsc --noEmit")
LINT_CMD=$(read_config ".commands.lint" "eslint .")
TEST_CMD=$(read_config ".commands.test" "")
BUILD_CMD=$(read_config ".commands.build" "")
# Sandboxing only applies to web/backend projects: Docker Linux images can't
# run Xcode, so a project with ios.scheme set (the same signal upload-build.sh
# gates on) always runs commands.test/build directly on the host.
SANDBOX_ENABLED=$(read_config ".sandbox.enabled" "false")
SANDBOX_IMAGE=$(read_config ".sandbox.image" "node:20-slim")
# Not everyone runs Docker (licensing, resource footprint, or simply a
# preference for a lighter alternative), and the runtimes below all accept
# the same `run --rm --network=none -v ... -w ... <image> sh -c ...`
# invocation, so the choice is a config value, not a hardcoded assumption.
SANDBOX_RUNTIME=$(read_config ".sandbox.runtime" "docker")
IOS_SCHEME=$(read_config ".ios.scheme" "")
BRANCH_PREFIX=$(read_config ".project.branchPrefix" "feat")
MEMORY_COMPACT_EVERY=$(read_config ".project.memoryCompactEvery" "10")
DEFAULT_BRANCH=$(read_config ".project.defaultBranch" "main")
# Number of independent Review verifiers (adversarial panel). 1 = the
# original single-reviewer behavior. >1 runs that many Review passes, each
# with a distinct lens, and takes a majority vote (see run_review_panel).
REVIEW_VERIFIERS=$(read_config ".review.verifiers" "1")
[[ "$REVIEW_VERIFIERS" =~ ^[0-9]+$ ]] || REVIEW_VERIFIERS=1
[ "$REVIEW_VERIFIERS" -lt 1 ] && REVIEW_VERIFIERS=1
BRANCH="${BRANCH_PREFIX}/$SLUG"

# --- Workspace isolation ---
#
# Every run — including --dry-run — executes inside a dedicated git worktree,
# never in the directory you're actively working in. This makes a bad or
# half-finished pipeline run fully reversible (delete the worktree, the
# branch, or both) without ever touching your main checkout, and it means
# --dry-run is a faithful rehearsal of the real branch/worktree/gate
# mechanics, not just the LLM call. Only the OpenRouter call is mocked and
# only the push/PR step is skipped in dry-run.
WORKTREE_ROOT="$(dirname "$ROOT")/.relay-worktrees"
WORKTREE_DIR="$WORKTREE_ROOT/$(basename "$ROOT")-$SLUG"

setup_worktree() {
  mkdir -p "$WORKTREE_ROOT"
  if [ -d "$WORKTREE_DIR" ]; then
    echo "==> Reusing existing worktree: $WORKTREE_DIR"
    return
  fi
  echo "==> Creating isolated worktree for $BRANCH at $WORKTREE_DIR"
  # -c core.hooksPath=/dev/null: some post-checkout hooks (e.g. husky's
  # "reinstall deps if the lockfile changed") assume $1/$2 are always real
  # commit SHAs. `git worktree add -b` on a brand new branch passes the
  # null SHA as the "previous HEAD", which such hooks don't handle and
  # exit non-zero on — killing the whole run under `set -e`. This is scoped
  # to worktree creation only; commit_stage() below still runs pre-commit
  # hooks normally, since those are a real quality gate, unlike a
  # dev-convenience checkout hook.
  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -c core.hooksPath=/dev/null -C "$ROOT" worktree add "$WORKTREE_DIR" "$BRANCH"
  else
    git -c core.hooksPath=/dev/null -C "$ROOT" worktree add -b "$BRANCH" "$WORKTREE_DIR" "$DEFAULT_BRANCH"
  fi
}

# --- Concurrency lock ---
#
# Two invocations for the same slug racing on the same worktree/branch would
# corrupt each other's artifacts. Best-effort (mkdir is atomic on a single
# filesystem, which covers the intended case: an accidental double-trigger
# from a person or a misconfigured cron/CI, not distributed coordination).
LOCK_DIR="$WORKTREE_ROOT/.locks"
LOCK_PATH="$LOCK_DIR/$SLUG"
mkdir -p "$LOCK_DIR"

acquire_lock() {
  if ! mkdir "$LOCK_PATH" 2>/dev/null; then
    local held_pid=""
    [ -f "$LOCK_PATH/pid" ] && held_pid=$(cat "$LOCK_PATH/pid" 2>/dev/null)
    if [ -n "$held_pid" ] && ! kill -0 "$held_pid" 2>/dev/null; then
      echo "==> Stale lock from dead process $held_pid — reclaiming."
      rm -rf "$LOCK_PATH"
      mkdir "$LOCK_PATH"
    else
      echo "  Another pipeline run is already in progress for slug '$SLUG' (pid ${held_pid:-unknown})."
      echo "  If you're sure it isn't actually running, remove the lock manually: rm -rf $LOCK_PATH"
      exit 1
    fi
  fi
  echo "$$" > "$LOCK_PATH/pid"
}

release_lock() {
  rm -rf "$LOCK_PATH"
}

acquire_lock
trap release_lock EXIT

setup_worktree
PIPELINE_ROOT="$WORKTREE_DIR"

cd "$PIPELINE_ROOT"

# A git worktree shares the .git directory with $ROOT but starts with no
# node_modules and no generated hook glue (e.g. husky's .husky/_/husky.sh,
# which most package managers regenerate via a "prepare" lifecycle script
# on install). Without this, typecheck/lint/test — and even `git commit`
# itself if pre-commit hooks depend on installed tooling — all fail in the
# worktree for reasons that have nothing to do with the feature being
# built. Skipped if node_modules already exists (a resumed run reusing an
# existing worktree, e.g. after the design-gate pause).
if [ ! -d node_modules ]; then
  echo "==> Installing dependencies in the isolated worktree ($INSTALL_CMD)..."
  if ! ${INSTALL_CMD}; then
    echo "  Dependency install failed in the worktree. Aborting."
    echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
    exit 1
  fi
fi

run_agent() {
  local role=$1
  local extra_flags="${2:-}"
  local extra=""
  [ "$DRY_RUN" = "--dry-run" ] && extra="--dry-run"
  echo ""
  echo "========================================="
  echo "  Running $role..."
  echo "========================================="
  ${RUN_SCRIPT} "$SCRIPT_DIR/agent-runner.ts" --role="$role" --slug="$SLUG" --project-root="$PIPELINE_ROOT" $extra $extra_flags
}

# Cross-references file paths mentioned in a quality-gate feedback file
# against this feature's actual planned files (agent-runner.ts's own
# --list-impacted-files, no LLM call), so a Dev retry can be scoped to just
# the implicated file(s) instead of always regenerating every batch from
# scratch. Prints a comma-separated list — empty if nothing can be
# confidently attributed, which the caller must treat as "fall back to a
# full regenerate," not as "nothing needs fixing."
extract_retry_files() {
  local feedback_file="$1"
  [ -f "$feedback_file" ] || return 0
  local planned
  planned=$(${RUN_SCRIPT} "$SCRIPT_DIR/agent-runner.ts" --list-impacted-files --slug="$SLUG" --project-root="$PIPELINE_ROOT" 2>/dev/null)
  [ -z "$planned" ] && return 0
  local matched=()
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    # Fixed-string substring match: works whether the feedback reports
    # this exact relative path (typecheck/lint) or an absolute path with
    # this relative path as its suffix (node:test's `location:` field).
    if grep -qF "$f" "$feedback_file" 2>/dev/null; then
      matched+=("$f")
    fi
  done <<< "$planned"
  # :- default: expanding an empty array with [*] is an unbound-variable
  # error under `set -u` on macOS's stock bash 3.2 — found live when a
  # quality-gate failure matched none of the planned files.
  ( IFS=,; echo "${matched[*]:-}" )
}

# Commit staged agent output, honoring the project's pre-commit hooks.
# Unlike --no-verify, a real hook rejection stops the pipeline instead of
# silently continuing with unstaged/uncommitted agent output.
commit_stage() {
  local message="$1"
  local role="${2:-}"
  # Provenance trailers: when a role is given, stamp the model and prompt
  # hash that produced this stage's output into the commit body (read from
  # the role's status file agent-runner just wrote). Trailers sit in the
  # body, so the conventional-commit header still satisfies commitlint.
  if [ -n "$role" ] && [ -f "$ARTIFACTS_DIR/.agent-status-$role.json" ]; then
    local prov
    prov=$(node -e "try{var s=JSON.parse(require('fs').readFileSync('$ARTIFACTS_DIR/.agent-status-$role.json','utf-8'));var o=[];if(s.model)o.push('Relay-Model: '+s.model);if(s.promptSha)o.push('Relay-Prompt-SHA: '+s.promptSha);process.stdout.write(o.join('\n'))}catch(e){}" 2>/dev/null)
    if [ -n "$prov" ]; then
      message="$message

$prov"
    fi
  fi
  git add -A
  if git diff --cached --quiet; then
    return 0
  fi
  if ! git commit -m "$message"; then
    echo ""
    echo "  Commit rejected by pre-commit hook: $message"
    echo "  Fix the hook failure (or the agent output that triggered it) before re-running."
    echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
    exit 1
  fi
}

# Source files Dev created or modified in the worktree but hasn't committed
# yet (unstaged edits to tracked files + brand-new untracked files),
# restricted to source extensions. Used by the content gates below so they
# only judge what Dev actually wrote this pass, never pre-existing repo code.
get_changed_source_files() {
  { git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } \
    | grep -Ei '\.(ts|tsx|js|jsx|mjs|cjs|css|json)$' | sort -u
}

# Deterministic content gates on Dev's own output. GOVERNANCE.md forbids
# placeholders and committed secrets, but those were previously prompt-only
# rules a drifting model could ignore — a truncated file ending in
# "// ... rest stays the same" still passes typecheck if the rest compiles.
# These make both rules real, code-enforced gates that feed the same Dev
# retry loop as typecheck/lint. Dependency-free (no gitleaks required);
# projects wanting deeper scanning can add it to their own pre-commit hook,
# which the pipeline already respects.
scan_content_gates() {
  local out="$1" # append findings here
  local placeholder_re secret_re files f hits ok=0
  # Placeholder / truncation markers the Dev must never leave in output.
  placeholder_re='(//[[:space:]]*(TODO|FIXME)|//[[:space:]]*\.\.\.|/\*[[:space:]]*\.\.\.|\.\.\.[[:space:]]*(rest|the rest)|rest stays the same|rest of the (code|file|implementation)|\bTBD\b|implementation (goes|here))'
  # Conservative secret signatures (private keys, cloud/provider tokens, and
  # assigned credential literals with a non-trivial value).
  secret_re='(-----BEGIN[A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|\bsk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|(api[_-]?key|secret|token|password|passwd|access[_-]?key)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{12,}["'"'"'])'

  files=$(get_changed_source_files)
  [ -z "$files" ] && return 0

  local ph_hits sec_hits
  ph_hits=$(printf '%s\n' "$files" | while IFS= read -r f; do
    [ -f "$f" ] && grep -HniE "$placeholder_re" "$f" 2>/dev/null
  done)
  sec_hits=$(printf '%s\n' "$files" | while IFS= read -r f; do
    [ -f "$f" ] && grep -HnE "$secret_re" "$f" 2>/dev/null
  done)

  if [ -n "$ph_hits" ]; then
    ok=1
    {
      echo "## Forbidden placeholders / truncated output"
      echo "GOVERNANCE.md forbids placeholders and partial snippets. Emit the COMPLETE content of each file. Offending lines:"
      echo '```'
      printf '%s\n' "$ph_hits"
      echo '```'
      echo ""
    } >> "$out"
  fi
  if [ -n "$sec_hits" ]; then
    ok=1
    {
      echo "## Possible committed secrets"
      echo "GOVERNANCE.md forbids committing secrets/credentials. Remove them and load from the environment instead. Offending lines:"
      echo '```'
      printf '%s\n' "$sec_hits"
      echo '```'
      echo ""
    } >> "$out"
  fi
  return $ok
}

# Runs a project command directly on the host, unless sandbox.enabled is true
# — in which case it runs inside a disposable, network-disabled Linux
# container instead. This exists because commands.test/build execute
# Dev-authored code (the LLM just wrote the test suite it's about to run),
# so without this the pipeline gives that code full, unmediated access to
# the host filesystem and network. Skipped in favor of the host when this
# is an iOS project (see IOS_SCHEME above) or when Docker isn't installed —
# in both cases we fall back to direct execution rather than failing the
# gate on an environment problem unrelated to the code being tested.
run_project_cmd() {
  local cmd="$1" out="$2"
  if [ "$SANDBOX_ENABLED" = "true" ] && [ -z "$IOS_SCHEME" ] && command -v "$SANDBOX_RUNTIME" >/dev/null 2>&1; then
    "$SANDBOX_RUNTIME" run --rm --network=none -v "$PWD:/repo" -w /repo "$SANDBOX_IMAGE" \
      sh -c "${INSTALL_CMD} >/dev/null 2>&1; ${cmd}" > "$out" 2>&1
  else
    ${cmd} > "$out" 2>&1
  fi
}

# Quality gates run after every Dev pass: typecheck (always), lint (always —
# `commands.lint` was configured but never actually invoked anywhere before
# this), the project's own test suite (only if `commands.test` is
# configured — not every project has one runnable command, so this is
# opt-in rather than defaulting to a guess), an optional real build
# (`commands.build`, e.g. `next build`/`tsc -b`/`expo export` — verification
# by observation: a build actually resolves and bundles the code, catching
# runtime-only breakage typecheck passes right through), and deterministic
# content gates (no placeholders, no committed secrets in Dev's output). All
# failures are combined into a single feedback file for the Dev retry rather
# than several.
run_quality_gates() {
  local feedback_file="$ARTIFACTS_DIR/.agent-typecheck-feedback.md"
  local tc_out lint_out test_out build_out
  tc_out=$(mktemp)
  lint_out=$(mktemp)
  test_out=$(mktemp)
  build_out=$(mktemp)
  local tc_ok=true lint_ok=true test_ok=true build_ok=true content_ok=true

  # LINT_CMD (and, in principle, TYPECHECK_CMD) can legitimately be empty
  # — detectLintCmd returns '' for a project with no lint tool configured
  # at all (see relay-setup's commands.mjs). An empty ${LINT_CMD} used to
  # rely on bash's own no-op behavior for a redirection with no command
  # (`> "$lint_out" 2>&1` alone still "succeeds") rather than an explicit
  # skip — correct today, but fragile and inconsistent with TEST_CMD/
  # BUILD_CMD's guard below. Made explicit.
  if [ -n "$TYPECHECK_CMD" ]; then
    if ! ${TYPECHECK_CMD} > "$tc_out" 2>&1; then
      tc_ok=false
    fi
  fi
  if [ -n "$LINT_CMD" ]; then
    if ! ${LINT_CMD} > "$lint_out" 2>&1; then
      lint_ok=false
    fi
  fi
  if [ -n "$TEST_CMD" ]; then
    if ! run_project_cmd "$TEST_CMD" "$test_out"; then
      test_ok=false
    fi
  fi
  if [ -n "$BUILD_CMD" ]; then
    if ! run_project_cmd "$BUILD_CMD" "$build_out"; then
      build_ok=false
    fi
  fi

  local content_out
  content_out=$(mktemp)
  if ! scan_content_gates "$content_out"; then
    content_ok=false
  fi

  if [ "$tc_ok" = false ] || [ "$lint_ok" = false ] || [ "$test_ok" = false ] || [ "$build_ok" = false ] || [ "$content_ok" = false ]; then
    mkdir -p "$(dirname "$feedback_file")"
    {
      if [ "$tc_ok" = false ]; then
        echo "## Typecheck errors"
        cat "$tc_out"
        echo ""
      fi
      if [ "$lint_ok" = false ]; then
        echo "## Lint errors"
        cat "$lint_out"
        echo ""
      fi
      if [ "$test_ok" = false ]; then
        echo "## Test failures"
        cat "$test_out"
        echo ""
      fi
      if [ "$build_ok" = false ]; then
        echo "## Build failures"
        cat "$build_out"
        echo ""
      fi
      if [ "$content_ok" = false ]; then
        cat "$content_out"
      fi
    } > "$feedback_file"
    head -60 "$feedback_file"
    rm -f "$tc_out" "$lint_out" "$test_out" "$build_out" "$content_out"
    return 1
  fi

  rm -f "$tc_out" "$lint_out" "$test_out" "$build_out" "$content_out"
  rm -f "$feedback_file" 2>/dev/null || true
  return 0
}

# Content hash of a file, portable across macOS (shasum) and Linux
# (sha256sum). Used to bind a design approval to the exact plan a human
# reviewed — if the plan changes, the recorded hash no longer matches and
# re-approval is required.
plan_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

read_verdict() {
  local role=${1:-}
  local file
  if [ -n "$role" ]; then
    file="$ARTIFACTS_DIR/.agent-status-${role}.json"
  else
    file="$ARTIFACTS_DIR/.agent-status.json"
  fi
  if [ -f "$file" ]; then
    node -e "try{console.log(JSON.parse(require('fs').readFileSync('$file','utf-8')).verdict)}catch(e){}" 2>/dev/null
  fi
}

# Adversarial Review panel. A single Review call is the pipeline's weakest
# gate: nothing contradicts a plausible-but-wrong PASS. With
# review.verifiers > 1, run that many independent Review passes, each given
# a distinct lens (correctness/AC, diagram-vs-diff, edge-cases/security),
# and decide by majority: the panel verdict is FAIL when at least ceil(n/2)
# verifiers fail — so one flaky FAIL can't block, and one shallow PASS can't
# wave a real defect through. Leaves review-report.md and
# .agent-status-review.json in the same shape the rest of the pipeline
# already reads, so the caller is unchanged. n=1 is exactly the old behavior.
run_review_panel() {
  local n="$REVIEW_VERIFIERS"
  local lenses=(
    "correctness and acceptance-criteria coverage"
    "whether the git diff's actual control/data flow matches the Architect's Mermaid diagram"
    "edge cases, error handling, input validation, and security"
  )
  local combined="$ARTIFACTS_DIR/review-report.md"
  local tmp; tmp=$(mktemp)
  echo "# Review report (adversarial panel of $n)" > "$tmp"
  echo "" >> "$tmp"

  local verdicts=() fails=0 i lens v
  for (( i=1; i<=n; i++ )); do
    lens="${lenses[$(( (i-1) % ${#lenses[@]} ))]}"
    if [ "$n" -gt 1 ]; then
      echo "  Review verifier $i/$n — lens: $lens"
    fi
    export RELAY_REVIEW_LENS="$lens"
    run_agent review
    unset RELAY_REVIEW_LENS
    v=$(read_verdict review)
    verdicts+=("${v:-none}")
    [ "$v" = "FAIL" ] && fails=$((fails + 1))
    {
      echo "## Verifier $i — verdict: ${v:-none}"
      echo "_Lens: ${lens}_"
      echo ""
      cat "$combined" 2>/dev/null || true
      echo ""
      echo "---"
      echo ""
    } >> "$tmp"
  done

  local majority=$(( (n + 1) / 2 ))
  local final="PASS"
  if [ "$fails" -ge "$majority" ]; then
    final="FAIL"
  else
    for v in "${verdicts[@]}"; do
      [ "$v" != "PASS" ] && final="PASS_WITH_NOTES"
    done
  fi

  {
    echo "## Panel decision: $final"
    echo ""
    echo "Verifiers: ${verdicts[*]} — FAIL count: $fails / $n (majority threshold: $majority)"
  } >> "$tmp"
  mv "$tmp" "$combined"

  # Overwrite the review status verdict with the panel decision, preserving
  # the provenance fields (model/promptSha) the last pass wrote.
  node -e "var f='$ARTIFACTS_DIR/.agent-status-review.json';var s={};try{s=JSON.parse(require('fs').readFileSync(f,'utf-8'))}catch(e){};s.verdict='$final';s.panel={verifiers:$n,fails:$fails};require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
  if [ "$n" -gt 1 ]; then
    echo "  Review panel decision: $final (verdicts: ${verdicts[*]})"
  fi
}

# Session memory before context reset — .ai/project-memory.md lives across
# features (committed on each feature branch, so it survives via merges),
# but left to grow forever it stops being memory and starts being noise.
# Bump the counter here (before the retro commit, so it rides along in the
# same commit with no extra noise) and compact every MEMORY_COMPACT_EVERY
# shipped features.
bump_memory_compact_counter() {
  local counter_file=".ai/.memory-compact-counter"
  local count=0
  [ -f "$counter_file" ] && count=$(cat "$counter_file")
  count=$((count + 1))
  mkdir -p .ai
  echo "$count" > "$counter_file"
  echo "$count"
}

run_memory_compact_if_due() {
  local count="$1"
  if [ $((count % MEMORY_COMPACT_EVERY)) -eq 0 ]; then
    echo ""
    echo "==> $count features shipped — compacting .ai/project-memory.md..."
    run_agent memory-compact
    commit_stage "chore(memory-compact): after $count features" memory-compact
  fi
}

# Skill creation before repeating the same workflow forever: Retro may have
# noticed a pattern recurring across 3+ features and proposed a dedicated
# skill instead of routing it through the full pipeline every time. Never
# auto-applied — just surfaced here so a human actually sees it.
#
# Structural verification of the gate itself: "repeated 3+ times" is an LLM
# judgment call, so each proposal's Evidence section is checked against
# .ai/project-memory.md deterministically — how many of the slugs it cites
# actually appear as (slug) tags under Conventions confirmed. Advisory and
# non-blocking (same posture as the diagram-vs-diff pre-check): it catches
# evidence that doesn't hold up before a human spends time on the proposal,
# not instead of their judgment.
notify_skill_proposals() {
  local proposals_dir=".ai/artifacts/skill-proposals"
  [ -d "$proposals_dir" ] || return 0
  local printed_header=""
  for f in "$proposals_dir"/*.md; do
    [ -e "$f" ] || continue
    if [ -z "$printed_header" ]; then
      echo ""
      echo "==> Skill proposal(s) awaiting human review:"
      printed_header="yes"
    fi
    echo "    $f"
  done
  if [ -n "$printed_header" ]; then
    echo ""
    echo "==> Verifying proposal evidence against .ai/project-memory.md..."
    node "$SCRIPT_DIR/verify-skill-proposals.mjs" 2>&1 \
      || echo "  (skill-proposal verification skipped)"
  fi
}

# 0. Scaffold if not exists
if [ ! -d "$ARTIFACTS_DIR" ]; then
  echo "==> Scaffolding feature folder..."
  .ai/scripts/new-feature.sh "$SLUG"
fi

# Seed issue body if provided
if [ -n "$ISSUE_BODY" ]; then
  if [ -f "$ISSUE_BODY" ]; then
    cp "$ISSUE_BODY" "$ARTIFACTS_DIR/issue-body.md"
    echo "==> Seeded issue body from $ISSUE_BODY"
  else
    echo "==> Warning: issue body file not found: $ISSUE_BODY"
  fi
fi

# 1. PM writes feature brief
run_agent pm
commit_stage "chore(pm): $SLUG" pm

# 2. Dev review + clarification loop
#
# ROUND_HISTORY tracks each round's verdict so a human hitting the
# exhausted-loops guard below doesn't have to reconstruct the chronology by
# reading pm-dev-thread.md's raw, append-only Q&A themselves — it's a
# summary alongside the full record, not a replacement for it. Purely
# observational: it does not change any loop/retry decision.
loop=0
ROUND_HISTORY=""
while [ $loop -lt $MAX_LOOPS ]; do
  run_agent dev-review
  commit_stage "chore(dev-review): $SLUG" dev-review

  VERDICT=$(read_verdict)
  ROUND_HISTORY="${ROUND_HISTORY}  Round $((loop + 1)): dev-review verdict = ${VERDICT:-none}
"

  if [ -f "$ARTIFACTS_DIR/blocker.md" ] || [ "$VERDICT" = "blocked" ]; then
    echo ""
    echo "  BLOCKER found - human intervention required."
    echo "  See $ARTIFACTS_DIR/blocker.md"
    echo ""
    echo "  Clarification round history:"
    printf '%s' "$ROUND_HISTORY"
    echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
    exit 1
  fi

  if [ "$VERDICT" = "questions" ]; then
    echo ""
    echo "  Dev has questions. Running PM respond..."
    run_agent pm-respond
    commit_stage "chore(pm-respond): $SLUG" pm-respond
    ROUND_HISTORY="${ROUND_HISTORY}           pm-respond verdict = $(read_verdict pm-respond)
"
    loop=$((loop + 1))
    continue
  fi

  echo ""
  echo "  Dev review: clear. Proceeding."
  break
done

# Guard: exhausted loops
if [ -f "$ARTIFACTS_DIR/blocker.md" ]; then
  echo "  Unresolved blocker."
  echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
  exit 1
fi
# Read the dev-review role's own status, not the generic last-written one:
# by this point pm-respond ran most recently (inside the loop, right after
# dev-review), so the generic .agent-status.json reflects pm-respond's
# verdict (always something other than "questions"), not dev-review's. Found
# live: this guard never actually fired after exhausting MAX_LOOPS, because
# it was silently checking the wrong role's last verdict — the pipeline
# proceeded to Architect/Dev with genuinely unresolved clarification
# questions instead of halting for human input.
if [ "$(read_verdict dev-review)" = "questions" ]; then
  echo "  Unresolved threads after max clarification loops."
  echo ""
  echo "  Clarification round history:"
  printf '%s' "$ROUND_HISTORY"
  echo "  Full thread: $PIPELINE_ROOT/$ARTIFACTS_DIR/pm-dev-thread.md"
  echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
  exit 1
fi

# 3. Rebuild context.json from source, then Architect produces technical plan.
#
# On a RESUMED run — the worktree already carries a technical-plan.md from a
# prior invocation that paused at the design gate — do NOT regenerate the
# plan. The Architect runs at temperature > 0, so re-running it produces a
# *different* plan than the one the human actually reviewed; --approve-design
# would then greenlight code generation from a plan nobody saw. Reuse the
# exact reviewed plan instead.
if [ -f "$ARTIFACTS_DIR/technical-plan.md" ]; then
  echo "==> Reusing existing technical plan (resumed run) — not regenerating it."
else
  echo "==> Rebuilding context.json..."
  node "$SCRIPT_DIR/rebuild-context.mjs" --project-root="$PIPELINE_ROOT"
  run_agent architect

  # Diagrams before handwavy systems: a technical plan without a Mermaid
  # diagram is prose, not a plan Review can actually check the diff against.
  # Enforced structurally here, not just via prompt wording — one retry.
  DIAGRAM_ATTEMPT=1
  while ! grep -q '```mermaid' "$ARTIFACTS_DIR/technical-plan.md" 2>/dev/null; do
    if [ "$DIAGRAM_ATTEMPT" -ge 2 ]; then
      echo "  Architect did not produce a required Mermaid diagram after retry. Aborting."
      echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
      exit 1
    fi
    echo "  technical-plan.md is missing a \`\`\`mermaid diagram (attempt $DIAGRAM_ATTEMPT). Retrying Architect..."
    DIAGRAM_ATTEMPT=$((DIAGRAM_ATTEMPT + 1))
    run_agent architect
  done

  commit_stage "chore(architect): $SLUG" architect
fi

# --- Design gate ---
#
# No code gets written until a human has read and approved the technical
# plan. This is the "design before implementation" checkpoint: the pipeline
# pauses here (exit 0, not a failure) unless the plan was already approved
# in a prior run, or --approve-design was passed explicitly (e.g. a CI job
# re-triggered after a human approved the design-only PR/commit).
#
# The approval is bound to the plan's *content hash*, not just a marker
# file's existence: an approval recorded for one plan does not silently
# carry over to a different plan. If technical-plan.md changes after
# approval (edited by hand, or regenerated), the stored hash no longer
# matches and the pipeline demands re-approval rather than proceeding.
APPROVAL_FLAG="$ARTIFACTS_DIR/.architect-approved"
PLAN_HASH=$(plan_hash "$ARTIFACTS_DIR/technical-plan.md")
DESIGN_APPROVED="false"
if [ -f "$APPROVAL_FLAG" ]; then
  APPROVED_HASH=$(head -1 "$APPROVAL_FLAG" 2>/dev/null)
  if [ "$APPROVED_HASH" = "$PLAN_HASH" ]; then
    DESIGN_APPROVED="true"
  else
    echo "==> Technical plan differs from the approved version — re-approval required."
  fi
fi

if [ "$DESIGN_APPROVED" != "true" ]; then
  if [ "$APPROVE_DESIGN" = "true" ]; then
    echo "==> Design approved via --approve-design (plan $PLAN_HASH)."
    echo "$PLAN_HASH" > "$APPROVAL_FLAG"
    commit_stage "chore(architect): design approved for $SLUG"
  else
    echo ""
    echo "========================================="
    echo "  Design gate — awaiting approval"
    echo "========================================="
    echo "  Review the technical plan before any code is written:"
    echo "    $PIPELINE_ROOT/$ARTIFACTS_DIR/technical-plan.md"
    echo "    $PIPELINE_ROOT/$ARTIFACTS_DIR/repository-context.md"
    echo ""
    echo "  To continue once approved, re-run:"
    echo "    bash $0 $SLUG --approve-design --project-root=$ROOT"
    echo ""
    echo "  The feature branch and worktree are preserved at: $PIPELINE_ROOT"
    exit 0
  fi
fi

# 4. Dev implements with quality gates (typecheck, lint, project tests)
run_agent dev

# Quality gate: check before committing (one retry allowed)
TC_ATTEMPT=1
while true; do
  if run_quality_gates; then
    echo "  Typecheck/lint/tests passed (attempt $TC_ATTEMPT). Committing..."
    commit_stage "chore(dev): $SLUG" dev
    break
  fi

  if [ "$TC_ATTEMPT" -ge 2 ]; then
    echo "  Quality gates still FAIL after retry. Aborting."
    echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
    exit 1
  fi

  echo "  Quality gates FAILED (attempt $TC_ATTEMPT). Feeding errors back to Dev..."

  # Scope the retry to just the file(s) actually implicated by the
  # failure when we can confidently tell which ones those are — a large
  # batched feature previously always paid for every batch's full
  # regeneration on any single failing file. Falls back to reverting and
  # regenerating everything when attribution is ambiguous (e.g. a
  # generic error with no recognizable path): quality gates re-run after
  # every retry regardless, so a missed attribution costs an unhelpful
  # retry, never a silently-shipped broken file.
  RETRY_FILES=$(extract_retry_files "$ARTIFACTS_DIR/.agent-typecheck-feedback.md")
  if [ -n "$RETRY_FILES" ]; then
    echo "  Scoping retry to implicated file(s): $RETRY_FILES"
    IFS=',' read -ra RETRY_FILES_ARR <<< "$RETRY_FILES"
    for f in "${RETRY_FILES_ARR[@]}"; do
      git checkout HEAD -- "$f" 2>/dev/null || rm -f "$f"
    done
    run_agent dev "--retry-files=$RETRY_FILES"
  else
    echo "  Could not confidently attribute the failure to specific planned files — reverting and regenerating the full feature."
    git checkout HEAD -- . 2>/dev/null || true
    run_agent dev
  fi
  TC_ATTEMPT=$((TC_ATTEMPT + 1))
done

# Verify Dev manifest against tech plan
echo "==> Verifying Dev manifest against tech plan..."
MANIFEST_FILE="$ARTIFACTS_DIR/.agent-dev-manifest.json"
TECH_PLAN_FILE="$ARTIFACTS_DIR/technical-plan.md"
if [ -f "$MANIFEST_FILE" ] && [ -f "$TECH_PLAN_FILE" ]; then
  node -e "
    var plan = require('fs').readFileSync('$TECH_PLAN_FILE','utf-8');
    var manifest = JSON.parse(require('fs').readFileSync('$MANIFEST_FILE','utf-8'));
    var refs = [...plan.matchAll(/\x60([a-zA-Z0-9_./()/-]+\.(ts|tsx|js|jsx|mjs|cjs|yaml))\x60/g)].map(function(m){return m[1]});
    var produced = new Set(manifest.files.map(function(f){return f.path}));
    var missing = refs.filter(function(r){return !produced.has(r) && !r.startsWith('e2e/')});
    if (missing.length > 0) {
      console.log('  WARNING — Files expected by tech plan but NOT in Dev output:');
      missing.forEach(function(f){console.log('    - '+f)});
    } else {
      console.log('  OK — All tech plan files accounted for in Dev output.');
    }
  " 2>&1 || echo "  (manifest verification skipped)"
else
  echo "  (manifest or tech plan not found — skipping verification)"
fi

# Structural pre-check: does the Architect's Mermaid diagram reference any
# file that actually changed, or is it disconnected from the diff entirely?
# The diagram gate above only checks a ```mermaid block exists — not that
# it's meaningful. This is advisory, not a replacement for Review's own
# "diagram vs diff" lens (run_review_panel): it only catches the trivial
# case of zero overlap (stale diagram, wrong names) before spending a
# Review call judging a diagram that was never connected to the diff.
echo "==> Checking Mermaid diagram against the actual diff..."
DIFF_FILES=$(git diff --name-only "${DEFAULT_BRANCH}...HEAD" 2>/dev/null || echo "") \
  node -e "
    var fs = require('fs');
    var plan = fs.readFileSync('$TECH_PLAN_FILE', 'utf-8');
    var m = plan.match(/\x60\x60\x60mermaid([\s\S]*?)\x60\x60\x60/);
    if (!m) { process.exit(0); }
    var diagram = m[1];
    var tokens = [...diagram.matchAll(/[\w.\-\/]+\.[a-zA-Z0-9]{1,5}/g)].map(function(x){return x[0]});
    var basenames = tokens.map(function(t){return t.split('/').pop()});
    if (basenames.length === 0) { process.exit(0); }
    var diffFiles = (process.env.DIFF_FILES || '').split('\n').filter(Boolean);
    if (diffFiles.length === 0) { process.exit(0); }
    var diffBasenames = diffFiles.map(function(f){return f.split('/').pop()});
    var overlap = basenames.some(function(b){return diffBasenames.indexOf(b) !== -1});
    if (!overlap) {
      console.log('  WARNING — the Mermaid diagram mentions no file that appears in the actual diff.');
      console.log('  Diagram file-like tokens: ' + (basenames.slice(0,10).join(', ') || 'none'));
      console.log('  Diff changed files: ' + (diffBasenames.slice(0,10).join(', ') || 'none'));
      console.log('  Not blocking — Review still makes the real call — but the diagram may be stale.');
    } else {
      console.log('  OK — diagram references at least one file present in the diff.');
    }
  " 2>&1 || echo "  (diagram/diff check skipped)"

# 5. Review — with one retry: on FAIL, Dev gets the review findings and one
# more pass before the pipeline gives up. Unlike the typecheck retry, we do
# NOT discard the Dev's uncommitted work here: Review runs against committed
# code, so a retry means Dev incrementally fixes what's already there.
REVIEW_ATTEMPT=1
while true; do
  run_review_panel
  commit_stage "chore(review): $SLUG" review

  REVIEW_VERDICT=$(read_verdict review)
  if [ "$REVIEW_VERDICT" != "FAIL" ]; then
    break
  fi

  if [ "$REVIEW_ATTEMPT" -gt "$MAX_REVIEW_RETRIES" ]; then
    echo ""
    echo "  Review verdict: FAIL after retry — pipeline halted before QA and PR."
    echo "  See $ARTIFACTS_DIR/review-report.md."
    echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
    exit 1
  fi

  echo ""
  echo "  Review FAILED (attempt $REVIEW_ATTEMPT). Feeding findings back to Dev..."
  cp "$ARTIFACTS_DIR/review-report.md" "$ARTIFACTS_DIR/.agent-review-feedback.md" 2>/dev/null || true
  run_agent dev

  if ! run_quality_gates; then
    echo "  Quality gates FAILED after review-retry Dev pass. Aborting."
    echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
    exit 1
  fi
  commit_stage "chore(dev): $SLUG (review fix)" dev
  REVIEW_ATTEMPT=$((REVIEW_ATTEMPT + 1))
done

# 6. QA
run_agent qa
commit_stage "chore(qa): $SLUG" qa

QA_VERDICT=$(read_verdict qa)
if [ "$QA_VERDICT" = "FAIL" ]; then
  echo ""
  echo "  QA verdict: FAIL — pipeline will push branch but NOT create a PR."
  echo "  See $ARTIFACTS_DIR/qa-report.md for details."
  # Run retro so learnings are captured, but skip PR creation
  run_agent retro
  FEATURE_COUNT=$(bump_memory_compact_counter)
  commit_stage "chore(retro): $SLUG" retro
  run_memory_compact_if_due "$FEATURE_COUNT"
notify_skill_proposals
  if [ "$DRY_RUN" != "--dry-run" ]; then
    git push origin "$BRANCH" 2>&1 || echo "Push failed"
  fi
  echo ""
  echo "  Branch pushed: $BRANCH"
  echo "  QA failed — no PR created. Fix QA issues before opening a PR manually."
  echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
  exit 1
fi

# 7. Retrospective — compile session learnings
run_agent retro
FEATURE_COUNT=$(bump_memory_compact_counter)
commit_stage "chore(retro): $SLUG" retro
run_memory_compact_if_due "$FEATURE_COUNT"
notify_skill_proposals

# 8. Push branch (skip dry-run)
if [ "$DRY_RUN" != "--dry-run" ]; then
  # Auto-rebase if branch is behind main
  git fetch origin ${DEFAULT_BRANCH} 2>/dev/null || true
  AHEAD=$(git rev-list --count "HEAD..origin/${DEFAULT_BRANCH}" 2>/dev/null || echo "0")
  if [ "$AHEAD" -gt 0 ] 2>/dev/null; then
    echo "==> Branch is behind ${DEFAULT_BRANCH} by $AHEAD commit(s). Rebasing..."
    if git rebase "origin/${DEFAULT_BRANCH}" 2>&1; then
      echo "  Rebase successful."
    else
      echo "  Rebase failed (conflicts). Aborting rebase and pushing as-is."
      git rebase --abort 2>/dev/null || true
    fi
  fi
  git push origin "$BRANCH" 2>&1 || echo "Push failed (may already exist, continuing)"
fi

# 9. Create or update PR/MR
echo ""
echo "========================================="
echo "  Creating/updating PR..."
echo "========================================="

# Heuristic host detection from the remote URL — covers gitlab.com and
# self-hosted GitLab instances (hostname containing "gitlab") as well as
# github.com. Unknown hosts skip PR/MR creation instead of guessing.
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
if echo "$REMOTE_URL" | grep -qi "gitlab"; then
  GIT_HOST="gitlab"
elif echo "$REMOTE_URL" | grep -qi "github"; then
  GIT_HOST="github"
else
  GIT_HOST="unknown"
fi

# Build PR body from retrospective + diff summary
RETRO_FILE="$ARTIFACTS_DIR/retrospective.md"
DIFF_STAT=$(git diff ${DEFAULT_BRANCH}...HEAD --stat 2>/dev/null || echo "")
DIFF_SUMMARY=$(git diff ${DEFAULT_BRANCH}...HEAD --shortstat 2>/dev/null || echo "")

PR_BODY_FILE=$(mktemp)
trap 'rm -f "$PR_BODY_FILE"' EXIT

{
  echo '## Summary'
  echo ''
  echo "**Feature:** \`$SLUG\`"
  echo "**Pipeline:** PM - Dev Review - Architect - Dev - Review - QA"
  echo ''
  if [ -n "$DIFF_SUMMARY" ]; then
    echo '### Changes'
    echo ''
    echo "\`$DIFF_SUMMARY\`"
    echo ''
  fi
  if [ -f "$RETRO_FILE" ]; then
    echo '### Retrospective'
    echo ''
    head -80 "$RETRO_FILE" 2>/dev/null
    echo ''
  fi
  echo '---'
  echo ''
  echo '**Human:** review and merge.'
} > "$PR_BODY_FILE"
if [ "$GIT_HOST" = "github" ]; then
  EXISTING_PR=$(gh pr list --head "$BRANCH" --json number --jq '.[0].number' 2>/dev/null || echo "")
  if [ -n "$EXISTING_PR" ]; then
    gh pr edit "$EXISTING_PR" \
      --title "feat: $SLUG" \
      --body-file "$PR_BODY_FILE" \
      2>&1 || true
    echo "Updated existing PR #$EXISTING_PR"
  else
    gh pr create \
      --base ${DEFAULT_BRANCH} \
      --head "$BRANCH" \
      --title "feat: $SLUG" \
      --body-file "$PR_BODY_FILE" \
      2>&1 || echo "Failed to create PR"
  fi
elif [ "$GIT_HOST" = "gitlab" ]; then
  if command -v glab >/dev/null 2>&1; then
    # glab has no direct "list MR for this branch, then edit by id" one-liner
    # as clean as gh's; create first and fall back to update-by-branch on
    # the "already exists" error, mirroring the push step's create-or-noop
    # fallback style above instead of a separate lookup call.
    glab mr create \
      --source-branch "$BRANCH" \
      --target-branch "$DEFAULT_BRANCH" \
      --title "feat: $SLUG" \
      --description "$(cat "$PR_BODY_FILE")" \
      --yes \
      2>&1 || glab mr update "$BRANCH" \
        --title "feat: $SLUG" \
        --description "$(cat "$PR_BODY_FILE")" \
        2>&1 || echo "Failed to create/update MR"
  else
    echo "glab CLI not found — skipping MR creation. Install: https://gitlab.com/gitlab-org/cli"
  fi
else
  echo "Could not determine git host from remote '$REMOTE_URL' — skipping PR/MR creation."
fi

# 9.5 Optional iOS build upload — strictly opt-in via --upload-build, and only
# after the full pipeline (QA PASS, PR created) has succeeded. Deterministic
# asc CLI steps (archive → export → upload → optional TestFlight), no LLM.
# Skipped in dry-run: an upload is a real external side effect, not a
# rehearsal mechanic. A failure here preserves the worktree like any other
# gate failure — the PR already exists, so only the upload needs attention.
if [ "$UPLOAD_BUILD" = "true" ]; then
  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo ""
    echo "==> --upload-build requested but dry-run skips real uploads."
    bash "$SCRIPT_DIR/upload-build.sh" "$SLUG" --project-root="$PIPELINE_ROOT" --dry-run || \
      echo "  (upload dry-run reported a config problem — see above)"
  else
    echo ""
    echo "==> Uploading iOS build (--upload-build)..."
    if ! bash "$SCRIPT_DIR/upload-build.sh" "$SLUG" --project-root="$PIPELINE_ROOT"; then
      echo ""
      echo "  Build upload FAILED. The feature branch and PR are unaffected;"
      echo "  fix the issue and re-upload manually (see $ARTIFACTS_DIR/build-upload.md)."
      echo "  Worktree preserved for inspection: $PIPELINE_ROOT"
      exit 1
    fi
    # upload-build.sh committed the build-number bump and the upload report
    # AFTER step 8's push — push them now so the open PR carries the full
    # provenance (which commit produced which build) instead of stranding
    # those commits on the local branch.
    git push origin "$BRANCH" 2>&1 || echo "  Push failed — bump/report commits remain local on $BRANCH."
  fi
fi

# 10. Pipeline reached the end — the isolated worktree has served its
# purpose. Remove it; the branch itself lives on in git (local + pushed,
# unless this was a --dry-run rehearsal, in which case it's local-only).
cd "$ROOT"
git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true

echo ""
echo "========================================="
echo "  Pipeline complete!"
echo "  Feature: $SLUG"
echo "  Branch: $BRANCH"
echo "  PR created/updated if gh CLI available."
echo "========================================="
