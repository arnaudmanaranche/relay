// Unit tests for the rules that guard writes to .relay/agents.json.
// Run with: npm --prefix studio test
//
// Studio edits the file agent-runner.ts loads and validates at the start of
// every run. If Studio accepts a value that validateRegistry rejects, the
// next pipeline run dies with exit(1) for a reason the user set from a UI
// that told them it had saved. So the interesting assertions here are the
// refusals, and they are pinned against agent-runner.ts's own rules.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRolePatch,
  fileVersion,
  isStaleWrite,
  isStarterRef,
  isWithinRoot,
  parseFrontmatter,
  skillPathProblem,
  starterId,
  type RoleConfig,
} from '../server/registry.ts';

const ROOT = '/project';

/** Pretends the given project-relative paths exist, nothing else. */
function existsOnly(...paths: string[]) {
  const set = new Set(paths.map(p => `${ROOT}/${p}`));
  return (p: string) => set.has(p);
}

function role(over: Partial<RoleConfig> = {}): RoleConfig {
  return {
    skill: 'skills/pipeline/prompts/dev.md',
    model: 'claude-sonnet-5',
    artifact: 'dev-log.md',
    description: 'Developer',
    maxTokens: 8000,
    effort: 'high',
    ...over,
  };
}

describe('isWithinRoot', () => {
  test('accepts a path inside the project', () => {
    assert.equal(isWithinRoot(ROOT, '.relay/skills/x.md'), true);
  });

  test('accepts the root itself', () => {
    assert.equal(isWithinRoot(ROOT, '.'), true);
  });

  test('rejects a parent-directory escape', () => {
    assert.equal(isWithinRoot(ROOT, '../secrets.md'), false);
    assert.equal(isWithinRoot(ROOT, '.relay/../../secrets.md'), false);
  });

  test('rejects a sibling whose name starts with the root', () => {
    // /project-other must not pass a naive startsWith check.
    assert.equal(isWithinRoot('/project', '/project-other/x.md'), false);
  });
});

describe('starter refs', () => {
  test('a starter ref is recognised and is not a path', () => {
    assert.equal(isStarterRef('starter:code-style'), true);
    assert.equal(starterId('starter:code-style'), 'code-style');
    assert.equal(isStarterRef('.relay/skills/code-style.md'), false);
  });
});

describe('skillPathProblem', () => {
  test('accepts an existing project skill', () => {
    assert.equal(
      skillPathProblem(ROOT, '.relay/skills/x.md', existsOnly('.relay/skills/x.md')),
      null
    );
  });

  test('refuses a starter ref, because the pipeline resolves paths in the project', () => {
    const problem = skillPathProblem(ROOT, 'starter:code-style', existsOnly());
    assert.equal(problem?.status, 400);
    assert.match(problem!.error, /template/);
  });

  test('refuses an escape with 403', () => {
    assert.equal(skillPathProblem(ROOT, '../x.md', existsOnly())?.status, 403);
  });

  test('refuses a path with no file behind it with 404', () => {
    // The case that mattered: agent-runner.ts skips a missing skill in
    // silence, so this would look attached and never reach a prompt.
    const problem = skillPathProblem(ROOT, '.relay/skills/ghost.md', existsOnly());
    assert.equal(problem?.status, 404);
    assert.match(problem!.error, /No such skill file/);
  });
});

describe('applyRolePatch — effort', () => {
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
    test(`accepts ${level}`, () => {
      const target = role();
      assert.equal(applyRolePatch('dev', target, { effort: level }, ROOT, existsOnly()), null);
      assert.equal(target.effort, level);
    });
  }

  test('refuses a level agent-runner.ts would reject', () => {
    const target = role();
    const refusal = applyRolePatch('dev', target, { effort: 'turbo' }, ROOT, existsOnly());
    assert.equal(refusal?.status, 400);
    assert.equal(target.effort, 'high', 'must not be written when refused');
  });

  test('empty clears the field rather than writing a sentinel', () => {
    // Omitting effort is legal and means "the backend's default"; writing ''
    // would make the next run fail validation.
    const target = role();
    assert.equal(applyRolePatch('dev', target, { effort: '' }, ROOT, existsOnly()), null);
    assert.equal('effort' in target, false);
  });

  test('null clears the field too', () => {
    const target = role();
    assert.equal(applyRolePatch('dev', target, { effort: null }, ROOT, existsOnly()), null);
    assert.equal('effort' in target, false);
  });
});

