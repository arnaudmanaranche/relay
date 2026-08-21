// Unit tests for the structured-output and permission logic in agent-runner.ts.
// Run with: npm test (node --import tsx --test)
//
// These target the highest-risk part of the pipeline for an autonomous
// multi-agent system: does the same input always produce the same,
// schema-valid, permission-checked output? A model that drifts in phrasing
// must not be able to drift in file-write behavior.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkPermissions,
  getMatchingTypeSkills,
  buildToolSchema,
  buildTool,
  parseToolArgs,
  mockResponse,
  applyChanges,
  isWithinRoot,
  isOverBudget,
  isOverCostBudget,
  loadTokenUsage,
  saveTokenUsage,
  validateRegistry,
  REQUIRED_ROLES,
  normalizeArtifactPath,
  missingRequiredFields,
  trimContextForPrompt,
  evaluateClaudeCliResult,
  extractImpactedFiles,
  scopeToRetryFiles,
  buildArchitectTask,
  filterArchitectPassArtifacts,
} from '../skills/relay-pipeline/scripts/agent-runner.ts';
import type { TokenUsage } from '../skills/relay-pipeline/scripts/agent-runner.ts';

describe('buildToolSchema', () => {
  test('only the dev role accepts a files array', () => {
    const devSchema: any = buildToolSchema('dev');
    assert.ok(devSchema.properties.files, 'dev schema must allow files');
    assert.ok(devSchema.required.includes('files'));

    for (const role of ['pm', 'architect', 'review', 'qa', 'retro']) {
      const schema: any = buildToolSchema(role);
      assert.equal(
        schema.properties.files,
        undefined,
        `${role} schema must not allow files`
      );
    }
  });

  test('verdict enum matches the role — no verdict field for roles without one', () => {
    const noVerdictRoles = ['pm', 'architect', 'dev', 'retro'];
    for (const role of noVerdictRoles) {
      const schema: any = buildToolSchema(role);
      assert.equal(schema.properties.verdict, undefined, `${role} should have no verdict field`);
    }

    const expected: Record<string, string[]> = {
      'dev-review': ['clear', 'questions', 'blocked'],
      'pm-respond': ['resolved', 'blocked'],
      review: ['PASS', 'PASS_WITH_NOTES', 'FAIL'],
      qa: ['PASS', 'FAIL', 'BLOCKED_ENV'],
    };
    for (const [role, enumValues] of Object.entries(expected)) {
      const schema: any = buildToolSchema(role);
      assert.deepEqual(schema.properties.verdict.enum, enumValues, role);
      assert.ok(schema.required.includes('verdict'), role);
    }
  });

  test('schema rejects additional properties (forces the model into the exact shape)', () => {
    for (const role of ['pm', 'dev', 'review']) {
      const schema: any = buildToolSchema(role);
      assert.equal(schema.additionalProperties, false, role);
    }
  });

  test('buildTool wraps the schema as a submit_changes function tool', () => {
    const tool: any = buildTool('dev');
    assert.equal(tool.type, 'function');
    assert.equal(tool.function.name, 'submit_changes');
    assert.deepEqual(tool.function.parameters, buildToolSchema('dev'));
  });
});

describe('parseToolArgs', () => {
  test('parses a well-formed submit_changes payload', () => {
    const raw = JSON.stringify({
      files: [{ path: 'a.ts', action: 'modify', content: 'x' }],
      artifacts: [{ path: '.ai/artifacts/features/x/dev-log.md', action: 'create', content: 'log' }],
      verdict: 'PASS',
    });
    const result = parseToolArgs(raw, 'review', 'x');
    assert.equal(result.files.length, 1);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.verdict, 'PASS');
    assert.equal(result.raw, raw);
  });

  test('missing arrays default to empty rather than throwing', () => {
    const result = parseToolArgs(JSON.stringify({ verdict: 'clear' }), 'pm', 'x');
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.artifacts, []);
    assert.equal(result.verdict, 'clear');
  });

  test('non-string verdict is treated as absent, not coerced', () => {
    const result = parseToolArgs(JSON.stringify({ artifacts: [], verdict: 123 }), 'qa', 'x');
    assert.equal(result.verdict, '');
  });
});

