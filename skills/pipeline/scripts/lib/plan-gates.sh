#!/usr/bin/env bash
# Structural completeness checks on the Architect's technical-plan.md.
# Sourced by run-pipeline.sh (`source "$SCRIPT_DIR/lib/plan-gates.sh"`) and
# unit-tested directly by test/plan-gates.test.mjs.
#
# These are the two things a plan cannot be missing, checked structurally
# rather than trusted to prompt wording:
#
# 1. A Mermaid diagram — without it the plan is prose, and Review has
#    nothing to check the actual diff's control/data flow against.
#
# 2. A non-empty Data Model section — the Dev role runs with no filesystem
#    tools (`claude -p --tools ''`), so the only code it ever sees is the
#    content of the files this plan lists under Impacted Files. A plan that
#    never names the tables and columns the feature touches is exactly how
#    Dev ends up inventing a schema: plausible column names, wrong ones,
#    caught by nobody until runtime, since typecheck only catches it when
#    the project happens to have generated DB types.
#
# Both are checked together, in one pass, so a plan missing both costs one
# Architect retry instead of two.

# Usage: missing_plan_sections <technical-plan.md>
# Prints a human-readable description of what's missing and returns 1;
# prints nothing and returns 0 when the plan is complete. A plan file that
# doesn't exist counts as missing everything.
missing_plan_sections() {
  local plan_file="$1"
  local missing=""

  if ! grep -q '```mermaid' "$plan_file" 2>/dev/null; then
    missing='a ```mermaid diagram'
  fi

  # Heading presence alone is too easy to satisfy — a model that doesn't
  # know what to write there emits the heading and nothing under it. So the
  # check is on the section's *body*: everything between a `## Data Model`
  # heading and the next `##`, with at least one non-blank line in it. An
  # explicit "None — this feature reads and writes no persisted data" is a
  # perfectly valid body, and the one the Architect is told to use for a
  # feature that genuinely touches no persisted data.
  local data_model
  data_model=$(awk '
    /^##/ { inside = (tolower($0) ~ /data model/); next }
    inside && $0 ~ /[^[:space:]]/ { print }
  ' "$plan_file" 2>/dev/null || true)
  if [ -z "$data_model" ]; then
    [ -n "$missing" ] && missing="$missing and "
    missing="${missing}a non-empty \`## Data Model\` section"
  fi

  if [ -n "$missing" ]; then
    printf '%s\n' "$missing"
    return 1
  fi
  return 0
}
