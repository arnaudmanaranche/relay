// Unit tests for the evaluation harness scorer (eval-pipeline.mjs).
// Run with: npm test
//
// These prove the harness both PASSES a good golden artifact set and FAILS
// a degraded one — otherwise a green eval would mean nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCheck,
  scoreCase,
  loadCases,
  readArtifactFrom,
  compareScores,
  extractImpactedFiles,
  fileCoverageMissing,
} from '../skills/relay-pipeline/scripts/eval-pipeline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = resolve(__dirname, '../skills/relay-pipeline/eval');

describe('runCheck — individual rubric checks', () => {
  test('contains / absent', () => {
    assert.equal(runCheck({ type: 'contains', value: 'mermaid' }, 'a mermaid b'), true);
    assert.equal(runCheck({ type: 'contains', value: 'mermaid' }, 'nope'), false);
    assert.equal(runCheck({ type: 'absent', value: 'TBD' }, 'all filled'), true);
    assert.equal(runCheck({ type: 'absent', value: 'TBD' }, 'has TBD here'), false);
  });

  test('section matches a markdown heading at any level', () => {
    assert.equal(runCheck({ type: 'section', value: 'Acceptance criteria' }, '## Acceptance criteria\n'), true);
    assert.equal(runCheck({ type: 'section', value: 'Acceptance criteria' }, '# Acceptance Criteria & notes'), true);
    // The phrase in body text, not a heading, must NOT satisfy a section check.
    assert.equal(runCheck({ type: 'section', value: 'Acceptance criteria' }, 'see the acceptance criteria below'), false);
  });

  test('regex with default case-insensitive flags', () => {
    assert.equal(runCheck({ type: 'regex', value: 'Verdict.*PASS' }, '**Verdict:** PASS'), true);
    assert.equal(runCheck({ type: 'regex', value: 'Verdict.*PASS' }, 'Verdict: FAIL'), false);
  });

  test('unknown check type throws', () => {
    assert.throws(() => runCheck({ type: 'bogus', value: 'x' }, 'y'), /Unknown check type/);
  });

  test('file-coverage passes when every planned file was touched', () => {
    const plan = [
      '## Impacted Files',
      '- `hooks/use-add-item.ts` — wire the branch.',
      '- `utils/clothingSize.ts` — add the shoe table.',
    ].join('\n');
    const check = {
      type: 'file-coverage',
      touchedFiles: ['hooks/use-add-item.ts', 'utils/clothingSize.ts'],
    };
    assert.equal(runCheck(check, plan), true);
  });

  test('file-coverage fails and names the untouched file — the add-shoes-category-style gap', () => {
    // Mirrors the real incident: the plan named hooks/use-size-transition.ts
    // as needing a shoe-category branch, but Dev's batch judged (wrongly)
    // that no change was needed there, so it never landed in the diff.
    const plan = [
      '## Impacted Files',
      '- `utils/clothingSize.ts` — add the shoe outgrow progression.',
      '- `hooks/use-size-transition.ts` — branch on category === "shoes".',
    ].join('\n');
    const check = {
      type: 'file-coverage',
      // Only clothingSize.ts actually shows up in the real diff.
      touchedFiles: ['utils/clothingSize.ts'],
    };
    assert.equal(runCheck(check, plan), false);
    assert.deepEqual(fileCoverageMissing(check, plan), [
      'hooks/use-size-transition.ts',
    ]);
  });

  test('file-coverage falls back to context.touchedFiles when the check has none of its own', () => {
    const plan = '## Impacted Files\n- `a.ts` — thing.\n';
    assert.equal(
      runCheck({ type: 'file-coverage' }, plan, { touchedFiles: ['a.ts'] }),
      true
    );
    assert.equal(
      runCheck({ type: 'file-coverage' }, plan, { touchedFiles: [] }),
      false
    );
  });

  test("a check's own touchedFiles wins over context.touchedFiles", () => {
    const plan = '## Impacted Files\n- `a.ts` — thing.\n';
    const check = { type: 'file-coverage', touchedFiles: ['a.ts'] };
    // context says nothing was touched — the check's own list still wins.
    assert.equal(runCheck(check, plan, { touchedFiles: [] }), true);
  });
});

describe('extractImpactedFiles — parses the plan\'s own file list', () => {
  test('reads backticked paths under the Impacted Files heading only', () => {
    const plan = [
      '## Architecture',
      'Mirrors the existing `agent-runner.test.ts` pattern for comparison.',
      '## Impacted Files',
      '- `a.ts` — does a thing.',
      '- `b/c.tsx` — does another.',
      '## Risks',
      'None beyond the usual `d.ts` caveat mentioned for context.',
    ].join('\n');
    assert.deepEqual(extractImpactedFiles(plan), ['a.ts', 'b/c.tsx']);
  });

  test('empty/missing plan text yields no files', () => {
    assert.deepEqual(extractImpactedFiles(''), []);
    assert.deepEqual(extractImpactedFiles(undefined), []);
  });
});

