#!/usr/bin/env bash
# Mechanical auto-fixes applied to the worktree before the quality gates
# judge it. Sourced by run-pipeline.sh (`source "$SCRIPT_DIR/lib/autofix.sh"`)
# and unit-tested directly by test/autofix.test.mjs, which is why it lives in
# its own sourceable file rather than inline in the pipeline script.
#
# Why this runs BEFORE the gates rather than only before the commit:
# formatting and `--fix`-able lint rules are deterministic and mechanical.
# An agent can't reliably reproduce a project's exact prettier/biome/eslint
# config from a prompt (it never sees those config files — the Dev role runs
# with no filesystem tools), so its output routinely differs from the
# project's style in ways no human would call a bug. Left to the gates,
# every one of those nits costs a full Dev retry: minutes of wall clock and
# real money spent re-generating whole files to reach code a formatter
# would have fixed in milliseconds. So let the machine fix what the machine
# can, and let the gates only report what actually needs a human-grade
# decision.
#
# Both commands are best-effort by design (`|| true`): a missing or
# misconfigured formatter must never fail the stage. The gate that runs
# immediately after is the real verdict — if a lint error survives the fix
# pass, the gate still reports it and Dev still retries.

# Usage: apply_autofixes [format_write_cmd] [lint_fix_cmd]
# Falls back to the FORMAT_WRITE_CMD / LINT_FIX_CMD globals run-pipeline.sh
# already loads from `.relay/config.json`, so callers there need no args.
apply_autofixes() {
  local format_cmd="${1-${FORMAT_WRITE_CMD:-}}"
  local fix_cmd="${2-${LINT_FIX_CMD:-}}"

  # Lint fixes first, format second: `eslint --fix` rewrites code (import
  # order, quote style, unused-var removal) and its output is not
  # necessarily formatter-clean, whereas a formatter never introduces lint
  # errors. Running format last means whatever the fixer emitted still
  # lands formatted.
  # Each command runs in a subshell, not a bare `eval`. These strings come
  # from `.relay/config.json`, and `eval` executes in the *current* shell —
  # a command containing `exit` (or a `cd`, or a variable assignment) would
  # otherwise take the whole pipeline down or silently change its state,
  # and `|| true` cannot catch an `exit` at all. Found by
  # test/autofix.test.mjs's failing-fixer case, which killed the caller
  # instead of being swallowed.
  if [ -n "$fix_cmd" ]; then
    ( eval "$fix_cmd" ) >/dev/null 2>&1 || true
  fi
  if [ -n "$format_cmd" ]; then
    ( eval "$format_cmd" ) >/dev/null 2>&1 || true
  fi
  return 0
}
