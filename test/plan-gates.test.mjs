// Tests for skills/pipeline/scripts/lib/plan-gates.sh
//
// missing_plan_sections decides whether the pipeline spends another
// Architect call, so both directions matter: a complete plan must pass
// (a false positive burns money and can abort a good run), and an
// incomplete one must be named precisely enough for the retry message to
// be useful.
//
// Each test writes a real technical-plan.md to a temp dir and runs the
// function against it in a fresh bash -c with the lib sourced.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPTS = join(import.meta.dirname, '..', 'skills', 'pipeline', 'scripts');
const LIB = join(SCRIPTS, 'lib', 'plan-gates.sh');

const tmpDirs = [];
function writePlan(content) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-plan-gates-'));
  tmpDirs.push(dir);
  const file = join(dir, 'technical-plan.md');
  writeFileSync(file, content);
  return file;
}
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

// Returns { ok, missing } — `ok` is the function's exit status (0 = plan
// complete), `missing` its stdout description.
function checkPlan(planFile) {
  const script = [
    'set -euo pipefail',
    `source ${JSON.stringify(LIB)}`,
    `if missing=$(missing_plan_sections ${JSON.stringify(planFile)}); then`,
    '  printf "OK\\n"',
    'else',
    '  printf "MISSING:%s\\n" "$missing"',
    'fi',
  ].join('\n');
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf-8' }).trim();
  return out === 'OK'
    ? { ok: true, missing: '' }
    : { ok: false, missing: out.replace(/^MISSING:/, '') };
}

const DIAGRAM = ['```mermaid', 'sequenceDiagram', '    U->>S: does a thing', '```'].join('\n');

test('a plan with both a Mermaid diagram and a populated Data Model section passes', () => {
  const plan = writePlan(`# Technical Plan

## Diagram

${DIAGRAM}

## Data Model

- \`user_preferences.marketing_emails\` (\`boolean\`, not null) — new

## Impacted Files

- \`services/preferences.ts\` — add the setter
`);
  assert.deepStrictEqual(checkPlan(plan), { ok: true, missing: '' });
});

test('an explicit "None" Data Model body passes — a feature that persists nothing is not an incomplete plan', () => {
  // The Architect is told to write this exact sentence rather than drop the
  // section, so the gate must accept it. If it didn't, every UI-only feature
  // would burn a pointless Architect retry.
  const plan = writePlan(`## Diagram

${DIAGRAM}

## Data Model

None — this feature reads and writes no persisted data.

## Impacted Files
`);
  assert.strictEqual(checkPlan(plan).ok, true);
});

test('a Data Model heading with nothing under it fails — heading presence alone is too easy to satisfy', () => {
  const plan = writePlan(`## Diagram

${DIAGRAM}

## Data Model

## Impacted Files

- \`services/preferences.ts\` — add the setter
`);
  const result = checkPlan(plan);
  assert.strictEqual(result.ok, false);
  assert.match(result.missing, /Data Model/);
  assert.doesNotMatch(result.missing, /mermaid/);
});

test('a Data Model section holding only blank lines fails', () => {
  const plan = writePlan(`## Diagram\n\n${DIAGRAM}\n\n## Data Model\n\n   \n\t\n\n## Impacted Files\n`);
  assert.strictEqual(checkPlan(plan).ok, false);
});

test('a missing Data Model section is reported alone when the diagram is present', () => {
  const plan = writePlan(`## Diagram\n\n${DIAGRAM}\n\n## Impacted Files\n\n- \`a.ts\` — x\n`);
  const result = checkPlan(plan);
  assert.strictEqual(result.ok, false);
  assert.match(result.missing, /Data Model/);
});

test('a missing diagram is reported alone when the Data Model section is populated', () => {
  const plan = writePlan(`## Diagram\n\n(prose, no fenced block)\n\n## Data Model\n\n- \`t.c\` — read\n`);
  const result = checkPlan(plan);
  assert.strictEqual(result.ok, false);
  assert.match(result.missing, /mermaid/);
  assert.doesNotMatch(result.missing, /Data Model/);
});

test('a plan missing both is reported as one combined message, so it costs one retry rather than two', () => {
  const plan = writePlan('# Technical Plan\n\n## Architecture\n\nSome prose.\n');
  const result = checkPlan(plan);
  assert.strictEqual(result.ok, false);
  assert.match(result.missing, /mermaid/);
  assert.match(result.missing, /Data Model/);
  assert.match(result.missing, / and /);
});

test('a plan file that does not exist counts as missing everything instead of crashing the pipeline', () => {
  const result = checkPlan(join(tmpdir(), 'relay-no-such-plan-file.md'));
  assert.strictEqual(result.ok, false);
  assert.match(result.missing, /mermaid/);
  assert.match(result.missing, /Data Model/);
});

test('the heading match is case- and level-insensitive, and tolerates a suffixed heading', () => {
  for (const heading of ['## Data model', '### DATA MODEL', '## Data Model (new column)']) {
    const plan = writePlan(`## Diagram\n\n${DIAGRAM}\n\n${heading}\n\n- \`t.c\` — new\n`);
    assert.strictEqual(checkPlan(plan).ok, true, `heading should be accepted: ${heading}`);
  }
});

test('content under a different section does not count as the Data Model body', () => {
  // The section scan has to stop at the next heading — otherwise any plan
  // with a Data Model heading anywhere above other content passes trivially.
  const plan = writePlan(`## Diagram

${DIAGRAM}

## Data Model

## Impacted Files

- \`services/preferences.ts\` — add the setter
- \`app/settings.tsx\` — add the row
`);
  assert.strictEqual(checkPlan(plan).ok, false);
});

test('run-pipeline.sh sources the lib and gates the Architect stage on it, with one retry', () => {
  const script = readFileSync(join(SCRIPTS, 'run-pipeline.sh'), 'utf-8');
  assert.match(script, /source "\$SCRIPT_DIR\/lib\/plan-gates\.sh"/);
  assert.match(script, /while ! PLAN_MISSING=\$\(missing_plan_sections/);
  // The retry budget is deliberately one: a second failure aborts and
  // preserves the worktree rather than looping on a model that keeps
  // omitting the same section.
  assert.match(script, /PLAN_ATTEMPT" -ge 2/);
  assert.match(script, /Worktree preserved for inspection/);
});

test("the dry-run architect mock satisfies both gates, and its NO_DATA_MODEL seam defeats the new one", () => {
  // Without this the mock would abort every dry run at the new gate — and
  // the seam is what lets the retry path itself be exercised end-to-end.
  const runner = readFileSync(join(SCRIPTS, 'agent-runner.ts'), 'utf-8');
  assert.match(runner, /RELAY_MOCK_ARCHITECT_NO_DATA_MODEL/);
  assert.match(runner, /## Data Model/);
});
