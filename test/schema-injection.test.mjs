// Integration tests for the config -> disk -> prompt-section path of
// `schemaFiles` (agent-runner.ts's loadSchemaSection).
//
// The unit tests in agent-runner.test.ts cover the pure pieces with an
// injected lister. This file covers what they can't: agent-runner reads
// `.relay/config.json` at import time, relative to `--project-root`, so
// proving the real wiring means running it as a child process against a
// throwaway project on actual disk. That's the link that would silently
// break if the config key were renamed or the glob never reached the fs.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const RUNNER = join(import.meta.dirname, '..', 'skills', 'pipeline', 'scripts', 'agent-runner.ts');

const tmpDirs = [];
function makeProject(schemaFiles, files) {
  const root = mkdtempSync(join(tmpdir(), 'relay-schema-inject-'));
  tmpDirs.push(root);
  const all = { ...files };
  all['.relay/config.json'] = JSON.stringify({
    project: { name: 'Fixture', githubRepo: 'org/repo', defaultBranch: 'main' },
    bot: { name: 'relay[bot]', email: 'bot@example.com' },
    commands: { packageManager: 'npm', runScript: 'tsx', typecheck: '', lint: '', formatCheck: '', formatWrite: '' },
    stack: { router: '', styling: '', backend: '', errorTracking: '', analytics: {}, paywall: {}, locales: ['en'], localeDir: 'i18n/locales' },
    e2e: { framework: '', dir: 'e2e' },
    llm: { backend: 'claude-cli', baseUrl: '', apiKeyEnv: '', model: 'm', refererUrl: '' },
    sourceDirs: ['src'],
    skipDirs: ['node_modules'],
    providerNesting: [],
    ...(schemaFiles === null ? {} : { schemaFiles }),
  });
  for (const [rel, content] of Object.entries(all)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

// Runs loadSchemaSection() inside a child process rooted at `root`, which
// is the only way to exercise agent-runner's import-time config load.
function sectionFor(root) {
  const outFile = join(root, 'section.out');
  // Written to a real file rather than passed via `node -e`: agent-runner's
  // getRoot() scans process.argv for --project-root, and node refuses an
  // unknown leading-dash argument after -e.
  const scriptFile = join(root, 'probe.mjs');
  writeFileSync(
    scriptFile,
    [
      `import { loadSchemaSection } from ${JSON.stringify(RUNNER)};`,
      `import { writeFileSync } from 'node:fs';`,
      `writeFileSync(${JSON.stringify(outFile)}, loadSchemaSection());`,
    ].join('\n')
  );
  execFileSync('node', ['--import', 'tsx', scriptFile, `--project-root=${root}`], {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf-8',
  });
  return readFileSync(outFile, 'utf-8');
}

test('a configured declarative schema reaches the prompt section with its real contents', () => {
  const root = makeProject(['prisma/schema.prisma'], {
    'prisma/schema.prisma': 'model User {\n  id        Int    @id\n  fullName  String\n}',
  });
  const section = sectionFor(root);
  assert.match(section, /## Database schema \(read-only reference\)/);
  assert.match(section, /### `prisma\/schema\.prisma`/);
  assert.match(section, /fullName {2}String/);
  assert.match(section, /```prisma/);
});

test('a migrations glob is expanded against the real filesystem, newest files only', () => {
  const root = makeProject(['supabase/migrations/*.sql'], {
    'supabase/migrations/20240101000000_init.sql': 'create table users (id uuid primary key);',
    'supabase/migrations/20240202000000_a.sql': 'alter table users add col_a text;',
    'supabase/migrations/20240303000000_b.sql': 'alter table users add col_b text;',
    'supabase/migrations/20240404000000_c.sql': 'alter table users add col_c text;',
    'supabase/migrations/README.md': 'not a migration',
  });
  const section = sectionFor(root);
  assert.match(section, /col_c text/);
  assert.match(section, /col_b text/);
  assert.match(section, /col_a text/);
  // Oldest is dropped by the MAX_MIGRATION_FILES cap, and the README was
  // never a candidate.
  assert.doesNotMatch(section, /create table users/);
  assert.doesNotMatch(section, /README/);
});

test('no schemaFiles key at all injects nothing — a project with no database', () => {
  const root = makeProject(null, { 'src/app.ts': 'export default 1' });
  assert.equal(sectionFor(root), '');
});

test('an empty schemaFiles list injects nothing', () => {
  const root = makeProject([], { 'src/app.ts': 'export default 1' });
  assert.equal(sectionFor(root), '');
});

test('a configured path that no longer exists is skipped instead of injecting a not-found placeholder', () => {
  // Schema files get moved and renamed; a stale config entry must not put
  // "[file not found: ...]" in front of the model as if it were schema.
  const root = makeProject(['prisma/schema.prisma', 'db/gone.sql'], {
    'prisma/schema.prisma': 'model User { id Int @id }',
  });
  const section = sectionFor(root);
  assert.match(section, /model User/);
  assert.doesNotMatch(section, /file not found/);
  assert.doesNotMatch(section, /gone\.sql/);
});

test('a schemaFiles entry pointing outside the project root is refused', () => {
  // Same containment rule as every other path agent-runner reads: config is
  // editable by anyone with repo access, and this content goes straight
  // into a model prompt.
  const root = makeProject(['../../../../etc/hosts'], {
    'src/app.ts': 'export default 1',
  });
  assert.equal(sectionFor(root), '');
});

// Assembles a real prompt per role, in a child process rooted at `root`,
// and returns { dev, architect, review, qa }.
function promptsFor(root, slug) {
  const outFile = join(root, 'prompts.json');
  const scriptFile = join(root, 'prompt-probe.mjs');
  writeFileSync(
    scriptFile,
    [
      `import { loadContext, buildUserPrompt } from ${JSON.stringify(RUNNER)};`,
      `import { writeFileSync } from 'node:fs';`,
      `const out = {};`,
      `for (const role of ['dev', 'architect', 'review', 'qa']) {`,
      `  out[role] = buildUserPrompt(role, ${JSON.stringify(slug)}, loadContext(role, ${JSON.stringify(slug)}), {});`,
      `}`,
      `writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(out));`,
    ].join('\n')
  );
  execFileSync('node', ['--import', 'tsx', scriptFile, `--project-root=${root}`], {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf-8',
  });
  return JSON.parse(readFileSync(outFile, 'utf-8'));
}

test('the assembled Dev and Architect prompts carry the schema; Review and QA do not', () => {
  // The end of the whole chain: config -> disk -> section -> the actual
  // prompt string a role is called with. Review and QA judge the diff
  // against the plan, whose Data Model section they already have, so the
  // raw schema there would be prompt budget for nothing.
  // The fixture's identifiers are deliberately unmistakable. A Review or QA
  // prompt embeds the working tree's `git diff`, and this test runs inside
  // the repo that *implements* schema injection — asserting on a generic
  // string like "## Database schema" matches this file's own source in that
  // diff, not the injected section.
  const root = makeProject(['prisma/zz-fixture.prisma'], {
    'prisma/zz-fixture.prisma': 'model ZzFixtureWidget {\n  id Int @id\n  zz_fixture_flag Boolean\n}',
    '.relay/artifacts/features/demo/feature-brief.md': '# Brief\n\n## Acceptance criteria\n\n- AC1\n',
    '.relay/artifacts/features/demo/technical-plan.md':
      '# Plan\n\n## Data Model\n\n- `ZzFixtureWidget.zz_fixture_flag` — written\n\n## Impacted Files\n\n- `src/app.ts` — wire it\n',
    'src/app.ts': 'export default 1',
  });
  const prompts = promptsFor(root, 'demo');

  for (const role of ['dev', 'architect']) {
    assert.match(prompts[role], /## Database schema \(read-only reference\)/, `${role} prompt`);
    assert.match(prompts[role], /zz_fixture_flag Boolean/, `${role} prompt`);
  }
  for (const role of ['review', 'qa']) {
    assert.doesNotMatch(prompts[role], /zz_fixture_flag Boolean/, `${role} prompt`);
  }
});

test('the schema lands before the dev log, so a growing log cannot invalidate its prompt cache', () => {
  // Prompt caching keys off the longest matching prefix. The dev log is the
  // one section that grows with every Dev batch; anything placed after it
  // pays full cache-creation cost on every batch instead of being read from
  // cache. The schema is byte-identical across batches, so it belongs in
  // the stable prefix ahead of the log — this is the same incident the dev
  // log's own placement comment in agent-runner.ts records.
  const root = makeProject(['prisma/zz-fixture.prisma'], {
    'prisma/zz-fixture.prisma': 'model ZzFixtureWidget { id Int @id }',
    '.relay/artifacts/features/demo/feature-brief.md': '# Brief\n',
    '.relay/artifacts/features/demo/dev-log.md': '# Dev log\n\n- batch 1 did a thing\n',
    'src/app.ts': 'export default 1',
  });
  const devPrompt = promptsFor(root, 'demo').dev;
  const schemaAt = devPrompt.indexOf('## Database schema');
  const devLogAt = devPrompt.indexOf('## Dev log');
  assert.ok(schemaAt > 0, 'the Dev prompt must carry the schema section');
  assert.ok(devLogAt > 0, 'the Dev prompt must carry the dev log');
  assert.ok(schemaAt < devLogAt, 'the schema must precede the dev log');
});