describe('applyRolePatch — maxTokens', () => {
  test('accepts a positive integer', () => {
    const target = role();
    assert.equal(applyRolePatch('dev', target, { maxTokens: 12000 }, ROOT, existsOnly()), null);
    assert.equal(target.maxTokens, 12000);
  });

  for (const bad of [0, -1, 1.5, 'lots', null, NaN]) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      const target = role();
      assert.equal(
        applyRolePatch('dev', target, { maxTokens: bad }, ROOT, existsOnly())?.status,
        400
      );
      assert.equal(target.maxTokens, 8000);
    });
  }
});

describe('applyRolePatch — model', () => {
  test('accepts and trims', () => {
    const target = role();
    assert.equal(applyRolePatch('dev', target, { model: '  claude-opus-5 ' }, ROOT, existsOnly()), null);
    assert.equal(target.model, 'claude-opus-5');
  });

  for (const bad of ['', '   ', 42, null]) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      const target = role();
      assert.equal(applyRolePatch('dev', target, { model: bad }, ROOT, existsOnly())?.status, 400);
      assert.equal(target.model, 'claude-sonnet-5');
    });
  }
});

describe('applyRolePatch — extraSkills', () => {
  test('accepts existing project skills', () => {
    const target = role();
    const exists = existsOnly('.relay/skills/a.md', '.relay/skills/b.md');
    assert.equal(
      applyRolePatch('dev', target, { extraSkills: ['.relay/skills/a.md', '.relay/skills/b.md'] }, ROOT, exists),
      null
    );
    assert.deepEqual(target.extraSkills, ['.relay/skills/a.md', '.relay/skills/b.md']);
  });

  test('works for a role other than dev', () => {
    // The whole point of generalising extraSkills: Review and QA benefit most.
    const target = role({ description: 'Code Reviewer' });
    const exists = existsOnly('.relay/skills/a.md');
    assert.equal(
      applyRolePatch('review', target, { extraSkills: ['.relay/skills/a.md'] }, ROOT, exists),
      null
    );
    assert.deepEqual(target.extraSkills, ['.relay/skills/a.md']);
  });

  test('refuses a non-array', () => {
    const target = role();
    assert.equal(
      applyRolePatch('dev', target, { extraSkills: '.relay/skills/a.md' }, ROOT, existsOnly())?.status,
      400
    );
  });

  test('refuses an array with a non-string', () => {
    const target = role();
    assert.equal(applyRolePatch('dev', target, { extraSkills: [1] }, ROOT, existsOnly())?.status, 400);
  });

  test('refuses the whole list if one entry is bad, writing nothing', () => {
    const target = role({ extraSkills: ['.relay/skills/a.md'] });
    const exists = existsOnly('.relay/skills/a.md');
    const refusal = applyRolePatch(
      'dev',
      target,
      { extraSkills: ['.relay/skills/a.md', 'starter:code-style'] },
      ROOT,
      exists
    );
    assert.equal(refusal?.status, 400);
    assert.deepEqual(target.extraSkills, ['.relay/skills/a.md'], 'must be left as it was');
  });

  test('an empty array detaches everything', () => {
    const target = role({ extraSkills: ['.relay/skills/a.md'] });
    assert.equal(applyRolePatch('dev', target, { extraSkills: [] }, ROOT, existsOnly()), null);
    assert.deepEqual(target.extraSkills, []);
  });
});

