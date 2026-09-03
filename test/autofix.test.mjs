// Tests for skills/pipeline/scripts/lib/autofix.sh
//
// apply_autofixes exists to keep mechanical fixes off the Dev retry loop, so
// what matters is observable ordering and best-effort semantics, not output.
// Each test sources the lib into a fresh bash -c, passes stub commands that
// append a marker line to a log file, then asserts on that log. Stubs are
// plain shell (`printf >> log`), not binaries on PATH — the lib `eval`s
// whatever string it is given, exactly as run-pipeline.sh passes a config
// value through.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIB = join(import.meta.dirname, '..', 'skills', 'pipeline', 'scripts', 'lib', 'autofix.sh');

const tmpDirs = [];
function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-autofix-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

// Runs a bash snippet with the lib sourced. `env` values are exported, which
// is how run-pipeline.sh's globals reach the function in production.
function runWithLib(snippet, env = {}) {
  // `set -euo pipefail` mirrors run-pipeline.sh's own shell options — the
  // point is that apply_autofixes must not abort the caller under them, even
  // when a fixer exits non-zero or a variable is unset.
  const script = `set -euo pipefail\nsource ${JSON.stringify(LIB)}\n${snippet}`;
  return execFileSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

function logLines(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
}

test('apply_autofixes runs the lint fixer before the formatter', () => {
  // Order is load-bearing: `eslint --fix` rewrites code (import order, quote
  // style) and its output is not necessarily formatter-clean, so the
  // formatter has to run last for the tree to end up formatted.
  const dir = makeTmpDir();
  const log = join(dir, 'calls.log');
  runWithLib(
    `apply_autofixes "printf 'format\\n' >> ${log}" "printf 'lintfix\\n' >> ${log}"`
  );
  assert.deepStrictEqual(logLines(log), ['lintfix', 'format']);
});

test('apply_autofixes falls back to the FORMAT_WRITE_CMD / LINT_FIX_CMD globals when called with no arguments', () => {
  // This is how run-pipeline.sh actually calls it — a bare `apply_autofixes`
  // inside run_quality_gates, with both commands read from
  // .relay/config.json into globals at startup.
  const dir = makeTmpDir();
  const log = join(dir, 'calls.log');
  runWithLib('apply_autofixes', {
    LINT_FIX_CMD: `printf 'lintfix\n' >> ${log}`,
    FORMAT_WRITE_CMD: `printf 'format\n' >> ${log}`,
  });
  assert.deepStrictEqual(logLines(log), ['lintfix', 'format']);
});

test('apply_autofixes skips an empty command instead of running an empty string', () => {
  const dir = makeTmpDir();
  const log = join(dir, 'calls.log');
  runWithLib(`apply_autofixes "" "printf 'lintfix\\n' >> ${log}"`);
  assert.deepStrictEqual(logLines(log), ['lintfix']);

  const log2 = join(dir, 'calls2.log');
  runWithLib(`apply_autofixes "printf 'format\\n' >> ${log2}" ""`);
  assert.deepStrictEqual(logLines(log2), ['format']);
});

test('apply_autofixes is a no-op with no globals set at all — a project with no lint or format tooling', () => {
  // `commands.lint`/`commands.formatWrite` are legitimately empty for a
  // project with no such tooling (detectLintCmd returns '' rather than
  // guessing), and `set -u` must not turn that into an unbound-variable
  // crash mid-pipeline.
  const out = runWithLib('apply_autofixes && echo survived');
  assert.match(out, /survived/);
});

test('a failing lint fixer does not fail the stage, and the formatter still runs', () => {
  // Best-effort by design: a missing or misconfigured fixer must never fail
  // a Dev pass. The quality gate that runs right after is the real verdict.
  const dir = makeTmpDir();
  const log = join(dir, 'calls.log');
  const out = runWithLib(
    `apply_autofixes "printf 'format\\n' >> ${log}" "printf 'lintfix\\n' >> ${log}; exit 3"\necho survived`
  );
  assert.match(out, /survived/);
  assert.deepStrictEqual(logLines(log), ['lintfix', 'format']);
});

test('a command that does not exist at all does not fail the stage', () => {
  const out = runWithLib(
    'apply_autofixes "relay-no-such-formatter ." "relay-no-such-linter --fix"\necho survived'
  );
  assert.match(out, /survived/);
});

test('apply_autofixes keeps fixer output off stdout so it never pollutes the gate feedback', () => {
  // run_quality_gates writes its own combined feedback file for the Dev
  // retry; a chatty formatter printing "1 file changed" into that stream
  // would read as a gate failure to whoever (or whatever) parses it.
  const out = runWithLib(
    'apply_autofixes "echo FORMATTER_NOISE" "echo LINTER_NOISE"\necho done'
  );
  assert.doesNotMatch(out, /NOISE/);
  assert.match(out, /done/);
});

test('run-pipeline.sh sources the lib and calls apply_autofixes inside run_quality_gates, before any gate command runs', () => {
  // Guards the wiring, not the lib: the whole point of step A is that the
  // fix pass happens BEFORE the lint gate reads the tree. If a later edit
  // moves the call after ${LINT_CMD}, the fix is silently useless again.
  const script = readFileSync(
    join(import.meta.dirname, '..', 'skills', 'pipeline', 'scripts', 'run-pipeline.sh'),
    'utf-8'
  );
  assert.match(script, /source "\$SCRIPT_DIR\/lib\/autofix\.sh"/);
  assert.match(script, /LINT_FIX_CMD=\$\(read_config "\.commands\.lintFix" ""\)/);

  const gateStart = script.indexOf('run_quality_gates() {');
  assert.ok(gateStart > 0, 'run_quality_gates must still exist');
  const gateBody = script.slice(gateStart, script.indexOf('\n}\n', gateStart));
  const callPos = gateBody.indexOf('apply_autofixes');
  const lintPos = gateBody.indexOf('${LINT_CMD}');
  const typecheckPos = gateBody.indexOf('${TYPECHECK_CMD}');
  assert.ok(callPos > 0, 'run_quality_gates must call apply_autofixes');
  assert.ok(lintPos > 0 && typecheckPos > 0, 'gate commands must still be there');
  assert.ok(callPos < typecheckPos, 'autofix must run before the typecheck gate');
  assert.ok(callPos < lintPos, 'autofix must run before the lint gate');
});