describe('checkPermissions', () => {
  test('pm cannot write source files even if the model tries', () => {
    const { allowed, blocked } = checkPermissions(
      'pm',
      [{ path: 'src/evil.ts', action: 'create', content: '' }],
      []
    );
    assert.equal(allowed, false);
    assert.equal(blocked.length, 1);
  });

  test('dev can write source files matching allowed extensions', () => {
    const { allowed } = checkPermissions(
      'dev',
      [{ path: 'src/feature.tsx', action: 'modify', content: '' }],
      [{ path: '.ai/artifacts/features/x/dev-log.md', action: 'create', content: '' }]
    );
    assert.equal(allowed, true);
  });

  test('dev can write .mjs/.cjs files', () => {
    // Found live while dogfooding: no .mjs/.cjs in dev's allowedFiles
    // meant every single write for a project using those extensions (this
    // repo's own detector test files) was rejected — a hard,
    // unconditional block, not just a cost/efficiency gap.
    for (const path of ['test/detectors/commands.test.mjs', 'scripts/build.cjs']) {
      const { allowed } = checkPermissions(
        'dev',
        [{ path, action: 'create', content: '' }],
        []
      );
      assert.equal(allowed, true, path);
    }
  });

  test('dev cannot write outside the allowed extension set (e.g. a shell script)', () => {
    const { allowed, blocked } = checkPermissions(
      'dev',
      [{ path: 'scripts/deploy.sh', action: 'create', content: '' }],
      []
    );
    assert.equal(allowed, false);
    assert.match(blocked[0], /scripts\/deploy\.sh/);
  });

  test('review cannot write any source files, only .md artifacts', () => {
    const { allowed } = checkPermissions(
      'review',
      [],
      [{ path: '.ai/artifacts/features/x/review-report.md', action: 'create', content: '' }]
    );
    assert.equal(allowed, true);
  });

  test('retro is the only role allowed to write project-memory.md', () => {
    for (const role of ['pm', 'dev', 'review', 'qa']) {
      const { allowed } = checkPermissions(
        role,
        [],
        [{ path: '.ai/project-memory.md', action: 'update', content: '' }]
      );
      assert.equal(allowed, false, role);
    }
    const { allowed } = checkPermissions(
      'retro',
      [],
      [{ path: '.ai/project-memory.md', action: 'update', content: '' }]
    );
    assert.equal(allowed, true);
  });

  test('path traversal is blocked even when the extension matches an allowed pattern', () => {
    // `../../../../tmp/pwned.ts` ends in `.ts`, which the dev role's
    // allowedFiles regex happily matches on the string alone — this is
    // exactly why containment has to be checked independently of the
    // extension/pattern regexes, not folded into them.
    const { allowed, blocked } = checkPermissions(
      'dev',
      [{ path: '../../../../tmp/pwned.ts', action: 'create', content: 'evil' }],
      []
    );
    assert.equal(allowed, false);
    assert.match(blocked[0], /escapes project root/);
  });

  test('path traversal in an artifact path is blocked the same way', () => {
    // The artifact regex only checks that ".ai/artifacts/...md" appears
    // somewhere in the string — .test() is unanchored, so a leading `../`
    // sequence in front of a legitimate-looking suffix still matches it.
    const { allowed, blocked } = checkPermissions(
      'pm',
      [],
      [{ path: '../../.ai/artifacts/features/x/evil.md', action: 'create', content: '' }]
    );
    assert.equal(allowed, false);
    assert.match(blocked[0], /escapes project root/);
  });

  test('a role with no PERMISSIONS entry still gets path containment enforced', () => {
    const { allowed, blocked } = checkPermissions(
      'some-future-role-not-yet-in-PERMISSIONS',
      [{ path: '../../../../tmp/pwned.ts', action: 'create', content: '' }],
      []
    );
    assert.equal(allowed, false);
    assert.match(blocked[0], /escapes project root/);
  });
});

describe('isWithinRoot', () => {
  test('a normal relative path resolves inside root', () => {
    assert.equal(isWithinRoot('src/feature.ts'), true);
    assert.equal(isWithinRoot('.ai/artifacts/features/x/dev-log.md'), true);
  });

  test('a traversal path that escapes the process root is rejected', () => {
    assert.equal(isWithinRoot('../../../../tmp/pwned.ts'), false);
    assert.equal(isWithinRoot('../../etc/passwd'), false);
  });

  test('an absolute path outside root is rejected', () => {
    assert.equal(isWithinRoot('/etc/passwd'), false);
  });
});

describe('getMatchingTypeSkills', () => {
  test('matches directory-prefixed skills', () => {
    const skills = getMatchingTypeSkills('src/components/Button.tsx', {
      'src/components': 'skills/component-standards.md',
      'src/services': 'skills/service-standards.md',
    });
    assert.deepEqual(skills, ['skills/component-standards.md']);
  });

  test('matches wildcard suffix skills (e.g. *.test.ts)', () => {
    const skills = getMatchingTypeSkills('src/services/api.test.ts', {
      '*.test.ts': 'skills/test-standards.md',
    });
    assert.deepEqual(skills, ['skills/test-standards.md']);
  });

  test('deduplicates when multiple patterns match the same skill', () => {
    const skills = getMatchingTypeSkills('src/components/Button.tsx', {
      'src/components': 'skills/shared.md',
      components: 'skills/shared.md',
    });
    assert.deepEqual(skills, ['skills/shared.md']);
  });
});

