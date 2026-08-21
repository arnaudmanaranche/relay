#!/usr/bin/env bash
# Build and upload an iOS app to App Store Connect — Relay module (opt-in)
# Usage: bash scripts/upload-build.sh <slug> --project-root=<path> [--dry-run]
#
# Invoked by run-pipeline.sh only when --upload-build is passed and the full
# pipeline (QA, PR) has succeeded. Deterministic by design: archive → export →
# upload → optional TestFlight via the asc CLI, following the asc-xcode-build
# and asc-build-lifecycle skills. No LLM calls — when something fails here the
# report says exactly which step and why, and a human decides what to do.
#
# Required config (.ai/config.json):
#   project.appId          — App Store Connect app ID (numeric or bundle id asc accepts)
#   ios.scheme             — Xcode scheme to archive
#   ios.workspace OR ios.project — path to .xcworkspace/.xcodeproj (workspace wins)
#   ios.configuration      — build configuration (default: Release)
#   ios.testflightGroup    — TestFlight group for post-upload distribution (optional)
#
# Credentials never live in config.json: asc reads ASC_KEY_ID / ASC_ISSUER_ID /
# ASC_PRIVATE_KEY_PATH (or keychain auth via `asc auth login`). The script only
# warns when no env credentials are visible, since keychain auth is legitimate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SLUG="${1:?Usage: $0 <slug> --project-root=<path> [--dry-run]}"
PROJECT_ROOT_ARG=""
DRY_RUN=""
for arg in "${@:2}"; do
  case "$arg" in
    --project-root=*) PROJECT_ROOT_ARG="${arg#*=}" ;;
    --dry-run) DRY_RUN="1" ;;
  esac
done
ROOT="${PROJECT_ROOT_ARG:-$(pwd)}"
ARTIFACTS_DIR=".ai/artifacts/features/$SLUG"
ASC_ARTIFACTS=".asc/artifacts"

cd "$ROOT"

read_config() {
  node -e "try{var c=JSON.parse(require('fs').readFileSync('$ROOT/.ai/config.json','utf-8'));var p='$1'.replace(/^\./,'').split('.');for(var k of p)c=c[k];if(c===undefined||c===null)throw new Error('undefined');console.log(c)}catch(e){console.log('$2')}"
}

APP_ID=$(read_config ".project.appId" "")
SCHEME=$(read_config ".ios.scheme" "")
WORKSPACE=$(read_config ".ios.workspace" "")
XCPROJECT=$(read_config ".ios.project" "")
CONFIGURATION=$(read_config ".ios.configuration" "Release")
TF_GROUP=$(read_config ".ios.testflightGroup" "")

fail() {
  echo "  $1" >&2
  exit 1
}

[ -n "$APP_ID" ] || fail "project.appId is empty in .ai/config.json — set it before using --upload-build."
[ -n "$SCHEME" ] || fail "ios.scheme is empty in .ai/config.json — set the Xcode scheme to archive."
if [ -z "$WORKSPACE" ] && [ -z "$XCPROJECT" ]; then
  fail "Neither ios.workspace nor ios.project is set in .ai/config.json."
fi
if [ -n "$WORKSPACE" ] && [ ! -e "$WORKSPACE" ]; then
  fail "ios.workspace '$WORKSPACE' does not exist (checked from project root)."
fi
if [ -z "$WORKSPACE" ] && [ -n "$XCPROJECT" ] && [ ! -e "$XCPROJECT" ]; then
  fail "ios.project '$XCPROJECT' does not exist (checked from project root)."
fi
command -v asc >/dev/null 2>&1 || fail "asc CLI not found on PATH — install it first (see https://asccli.sh). The skills driving it are installed separately."

if [ -z "${ASC_KEY_ID:-}" ] && [ -z "${ASC_ISSUER_ID:-}" ] && [ -z "${ASC_PRIVATE_KEY_PATH:-}" ] \
  && [ -z "${ASC_PRIVATE_KEY:-}" ] && [ -z "${ASC_PRIVATE_KEY_B64:-}" ]; then
  echo "  Note: no ASC_* credential env vars visible — relying on keychain auth (asc auth login)."
fi

# Source selector: workspace wins over bare project (CocoaPods apps only
# archive correctly from the workspace).
SRC_FLAG=""
if [ -n "$WORKSPACE" ]; then
  SRC_FLAG="--workspace \"$WORKSPACE\""
elif [ -n "$XCPROJECT" ]; then
  SRC_FLAG="--project \"$XCPROJECT\""
fi

ARCHIVE_PATH="$ASC_ARTIFACTS/$SCHEME.xcarchive"
IPA_PATH="$ASC_ARTIFACTS/$SCHEME.ipa"

run_asc() {
  local step="$1"; shift
  echo "==> [$step]"
  if [ -n "$DRY_RUN" ]; then
    echo "  (dry-run) asc $*"
    PLAN="${PLAN}- \`asc $*\`"$'\n'
    return 0
  fi
  if ! eval "asc $*" > "$STEP_OUT" 2>&1; then
    STEP_FAILED="$step"
    return 1
  fi
  return 0
}

mkdir -p "$ARTIFACTS_DIR" "$ASC_ARTIFACTS"
STEP_OUT=$(mktemp)
STEP_FAILED=""
PLAN=""
# Initialized up front: write_report references these on every failure path,
# including ones that fire before the upload/TF steps would set them (a
# reference under set -u to a not-yet-set variable kills the report mid-write).
BUILD_NUMBER=""
UPLOADED_BUILD=""
TF_STATUS="pending"
REPORT="$ARTIFACTS_DIR/build-upload.md"

