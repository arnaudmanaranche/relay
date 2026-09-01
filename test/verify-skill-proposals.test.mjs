// Unit tests for the skill-proposal gate verifier
// (skills/pipeline/scripts/verify-skill-proposals.mjs).
// Run with: npm test
//
// The verifier backs Retro's "pattern repeated 3+ times" LLM judgment with a
// deterministic count: slugs cited in a proposal's **Evidence** section must
// actually appear as (slug) tags under Conventions confirmed in project
// memory. These tests lock in both directions — a well-evidenced proposal
// passes, an under-evidenced one warns — plus the parsing edge cases the
// count depends on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  extractBoldSection,
  memoryCategorySlugs,
  citedSlugs,
  verifyProposal,
} from '../skills/pipeline/scripts/verify-skill-proposals.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER = resolve(
  __dirname,
  '../skills/pipeline/scripts/verify-skill-proposals.mjs'
);

describe('extractBoldSection', () => {
  const proposal = [
    '# Skill proposal',
    '',
    '- **Pattern observed** — toggles recur.',
    '- **Evidence** — seen in `a`, `b`, `c`; copy varied.',
    '- **Proposed skill** — takes a spec.',
  ].join('\n');

  test('extracts text between the label and the next bold label', () => {
    // The `— ` separator right after the label is consumed, not returned.
    assert.equal(
      extractBoldSection(proposal, 'Evidence'),
      'seen in `a`, `b`, `c`; copy varied.'
    );
  });

  test('last section runs to end of text', () => {
    assert.equal(extractBoldSection(proposal, 'Proposed skill'), 'takes a spec.');
  });

  test('returns null when the label is absent', () => {
    assert.equal(extractBoldSection('# nothing here', 'Evidence'), null);
  });

  test('label match is anchored to the full bold marker, not a prefix', () => {
    // "**Evidence**" must not be found inside "**Evidence-based**".
    const tricky = '- **Evidence-based** — other section.\n- **Evidence** — real one.';
    assert.equal(extractBoldSection(tricky, 'Evidence'), 'real one.');
  });
});

describe('memoryCategorySlugs', () => {
  const memory = [
    '# Project Memory',
    '',
    '## Pitfalls',
    '',
    '- Fabricating defaults is bad. (detector-tests)',
    '',
    '## Conventions confirmed',
    '',
    '- Use node:test only. (detector-tests)',
    '- Registry-first toggles. (settings-toggle)',
    '- Analytics events registered. (analytics-event)',
    '- Mentioned mid-line (not-a-tag) but tag ends the line (i18n-keys)',
    '- No tag at all on this bullet',
    '',
    '## Architecture decisions',
    '',
    '- Pure-function detectors. (detector-tests)',
  ].join('\n');

  test('collects distinct line-end tags from the named category only', () => {
    assert.deepEqual([...memoryCategorySlugs(memory, 'Conventions confirmed')].sort(), [
      'analytics-event',
      'detector-tests',
      'i18n-keys',
      'settings-toggle',
    ]);
  });

  test('ignores other categories and unknown categories', () => {
    // Pitfalls' (detector-tests) must not leak into another category's set.
    const only = memoryCategorySlugs(memory, 'Architecture decisions');
    assert.deepEqual([...only], ['detector-tests']);
    assert.equal(memoryCategorySlugs(memory, 'Nonexistent').size, 0);
  });

  test('deduplicates repeated tags', () => {
    const dup = '## Conventions confirmed\n\n- a (x)\n- b (x)\n- c (y)';
    assert.deepEqual([...memoryCategorySlugs(dup, 'Conventions confirmed')].sort(), ['x', 'y']);
  });
});

describe('citedSlugs', () => {
  const known = new Set(['dark-mode', 'test', 'analytics-event']);

  test('matches slugs on their own boundaries', () => {
    const text = 'Seen in `dark-mode` and analytics-event; not in others.';
    assert.deepEqual(citedSlugs(text, known), ['analytics-event', 'dark-mode']);
  });

  test('does not count a slug embedded in a longer token', () => {
    // "testing" contains "test"; "darker-mode-v2" extends "dark-mode"... but
    // "dark-mode" inside "dark-mode-v2" IS boundary-valid (hyphen allowed? no:
    // the lookahead rejects a following word char OR hyphen... "-v2" starts
    // with '-', so it must NOT count).
    const text = 'rolled into testing and dark-mode-v2';
    assert.deepEqual(citedSlugs(text, known), []);
  });

  test('counts each known slug at most once regardless of repetition', () => {
    const text = 'dark-mode, dark-mode, dark-mode again';
    assert.deepEqual(citedSlugs(text, known), ['dark-mode']);
  });
});