describe('applyRolePatch — typeSkills', () => {
  test('accepts a pattern mapped to an existing skill, for dev', () => {
    const target = role();
    const exists = existsOnly('.relay/skills/ui.md');
    assert.equal(
      applyRolePatch('dev', target, { typeSkills: { '*.tsx': '.relay/skills/ui.md' } }, ROOT, exists),
      null
    );
    assert.deepEqual(target.typeSkills, { '*.tsx': '.relay/skills/ui.md' });
  });

  test('refuses it for any other role', () => {
    // It matches on the impacted-files list, which only Dev's plan provides.
    const target = role();
    const exists = existsOnly('.relay/skills/ui.md');
    const refusal = applyRolePatch('qa', target, { typeSkills: { '*.tsx': '.relay/skills/ui.md' } }, ROOT, exists);
    assert.equal(refusal?.status, 400);
    assert.match(refusal!.error, /dev role/);
  });

  test('refuses an empty pattern', () => {
    const target = role();
    const exists = existsOnly('.relay/skills/ui.md');
    assert.equal(
      applyRolePatch('dev', target, { typeSkills: { '  ': '.relay/skills/ui.md' } }, ROOT, exists)?.status,
      400
    );
  });

  test('refuses a non-string value', () => {
    const target = role();
    assert.equal(
      applyRolePatch('dev', target, { typeSkills: { '*.tsx': 7 } }, ROOT, existsOnly())?.status,
      400
    );
  });

  test('refuses an array', () => {
    const target = role();
    assert.equal(applyRolePatch('dev', target, { typeSkills: [] }, ROOT, existsOnly())?.status, 400);
  });

  test('an empty object clears the field', () => {
    const target = role({ typeSkills: { '*.tsx': '.relay/skills/ui.md' } });
    assert.equal(applyRolePatch('dev', target, { typeSkills: {} }, ROOT, existsOnly()), null);
    assert.equal('typeSkills' in target, false);
  });

  test('null clears the field', () => {
    const target = role({ typeSkills: { '*.tsx': '.relay/skills/ui.md' } });
    assert.equal(applyRolePatch('dev', target, { typeSkills: null }, ROOT, existsOnly()), null);
    assert.equal('typeSkills' in target, false);
  });
});

describe('applyRolePatch — shape', () => {
  test('an empty patch changes nothing', () => {
    const target = role();
    assert.equal(applyRolePatch('dev', target, {}, ROOT, existsOnly()), null);
    assert.deepEqual(target, role());
  });

  test('fields the registry needs are never removed by a patch', () => {
    const target = role();
    applyRolePatch('dev', target, { model: 'x', maxTokens: 1 }, ROOT, existsOnly());
    for (const field of ['skill', 'model', 'artifact', 'description', 'maxTokens'] as const) {
      assert.ok(target[field] !== undefined, `${field} must survive`);
    }
  });
});

describe('parseFrontmatter', () => {
  test('reads id and description', () => {
    const { meta, body } = parseFrontmatter('---\nid: ui\ndescription: UI rules\n---\n\n# Hi\n');
    assert.equal(meta.id, 'ui');
    assert.equal(meta.description, 'UI rules');
    assert.match(body, /# Hi/);
  });

  test('a file with no frontmatter is all body', () => {
    const { meta, body } = parseFrontmatter('# Code style\n\nNo frontmatter here.\n');
    assert.deepEqual(meta, {});
    assert.match(body, /Code style/);
  });

  test('a colon in the value survives', () => {
    const { meta } = parseFrontmatter('---\ndescription: see: this\n---\nx');
    assert.equal(meta.description, 'see: this');
  });
});

describe('isStaleWrite', () => {
  test('an absent version is not a conflict', () => {
    // A caller that did not read the file first is legal: a brand new file has
    // no version to conflict with.
    assert.equal(isStaleWrite(1000, undefined), false);
    assert.equal(isStaleWrite(1000, null), false);
  });

  test('the same version is not a conflict', () => {
    assert.equal(isStaleWrite(1788286132086, 1788286132086), false);
  });

  test('a different version is a conflict', () => {
    assert.equal(isStaleWrite(1788286132999, 1788286132086), true);
  });

  test('sub-millisecond drift from a JSON round-trip is not a conflict', () => {
    // statSync gives a float; comparing one for equality across JSON is a
    // coin toss, so both sides are rounded.
    assert.equal(isStaleWrite(1788286132086.4213, 1788286132086), false);
    assert.equal(isStaleWrite(1788286132085.6, 1788286132086), false);
  });

  test('a version that is not a number is ignored rather than refused', () => {
    // Refusing here would make a malformed client unable to save at all,
    // which is worse than falling back to no check.
    assert.equal(isStaleWrite(1000, 'nonsense'), false);
    assert.equal(isStaleWrite(1000, NaN), false);
  });

  test('a one-millisecond change is caught', () => {
    assert.equal(isStaleWrite(1001, 1000), true);
  });
});

describe('fileVersion', () => {
  test('rounds to whole milliseconds', () => {
    assert.equal(fileVersion(1788286132086.4213), 1788286132086);
    assert.equal(fileVersion(1788286132086.6), 1788286132087);
  });
});