write_report() {
  local status="$1"
  {
    echo "# Build upload — $SLUG"
    echo ""
    echo "- **Status:** $status"
    echo "- **Date:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- **App ID:** $APP_ID"
    echo "- **Scheme:** $SCHEME (configuration: $CONFIGURATION)"
    echo "- **Source:** ${WORKSPACE:-$XCPROJECT}"
    [ -n "$BUILD_NUMBER" ] && echo "- **Build number:** $BUILD_NUMBER"
    [ -n "$UPLOADED_BUILD" ] && echo "- **Uploaded build:** $UPLOADED_BUILD"
    if [ -n "$TF_GROUP" ]; then
      echo "- **TestFlight group:** $TF_GROUP — ${TF_STATUS:-pending}"
    else
      echo "- **TestFlight:** skipped (ios.testflightGroup not set)"
    fi
    if [ "$status" = "dry-run" ] && [ -n "$PLAN" ]; then
      echo ""
      echo "## Planned steps (nothing was executed)"
      echo ""
      printf '%s' "$PLAN"
    fi
    if [ "$status" != "success" ] && [ "$status" != "dry-run" ] && [ -f "$STEP_OUT" ]; then
      echo ""
      echo "## Failed at: $STEP_FAILED"
      echo '```'
      tail -40 "$STEP_OUT"
      echo '```'
    fi
  } > "$REPORT"
}

cleanup() {
  rm -f "$STEP_OUT"
}
trap cleanup EXIT

echo ""
echo "========================================="
echo "  iOS build upload — $SLUG"
echo "========================================="
echo "  App: $APP_ID | Scheme: $SCHEME | Config: $CONFIGURATION"
echo ""

# 1. Remote-safe build number applied to the project in one step — avoids the
# classic CFBundleVersion-too-low rejection after a prior upload.
if ! run_asc "build number" "xcode version edit --next-build-number --app \"$APP_ID\" --platform IOS --output json"; then
  write_report "failure"
  fail "Could not resolve/apply the next build number. See $REPORT"
fi
if [ -z "$DRY_RUN" ]; then
  BUILD_NUMBER=$(node -e "try{var o=JSON.parse(require('fs').readFileSync('$STEP_OUT','utf-8'));console.log(o.buildNumber||o.build||'')}catch(e){}" 2>/dev/null || true)
  # Commit the version bump so the uploaded build number is traceable to the
  # branch. `git add -u` stages tracked modifications only — the .asc/
  # artifacts are untracked and stay out of the commit.
  git add -u
  if ! git diff --cached --quiet; then
    git commit -m "chore(ship): bump build number for $SLUG upload" >/dev/null
  fi
fi

# 2. Archive
if ! run_asc "archive" "xcode archive $SRC_FLAG --scheme \"$SCHEME\" --configuration \"$CONFIGURATION\" --clean --archive-path \"$ARCHIVE_PATH\" --xcodebuild-flag=-destination --xcodebuild-flag=generic/platform=iOS --output json"; then
  write_report "failure"
  fail "Archive failed. See $REPORT"
fi

# 3. Export IPA (App Store Connect method, automatic signing)
if ! run_asc "export" "xcode export --archive-path \"$ARCHIVE_PATH\" --ipa-path \"$IPA_PATH\" --xcodebuild-flag=-allowProvisioningUpdates --output json"; then
  write_report "failure"
  fail "Export failed. See $REPORT"
fi

# 4. Upload and wait for processing
if ! run_asc "upload" "builds upload --app \"$APP_ID\" --ipa \"$IPA_PATH\" --wait --output json"; then
  write_report "failure"
  fail "Upload failed. See $REPORT"
fi
if [ -z "$DRY_RUN" ]; then
  UPLOADED_BUILD=$(node -e "try{var o=JSON.parse(require('fs').readFileSync('$STEP_OUT','utf-8'));var b=o.build||o;console.log([b.version,b.uploadedDate].filter(Boolean).join(' ')||'')}catch(e){}" 2>/dev/null || true)
fi

# 5. Optional TestFlight distribution
if [ -n "$TF_GROUP" ]; then
  if ! run_asc "testflight" "publish testflight --app \"$APP_ID\" --ipa \"$IPA_PATH\" --group \"$TF_GROUP\" --wait --output json"; then
    TF_STATUS="failed"
    write_report "partial"
    fail "Upload succeeded but TestFlight distribution failed. See $REPORT"
  fi
  TF_STATUS="distributed"
  [ -n "$DRY_RUN" ] && TF_STATUS="planned"
fi

if [ -n "$DRY_RUN" ]; then
  write_report "dry-run"
  echo ""
  echo "  Dry-run complete — no commands were executed. Plan written to $REPORT"
  exit 0
fi

write_report "success"

# Commit the report so it survives worktree cleanup and rides the branch into
# the open PR (run-pipeline.sh pushes after this script succeeds). Explicit
# path — never `git add -A`, the .asc/ artifacts stay untracked.
git add "$REPORT"
if ! git diff --cached --quiet; then
  git commit -m "chore(ship): record build upload for $SLUG" >/dev/null
fi

echo ""
echo "  Build uploaded to App Store Connect ($SCHEME${BUILD_NUMBER:+, build $BUILD_NUMBER})."
[ -n "$TF_GROUP" ] && echo "  TestFlight distribution to '$TF_GROUP' complete."
echo "  Report: $REPORT"