describe('verifyProposal', () => {
  const memoryText = [
    '## Conventions confirmed',
    '',
    '- Toggles registry-first. (settings-toggle)',
    '- Events registered. (analytics-event)',
    '- Keys added. (i18n-keys)',
  ].join('\n');

  const proposalWith = slugs => [
    '# Skill proposal',
    '',
    '- **Pattern observed** — toggles recur.',
    `- **Evidence** — seen in ${slugs.map(s => '`' + s + '`').join(', ')}.`,
    '- **Proposed skill** — takes a spec.',
  ].join('\n');

  test('3+ verifiable cited slugs → ok', () => {
    const r = verifyProposal(
      proposalWith(['settings-toggle', 'analytics-event', 'i18n-keys']),
      memoryText
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.cited, ['analytics-event', 'i18n-keys', 'settings-toggle']);
  });

  test('fewer than 3 verifiable slugs → not ok, with the shortfall explained', () => {
    const r = verifyProposal(proposalWith(['settings-toggle']), memoryText);
    assert.equal(r.ok, false);
    assert.deepEqual(r.cited, ['settings-toggle']);
    assert.match(r.reason, /only 1 of the cited slugs/);
  });

  test('citing slugs that exist nowhere in memory counts zero', () => {
    const r = verifyProposal(proposalWith(['ghost-one', 'ghost-two', 'ghost-three']), memoryText);
    assert.equal(r.ok, false);
    assert.deepEqual(r.cited, []);
  });

  test('a proposal without an Evidence section fails cleanly', () => {
    const r = verifyProposal('# just prose\n\nno evidence here', memoryText);
    assert.equal(r.ok, false);
    assert.match(r.reason, /no \*\*Evidence\*\* section/);
  });

  test('memory without slug-tagged conventions fails cleanly', () => {
    const r = verifyProposal(
      proposalWith(['a', 'b', 'c']),
      '## Conventions confirmed\n\n- untagged bullet'
    );
    assert.equal(r.ok, false);
    assert.match(r.reason, /no \(slug\)-tagged bullets/);
  });

  test('minSlugs is honored', () => {
    const r = verifyProposal(
      proposalWith(['settings-toggle', 'analytics-event']),
      memoryText,
      2
    );
    assert.equal(r.ok, true);
  });
});

describe('CLI — advisory end-to-end over temp fixtures', () => {
  function withFixture(fn) {
    const root = mkdtempSync(join(tmpdir(), 'relay-verify-proposals-'));
    try {
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const memory = [
    '## Conventions confirmed',
    '',
    '- Toggles. (settings-toggle)',
    '- Events. (analytics-event)',
    '- Keys. (i18n-keys)',
  ].join('\n');

  const strongProposal = [
    '- **Pattern observed** — x',
    '- **Evidence** — `settings-toggle`, `analytics-event`, `i18n-keys`',
  ].join('\n');
  const weakProposal = [
    '- **Pattern observed** — x',
    '- **Evidence** — only `settings-toggle` this time',
  ].join('\n');

  function runCli(root) {
    return execFileSync(
      process.execPath,
      [VERIFIER, '--memory=.ai/project-memory.md', '--proposals-dir=.ai/artifacts/skill-proposals'],
      { cwd: root, encoding: 'utf-8' }
    );
  }

  test('strong evidence prints OK; weak evidence prints WARNING; exit code stays 0 either way', () => {
    withFixture(root => {
      mkdirSync(join(root, '.ai/artifacts/skill-proposals'), { recursive: true });
      writeFileSync(join(root, '.ai/project-memory.md'), memory);
      writeFileSync(
        join(root, '.ai/artifacts/skill-proposals/strong.md'),
        strongProposal
      );
      writeFileSync(join(root, '.ai/artifacts/skill-proposals/weak.md'), weakProposal);
      const out = runCli(root);
      assert.match(out, /OK — strong\.md: evidence cites 3 slugs/);
      assert.match(out, /WARNING — weak\.md: only 1 of the cited slugs/);
    });
  });

  test('missing memory file skips verification instead of failing', () => {
    withFixture(root => {
      mkdirSync(join(root, '.ai/artifacts/skill-proposals'), { recursive: true });
      writeFileSync(join(root, '.ai/artifacts/skill-proposals/a.md'), strongProposal);
      const out = runCli(root);
      assert.match(out, /verification skipped/);
    });
  });

  test('empty proposals directory reports nothing to verify', () => {
    withFixture(root => {
      mkdirSync(join(root, '.ai/artifacts/skill-proposals'), { recursive: true });
      writeFileSync(join(root, '.ai/project-memory.md'), memory);
      const out = runCli(root);
      assert.match(out, /nothing to verify/);
    });
  });
});