describe('mockResponse — dry-run output stability', () => {
  test('is deterministic across repeated calls for the same role/slug', () => {
    const a = mockResponse('pm', 'dark-mode');
    const b = mockResponse('pm', 'dark-mode');
    assert.deepEqual(a, b);
  });

  test('every mocked role produces schema-shaped output (files/artifacts/verdict/raw)', () => {
    for (const role of ['pm', 'dev-review', 'dev', 'review', 'qa', 'retro']) {
      const result: any = mockResponse(role, 'slug');
      assert.ok(Array.isArray(result.files), role);
      assert.ok(Array.isArray(result.artifacts), role);
      assert.equal(typeof result.verdict, 'string', role);
      assert.equal(typeof result.raw, 'string', role);
    }
  });
});

describe('applyChanges — golden write behavior', () => {
  function withTempRoot(fn: (root: string) => void) {
    const root = mkdtempSync(join(tmpdir(), 'relay-test-'));
    try {
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('dry-run skips writing source files but still writes artifacts', () => {
    withTempRoot(root => {
      const cwd = process.cwd();
      process.chdir(root);
      try {
        applyChanges(
          'dev',
          [{ path: 'src/feature.ts', action: 'modify', content: 'export const x = 1;\n' }],
          [{ path: '.ai/artifacts/features/x/dev-log.md', action: 'create', content: 'log\n' }],
          'x',
          true
        );
        assert.throws(() => readFileSync(join(root, 'src/feature.ts')));
        const artifact = readFileSync(
          join(root, '.ai/artifacts/features/x/dev-log.md'),
          'utf-8'
        );
        assert.equal(artifact, 'log\n');
      } finally {
        process.chdir(cwd);
      }
    });
  });

  test('a role denied write permission causes applyChanges to exit(1) without writing', () => {
    withTempRoot(root => {
      const cwd = process.cwd();
      process.chdir(root);
      const originalExit = process.exit;
      let exitCode: number | undefined;
      process.exit = (code?: number) => {
        exitCode = code;
        throw new Error('__exit__');
      };
      try {
        assert.throws(
          () =>
            applyChanges(
              'pm',
              [{ path: 'src/should-not-write.ts', action: 'create', content: 'x' }],
              [],
              'x',
              false
            ),
          /__exit__/
        );
        assert.equal(exitCode, 1);
        assert.throws(() => readFileSync(join(root, 'src/should-not-write.ts')));
      } finally {
        process.exit = originalExit;
        process.chdir(cwd);
      }
    });
  });

  test('a path-traversal attempt is refused end-to-end — nothing is written outside root', () => {
    withTempRoot(root => {
      const cwd = process.cwd();
      process.chdir(root);
      const originalExit = process.exit;
      let exitCode: number | undefined;
      process.exit = (code?: number) => {
        exitCode = code;
        throw new Error('__exit__');
      };
      // Sibling of `root` (both live under the same mkdtemp parent), i.e.
      // exactly where `../escape.ts` would land if containment failed.
      const escapeTarget = join(root, '..', 'relay-traversal-escape.ts');
      try {
        assert.throws(
          () =>
            applyChanges(
              'dev',
              [{ path: '../relay-traversal-escape.ts', action: 'create', content: 'evil' }],
              [],
              'x',
              false
            ),
          /__exit__/
        );
        assert.equal(exitCode, 1);
        assert.throws(() => readFileSync(escapeTarget));
      } finally {
        process.exit = originalExit;
        process.chdir(cwd);
        rmSync(escapeTarget, { force: true });
      }
    });
  });
});

describe('isOverBudget — token spend circuit breaker', () => {
  test('no budget configured means never over budget', () => {
    assert.equal(isOverBudget({ totalTokens: 999_999_999, totalCostUsd: 0, calls: [] }, undefined), false);
    assert.equal(isOverBudget({ totalTokens: 999_999_999, totalCostUsd: 0, calls: [] }, 0), false);
  });

  test('under budget is not blocked', () => {
    assert.equal(isOverBudget({ totalTokens: 100, totalCostUsd: 0, calls: [] }, 1000), false);
  });

  test('at or over budget is blocked', () => {
    assert.equal(isOverBudget({ totalTokens: 1000, totalCostUsd: 0, calls: [] }, 1000), true);
    assert.equal(isOverBudget({ totalTokens: 1500, totalCostUsd: 0, calls: [] }, 1000), true);
  });
});

describe('isOverCostBudget — $ spend circuit breaker', () => {
  test('no budget configured means never over budget', () => {
    assert.equal(isOverCostBudget({ totalTokens: 0, totalCostUsd: 999, calls: [] }, undefined), false);
    assert.equal(isOverCostBudget({ totalTokens: 0, totalCostUsd: 999, calls: [] }, 0), false);
  });

  test('under budget is not blocked', () => {
    assert.equal(isOverCostBudget({ totalTokens: 0, totalCostUsd: 5, calls: [] }, 15), false);
  });

  test('at or over budget is blocked', () => {
    assert.equal(isOverCostBudget({ totalTokens: 0, totalCostUsd: 15, calls: [] }, 15), true);
    assert.equal(isOverCostBudget({ totalTokens: 0, totalCostUsd: 20, calls: [] }, 15), true);
  });

  test('untracked cost (backend never reported one) never false-triggers', () => {
    // totalCostUsd stays 0 when no call ever reported cost — must not be
    // mistaken for "$0 spent, still under any budget" in a way that later
    // reads as "cost tracking works" when it silently never ran.
    assert.equal(isOverCostBudget({ totalTokens: 50_000, totalCostUsd: 0, calls: [] }, 15), false);
  });
});

describe('loadTokenUsage / saveTokenUsage — disk round-trip', () => {
  test('missing usage file defaults to zero, and a saved value round-trips', () => {
    const root = mkdtempSync(join(tmpdir(), 'relay-test-'));
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const featureDir = '.ai/artifacts/features/x';
      const initial = loadTokenUsage(featureDir);
      // `assert.deepEqual` is typed as an assertion function (`asserts
      // actual is T`), so it narrows `initial`'s type to match this
      // literal's inferred type — cast (not `satisfies`, which keeps the
      // narrow literal type) to TokenUsage, otherwise the empty `calls: []`
      // narrows to `never[]` and the .push() below fails to typecheck even
      // though it's runtime-correct.
      assert.deepEqual(initial, { totalTokens: 0, totalCostUsd: 0, calls: [] } as TokenUsage);

      initial.totalTokens += 500;
      initial.totalCostUsd += 0.12;
      initial.calls.push({ role: 'pm', tokens: 500, costUsd: 0.12 });
      saveTokenUsage(featureDir, initial);

      const reloaded = loadTokenUsage(featureDir);
      assert.deepEqual(reloaded, {
        totalTokens: 500,
        totalCostUsd: 0.12,
        calls: [{ role: 'pm', tokens: 500, costUsd: 0.12 }],
      });
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('validateRegistry — .ai/agents.json schema validation', () => {
  function validRoles() {
    const role = () => ({ skill: 's.md', model: 'm', artifact: 'a.md', description: 'd', maxTokens: 1000 });
    const roles: Record<string, unknown> = {};
    for (const name of REQUIRED_ROLES) roles[name] = role();
    return roles;
  }

  function runWithStubbedExit(fn: () => void): { exitCode: number | undefined; errors: string[] } {
    const originalExit = process.exit;
    const originalError = console.error;
    const errors: string[] = [];
    let exitCode: number | undefined;
    process.exit = (code?: number) => {
      exitCode = code;
      throw new Error('__exit__');
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.join(' '));
    };
    try {
      fn();
    } catch (e) {
      if (!(e instanceof Error) || e.message !== '__exit__') throw e;
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
    return { exitCode, errors };
  }

  test('a complete, well-formed registry passes through unchanged', () => {
    const roles = validRoles();
    const result = validateRegistry({ roles }, '.ai/agents.json');
    assert.deepEqual(Object.keys(result).sort(), REQUIRED_ROLES.slice().sort());
  });

  test('a missing required role is rejected with its name in the error', () => {
    const roles = validRoles();
    delete roles['memory-compact'];
    const { exitCode, errors } = runWithStubbedExit(() =>
      validateRegistry({ roles }, '.ai/agents.json')
    );
    assert.equal(exitCode, 1);
    assert.ok(errors.some(e => e.includes('memory-compact')), errors.join('\n'));
  });

  test('a role missing a required field is rejected', () => {
    const roles = validRoles();
    (roles.dev as any).model = '';
    const { exitCode, errors } = runWithStubbedExit(() =>
      validateRegistry({ roles }, '.ai/agents.json')
    );
    assert.equal(exitCode, 1);
    assert.ok(errors.some(e => e.includes('roles.dev.model')), errors.join('\n'));
  });

  test('a non-positive maxTokens is rejected', () => {
    const roles = validRoles();
    (roles.pm as any).maxTokens = 0;
    const { exitCode, errors } = runWithStubbedExit(() =>
      validateRegistry({ roles }, '.ai/agents.json')
    );
    assert.equal(exitCode, 1);
    assert.ok(errors.some(e => e.includes('roles.pm.maxTokens')), errors.join('\n'));
  });

  test('a missing "roles" object entirely is rejected', () => {
    const { exitCode } = runWithStubbedExit(() =>
      validateRegistry({}, '.ai/agents.json')
    );
    assert.equal(exitCode, 1);
  });
});

describe('normalizeArtifactPath — model-returned bare filenames', () => {
  test('a bare filename gets prefixed with the feature artifact directory', () => {
    // Found live: PM's task instructions spell out the full path, but the
    // schema only describes the convention in prose — a real model still
    // submitted "feature-brief.md" instead of the full path.
    assert.equal(
      normalizeArtifactPath('feature-brief.md', 'monthly-size-reminder'),
      '.ai/artifacts/features/monthly-size-reminder/feature-brief.md'
    );
  });

  test('a path already under .ai/ is left untouched', () => {
    assert.equal(
      normalizeArtifactPath('.ai/artifacts/features/x/dev-log.md', 'x'),
      '.ai/artifacts/features/x/dev-log.md'
    );
    assert.equal(normalizeArtifactPath('.ai/project-memory.md', 'x'), '.ai/project-memory.md');
  });

  test('a "<slug>/filename" path (no .ai/artifacts/features/ prefix) is not double-nested', () => {
    // Found live, one call after the bare-filename case: the same role
    // returned a different partial form of the path on a different run —
    // "monthly-size-reminder-notification/feature-brief.md". The old
    // (bare-filename-only) fix re-prefixed the whole thing and produced
    // .ai/artifacts/features/<slug>/<slug>/feature-brief.md — a duplicate
    // nested path that left the real content somewhere dev-review never
    // looked, while the placeholder stub at the expected path stayed empty.
    assert.equal(
      normalizeArtifactPath('monthly-size-reminder-notification/feature-brief.md', 'monthly-size-reminder-notification'),
      '.ai/artifacts/features/monthly-size-reminder-notification/feature-brief.md'
    );
  });

  test('a path with "artifacts/features/<slug>/" but missing the leading ".ai/" is fixed, not doubled', () => {
    assert.equal(
      normalizeArtifactPath('artifacts/features/x/dev-log.md', 'x'),
      '.ai/artifacts/features/x/dev-log.md'
    );
  });
});

describe('parseToolArgs — end-to-end path normalization', () => {
  test('an artifact submitted with a bare filename is written to the feature directory, not blocked', () => {
    const raw = JSON.stringify({
      artifacts: [{ path: 'feature-brief.md', action: 'update', content: 'brief' }],
      verdict: 'clear',
    });
    const result = parseToolArgs(raw, 'pm', 'monthly-size-reminder');
    assert.equal(result.artifacts[0].path, '.ai/artifacts/features/monthly-size-reminder/feature-brief.md');
    const { allowed } = checkPermissions('pm', [], result.artifacts);
    assert.equal(allowed, true);
  });
});

describe('missingRequiredFields — enforcing the schema client-side', () => {
  test('an empty object is missing everything the role requires', () => {
    // Found live: a real model call with a huge (~87k char) user prompt
    // returned literally "{}" as the submit_changes arguments — a
    // syntactically valid call to the right function satisfying none of
    // its required fields. tool_choice only forces which function is
    // called, never that its arguments satisfy the schema.
    assert.deepEqual(missingRequiredFields({}, 'architect'), ['artifacts']);
    assert.deepEqual(missingRequiredFields({}, 'dev').sort(), ['artifacts', 'files']);
    assert.deepEqual(missingRequiredFields({}, 'review').sort(), ['artifacts', 'verdict']);
  });

  test('null (unparseable JSON) is treated the same as an empty object', () => {
    assert.deepEqual(missingRequiredFields(null, 'pm'), ['artifacts']);
  });

  test('a fully-populated payload is missing nothing', () => {
    assert.deepEqual(
      missingRequiredFields({ artifacts: [], files: [] }, 'dev'),
      []
    );
    assert.deepEqual(
      missingRequiredFields({ artifacts: [], verdict: 'PASS' }, 'review'),
      []
    );
  });
});

describe('evaluateClaudeCliResult — claude-cli backend response handling', () => {
  test('a clean success response with schema-valid structured_output is returned as-is', () => {
    const data = {
      is_error: false,
      terminal_reason: 'completed',
      structured_output: { artifacts: [{ path: 'foo.md', action: 'create', content: 'x' }] },
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const evaluation = evaluateClaudeCliResult(data, 'pm', 'my-feature');
    assert.equal(evaluation.status, 'success');
    if (evaluation.status === 'success') {
      assert.equal(evaluation.result.artifacts.length, 1);
      assert.equal(evaluation.result.artifacts[0].path, '.ai/artifacts/features/my-feature/foo.md');
      assert.equal(evaluation.result.usageTokens, 15);
    }
  });

  test('is_error:true with a retryable terminal_reason is retryable', () => {
    const data = { is_error: true, terminal_reason: 'error_during_execution', result: 'boom' };
    const evaluation = evaluateClaudeCliResult(data, 'pm', 'my-feature');
    assert.equal(evaluation.status, 'retry');
  });

  test('is_error:true with a non-retryable terminal_reason is fatal, not retried', () => {
    // Found live: budget_exhausted used to fall through the old
    // `data.is_error || allowlist.has(...)` OR-check and retry blindly —
    // burning up to llm.maxBudgetUsd again on each of 2 more attempts for a
    // failure mode that will deterministically repeat. Only the curated
    // allowlist is transient; every other is_error is fatal.
    const data = {
      is_error: true,
      terminal_reason: 'budget_exhausted',
      subtype: 'error_max_budget_usd',
      total_cost_usd: 1.26,
    };
    const evaluation = evaluateClaudeCliResult(data, 'pm', 'my-feature');
    assert.equal(evaluation.status, 'fatal');
    if (evaluation.status === 'fatal') {
      assert.match(evaluation.reason, /maxBudgetUsd/);
    }
  });

  test('a transient network failure (api_error) is retryable, not fatal', () => {
    // Found live: "API Error: Connection closed mid-response" — a real
    // mid-stream network drop with no relation to prompt content or
    // budget. Must stay retryable even though it's a distinct terminal
    // reason from the original max_turns/error_during_execution set.
    const data = {
      is_error: true,
      terminal_reason: 'api_error',
      result: 'API Error: Connection closed mid-response. The response above may be incomplete.',
    };
    const evaluation = evaluateClaudeCliResult(data, 'architect', 'my-feature');
    assert.equal(evaluation.status, 'retry');
  });

  test('a retryable terminal_reason is retryable even when is_error is false', () => {
    // Found live: max_turns exhaustion can end a run with is_error:false but
    // no usable structured_output — treat that as retryable, not success.
    for (const reason of ['max_turns', 'error_max_turns', 'error_during_execution']) {
      const data = { is_error: false, terminal_reason: reason, structured_output: null };
      const evaluation = evaluateClaudeCliResult(data, 'pm', 'my-feature');
      assert.equal(evaluation.status, 'retry', `terminal_reason=${reason} should be retryable`);
    }
  });

  test('a completed run with no structured_output at all is retryable', () => {
    // No structured_output field is treated the same as an empty object by
    // missingRequiredFields (see the null case above) — the role's required
    // fields show up as missing rather than a distinct "absent" message.
    const data = { is_error: false, terminal_reason: 'completed', result: 'some free-form text' };
    const evaluation = evaluateClaudeCliResult(data, 'pm', 'my-feature');
    assert.equal(evaluation.status, 'retry');
    if (evaluation.status === 'retry') {
      assert.match(evaluation.reason, /artifacts/);
    }
  });

  test('structured_output missing a required field (schema hint ignored) is retryable', () => {
    // Same class of gap as the OpenRouter path: --json-schema is a hint to
    // the model, not a server-side content check.
    const data = {
      is_error: false,
      terminal_reason: 'completed',
      structured_output: {},
      result: '{}',
    };
    const evaluation = evaluateClaudeCliResult(data, 'dev', 'my-feature');
    assert.equal(evaluation.status, 'retry');
    if (evaluation.status === 'retry') {
      assert.match(evaluation.reason, /artifacts/);
      assert.match(evaluation.reason, /files/);
    }
  });

  test('usageTokens sums input, cache-read, cache-creation, and output tokens', () => {
    const data = {
      is_error: false,
      terminal_reason: 'completed',
      structured_output: { artifacts: [] },
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
        output_tokens: 8,
      },
    };
    const evaluation = evaluateClaudeCliResult(data, 'pm', 'my-feature');
    assert.equal(evaluation.status, 'success');
    if (evaluation.status === 'success') {
      assert.equal(evaluation.result.usageTokens, 160);
    }
  });

  test('missing usage entirely leaves usageTokens undefined rather than 0', () => {
    const data = {
      is_error: false,
      terminal_reason: 'completed',
      structured_output: { artifacts: [] },
    };
    const evaluation = evaluateClaudeCliResult(data, 'pm', 'my-feature');
    assert.equal(evaluation.status, 'success');
    if (evaluation.status === 'success') {
      assert.equal(evaluation.result.usageTokens, undefined);
    }
  });
});

describe('extractImpactedFiles — Dev batching input', () => {
  test('extracts backtick-quoted source file paths, deduplicated', () => {
    const plan = `
## Files to change

- \`src/screens/settings.tsx\` — add toggle
- \`src/hooks/use-feature.ts\` — new hook
- \`src/screens/settings.tsx\` — also update styles (duplicate reference)
`;
    assert.deepEqual(extractImpactedFiles(plan), [
      'src/screens/settings.tsx',
      'src/hooks/use-feature.ts',
    ]);
  });

  test('matches bold-wrapped backtick paths too', () => {
    const plan = '**`src/components/card.tsx`** — new component';
    assert.deepEqual(extractImpactedFiles(plan), ['src/components/card.tsx']);
  });

  test('skips .ai/ artifact paths and template placeholders with braces', () => {
    const plan = `
- \`.ai/artifacts/features/x/dev-log.md\` — not a source file
- \`src/{feature}/index.ts\` — template placeholder, not a real path
- \`src/real-file.ts\` — an actual file
`;
    assert.deepEqual(extractImpactedFiles(plan), ['src/real-file.ts']);
  });

  test('empty or missing plan yields an empty list', () => {
    assert.deepEqual(extractImpactedFiles(''), []);
    assert.deepEqual(extractImpactedFiles('[file not found: technical-plan.md]'), []);
  });

  test('recognizes every supported extension', () => {
    const plan = [
      '`a.ts`', '`b.tsx`', '`c.js`', '`d.jsx`', '`e.mjs`', '`f2.cjs`', '`e.css`', '`f.json`', '`g.yaml`', '`h.yml`', '`i.md`',
    ].join(' ');
    assert.deepEqual(
      extractImpactedFiles(plan),
      ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs', 'f2.cjs', 'e.css', 'f.json', 'g.yaml', 'h.yml', 'i.md']
    );
  });

  test('scopes extraction to the Impacted Files section, ignoring prose mentions and out-of-scope files', () => {
    // Found live: a real plan's Architecture paragraph mentioned existing
    // files for comparison ("mirrors `existing.ts`"), and its Impacted
    // Files section was immediately followed by an out-of-scope sub-list —
    // both used to be counted as impacted, turning ~11 real files into 52.
    const plan = `
## Architecture

This mirrors the existing \`existing-a.ts\` ↔ \`existing-b.ts\` pattern.

## Impacted Files

- \`src/real-one.ts\` — new
- \`src/real-two.mjs\` — new

**Explicitly out of scope / do not modify:**
- \`src/do-not-touch.ts\`

## Existing Patterns To Reuse

- \`existing-c.ts\` — follow this convention
`;
    assert.deepEqual(extractImpactedFiles(plan), ['src/real-one.ts', 'src/real-two.mjs']);
  });

  test('.mjs/.cjs impacted files are counted for Dev batching', () => {
    // Found live: a technical plan whose impacted files were all .mjs
    // (this repo's own detector modules) used to extract as an empty list
    // — allPlannedFiles.length was 0, never > devFileBatchSize, so Dev
    // batching never triggered no matter how many .mjs files the plan
    // actually listed.
    const plan = Array.from({ length: 11 }, (_, i) => `\`test/detectors/mod${i}.test.mjs\``).join('\n');
    assert.equal(extractImpactedFiles(plan).length, 11);
  });

  test('a bare-filename self-reference is reconciled against its fully-qualified path, not duplicated', () => {
    // Found live: a bullet's own description mentioned ANOTHER file by
    // bare name only ("reused as inputs to `project.test.mjs`'s cases"),
    // which used to extract as a second, separate entry alongside the
    // correctly-pathed `test/detectors/project.test.mjs` — risking Dev
    // creating a stray file at the wrong (bare) path.
    const plan = `
## Impacted Files

- \`test/detectors/fs-helpers.test.mjs\` — NEW. Fixtures reused as inputs to \`project.test.mjs\`'s cases.
- \`test/detectors/project.test.mjs\` — NEW.
`;
    assert.deepEqual(extractImpactedFiles(plan), [
      'test/detectors/fs-helpers.test.mjs',
      'test/detectors/project.test.mjs',
    ]);
  });

  test('a bare filename with no qualified counterpart is kept (a real root-level file)', () => {
    const plan = `
## Impacted Files

- \`package.json\` — widen test glob
- \`test/detectors/project.test.mjs\` — NEW.
`;
    assert.deepEqual(extractImpactedFiles(plan), [
      'package.json',
      'test/detectors/project.test.mjs',
    ]);
  });
});

describe('scopeToRetryFiles — scoping a quality-gate retry to implicated files', () => {
  const planned = ['test/detectors/commands.test.mjs', 'test/detectors/error-tracking.test.mjs', 'package.json'];

  test('scopes to the intersection when some retry-files match planned files', () => {
    const { scoped, matched } = scopeToRetryFiles(planned, 'test/detectors/commands.test.mjs,test/detectors/error-tracking.test.mjs');
    assert.equal(matched, true);
    assert.deepEqual(scoped, ['test/detectors/commands.test.mjs', 'test/detectors/error-tracking.test.mjs']);
  });

  test('trims whitespace and drops empty entries in the retry-files argument', () => {
    const { scoped, matched } = scopeToRetryFiles(planned, ' test/detectors/commands.test.mjs , , package.json ');
    assert.equal(matched, true);
    assert.deepEqual(scoped, ['test/detectors/commands.test.mjs', 'package.json']);
  });

  test('matched is false and scoped is empty when nothing in retry-files matches a planned file', () => {
    const { scoped, matched } = scopeToRetryFiles(planned, 'some/unrelated/file.ts');
    assert.equal(matched, false);
    assert.deepEqual(scoped, []);
  });

  test('matched is false for an empty retry-files argument', () => {
    const { scoped, matched } = scopeToRetryFiles(planned, '');
    assert.equal(matched, false);
    assert.deepEqual(scoped, []);
  });

  test('ignores a retry-files entry that is not in the planned list, keeping only real matches', () => {
    const { scoped, matched } = scopeToRetryFiles(planned, 'test/detectors/commands.test.mjs,not/a/planned/file.ts');
    assert.equal(matched, true);
    assert.deepEqual(scoped, ['test/detectors/commands.test.mjs']);
  });
});

describe('buildArchitectTask — per-pass task text for the Architect split', () => {
  const ctx = { featureDir: '.ai/artifacts/features/my-feature' } as Parameters<
    typeof buildArchitectTask
  >[0];

  test("the 'plan' pass asks only for technical-plan.md, not repository-context.md", () => {
    const task = buildArchitectTask(ctx, 'plan');
    assert.match(task, /technical-plan\.md/);
    assert.doesNotMatch(task, /repository-context\.md/);
  });

  test("the 'context' pass asks only for repository-context.md, and explicitly forbids rewriting the already-written plan", () => {
    const task = buildArchitectTask(ctx, 'context');
    assert.match(task, /repository-context\.md/);
    assert.match(task, /already been written/);
    assert.match(task, /do NOT rewrite or modify it/i);
    assert.match(task, /Do NOT re-emit technical-plan\.md/);
  });

  test('an undefined pass (unbatched fallback) asks for both artifacts in one call', () => {
    const task = buildArchitectTask(ctx, undefined);
    assert.match(task, /technical-plan\.md/);
    assert.match(task, /repository-context\.md/);
  });

  test('both passes reference this feature\'s own featureDir, not a hardcoded path', () => {
    const otherCtx = { featureDir: '.ai/artifacts/features/other-feature' } as Parameters<
      typeof buildArchitectTask
    >[0];
    assert.match(buildArchitectTask(otherCtx, 'plan'), /other-feature\/technical-plan\.md/);
    assert.match(buildArchitectTask(otherCtx, 'context'), /other-feature\/repository-context\.md/);
  });
});

describe('filterArchitectPassArtifacts — defense in depth against a pass producing the wrong artifact', () => {
  test("the 'plan' pass keeps only technical-plan.md, drops anything else", () => {
    const artifacts = [
      { path: '.ai/artifacts/features/x/technical-plan.md', action: 'create' as const, content: 'plan' },
      { path: '.ai/artifacts/features/x/repository-context.md', action: 'create' as const, content: 'ctx' },
    ];
    const { expected, unexpected } = filterArchitectPassArtifacts('plan', artifacts);
    assert.equal(expected.length, 1);
    assert.equal(expected[0].content, 'plan');
    assert.equal(unexpected.length, 1);
    assert.equal(unexpected[0].content, 'ctx');
  });

  test("the 'context' pass keeps only repository-context.md, drops anything else", () => {
    const artifacts = [
      { path: '.ai/artifacts/features/x/technical-plan.md', action: 'create' as const, content: 'plan' },
      { path: '.ai/artifacts/features/x/repository-context.md', action: 'create' as const, content: 'ctx' },
    ];
    const { expected, unexpected } = filterArchitectPassArtifacts('context', artifacts);
    assert.equal(expected.length, 1);
    assert.equal(expected[0].content, 'ctx');
    assert.equal(unexpected.length, 1);
    assert.equal(unexpected[0].content, 'plan');
  });

  test('an empty artifacts array yields no expected and no unexpected entries', () => {
    const { expected, unexpected } = filterArchitectPassArtifacts('plan', []);
    assert.deepEqual(expected, []);
    assert.deepEqual(unexpected, []);
  });
});

describe('trimContextForPrompt — keeping the Architect prompt small', () => {
  test('strips cache-only fields, keeps architecturally useful ones', () => {
    const ctx = JSON.stringify({
      schemaVersion: 2,
      architectureMap: { 'a.ts': ['src/a.ts'] },
      apiMap: { 'src/a.ts': ['foo'] },
      dependencyMap: { './a': ['src/b.ts'] },
      symbolIndex: { foo: { definitionPath: 'src/a.ts', type: 'function' } },
      conventions: { naming: ['camelCase'] },
      fileCount: 1,
      perFileExports: { 'src/a.ts': [{ name: 'foo', type: 'function' }] },
      perFileImports: { 'src/a.ts': [] },
      fileFingerprints: { 'src/a.ts': 123456 },
      stats: { filesReusedFromCache: 0, filesParsed: 1 },
    });
    const trimmed = JSON.parse(trimContextForPrompt(ctx));
    assert.ok(trimmed.architectureMap);
    assert.ok(trimmed.apiMap);
    assert.ok(trimmed.dependencyMap);
    assert.ok(trimmed.symbolIndex);
    assert.ok(trimmed.conventions);
    assert.equal(trimmed.perFileExports, undefined);
    assert.equal(trimmed.perFileImports, undefined);
    assert.equal(trimmed.fileFingerprints, undefined);
    assert.equal(trimmed.stats, undefined);
  });

  test('malformed JSON is passed through unchanged rather than throwing', () => {
    assert.equal(trimContextForPrompt('not json'), 'not json');
  });
});