describe('scoreCase — aggregate scoring', () => {
  const caseDef = {
    name: 'demo',
    threshold: 1.0,
    checks: [
      { artifact: 'brief.md', type: 'section', value: 'Goals' },
      { artifact: 'plan.md', type: 'contains', value: '```mermaid' },
    ],
  };

  test('all checks pass → score 1.0, passed true', () => {
    const reader = name =>
      name === 'brief.md' ? '## Goals\n' : '```mermaid\nA-->B\n```';
    const r = scoreCase(caseDef, reader);
    assert.equal(r.score, 1);
    assert.equal(r.passed, true);
  });

  test('one failing check drops below threshold → passed false', () => {
    const reader = name => (name === 'brief.md' ? '## Goals\n' : 'no diagram');
    const r = scoreCase(caseDef, reader);
    assert.equal(r.score, 0.5);
    assert.equal(r.passed, false);
  });

  test('a missing artifact fails its checks and is flagged missing', () => {
    const reader = name => (name === 'brief.md' ? '## Goals\n' : null);
    const r = scoreCase(caseDef, reader);
    assert.equal(r.passed, false);
    const planResult = r.results.find(x => x.artifact === 'plan.md');
    assert.equal(planResult.ok, false);
    assert.equal(planResult.missing, true);
  });

  test('a file-coverage check reports which planned files were missed, via run-level context', () => {
    const coverageCase = {
      name: 'demo',
      threshold: 1.0,
      checks: [
        { artifact: 'plan.md', type: 'file-coverage' },
      ],
    };
    const reader = () =>
      '## Impacted Files\n- `a.ts` — x.\n- `b.ts` — y.\n';
    const r = scoreCase(coverageCase, reader, { touchedFiles: ['a.ts'] });
    assert.equal(r.passed, false);
    assert.deepEqual(r.results[0].missingFiles, ['b.ts']);
  });
});

describe('compareScores — A/B baseline vs candidate', () => {
  const caseDef = {
    name: 'demo',
    threshold: 1.0,
    checks: [
      { artifact: 'a.md', type: 'contains', value: 'x' },
      { artifact: 'a.md', type: 'contains', value: 'y' },
    ],
  };
  const score = (hasX, hasY) =>
    scoreCase(caseDef, () => `${hasX ? 'x' : ''} ${hasY ? 'y' : ''}`);

  test('a strictly better candidate is not a regression, and reports the fix', () => {
    const cmp = compareScores(score(true, false), score(true, true));
    assert.equal(cmp.regressed, false);
    assert.ok(cmp.delta > 0);
    assert.deepEqual(cmp.fixes, ['a.md:contains:y']);
    assert.deepEqual(cmp.regressions, []);
  });

  test('a lower overall score is a regression', () => {
    const cmp = compareScores(score(true, true), score(true, false));
    assert.equal(cmp.regressed, true);
    assert.ok(cmp.delta < 0);
    assert.deepEqual(cmp.regressions, ['a.md:contains:y']);
  });

  test('same net score but a swapped check still counts as a regression', () => {
    // baseline passes x, fails y; candidate passes y, fails x — score is
    // identical (50%) but a previously-passing check now fails.
    const cmp = compareScores(score(true, false), score(false, true));
    assert.equal(cmp.delta, 0);
    assert.equal(cmp.regressed, true);
    assert.deepEqual(cmp.regressions, ['a.md:contains:x']);
    assert.deepEqual(cmp.fixes, ['a.md:contains:y']);
  });
});

describe('golden cases — the shipped fixtures actually pass their rubric', () => {
  test('every checked-in case scores at or above its threshold', () => {
    const cases = loadCases(join(EVAL_ROOT, 'cases'));
    assert.ok(cases.length > 0, 'expected at least one golden case');
    for (const caseDef of cases) {
      const baseDir = resolve(EVAL_ROOT, caseDef.artifactsDir);
      const scored = scoreCase(caseDef, readArtifactFrom(baseDir));
      assert.ok(
        scored.passed,
        `${caseDef.name} scored ${scored.score} < ${scored.threshold}: ` +
          scored.results
            .filter(r => !r.ok)
            .map(r => `${r.artifact}:${r.type}:${r.value}`)
            .join(', ')
      );
    }
  });
});
