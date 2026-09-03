// Tests for skills/setup/scripts/detectors/schema.mjs
//
// detectSchemaFiles decides what every Architect and Dev call for the life
// of the project gets told about the database, so both failure directions
// are expensive: too little and Dev invents column names, too much and
// every call pays for migration history it can't use. The preference order
// (declarative schema > generated types > migrations) is the whole point,
// so most of these tests are about what it does NOT return.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { detectSchemaFiles } from '../../skills/setup/scripts/detectors/schema.mjs';

const tmpDirs = [];
// Builds a throwaway project root from a { 'rel/path': 'contents' } map.
function makeProject(files) {
  const root = mkdtempSync(join(tmpdir(), 'relay-schema-'));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

test('a Prisma project returns its declarative schema', () => {
  const root = makeProject({ 'prisma/schema.prisma': 'model User { id Int @id }' });
  assert.deepStrictEqual(detectSchemaFiles(root), ['prisma/schema.prisma']);
});

test('a Prisma project does NOT also return its migration history', () => {
  // The declarative schema already states the current shape; replaying
  // migrations spends prompt budget restating columns a later migration may
  // have dropped.
  const root = makeProject({
    'prisma/schema.prisma': 'model User { id Int @id }',
    'prisma/migrations/20240101000000_init/migration.sql': 'CREATE TABLE users();',
  });
  assert.deepStrictEqual(detectSchemaFiles(root), ['prisma/schema.prisma']);
});

test('a Drizzle project returns its schema module', () => {
  const root = makeProject({ 'src/db/schema.ts': 'export const users = pgTable(...)' });
  assert.deepStrictEqual(detectSchemaFiles(root), ['src/db/schema.ts']);
});

test('generated DB types are returned alongside a declarative schema, not instead of it', () => {
  // They answer different questions: the schema is what the database is,
  // the generated types are what the application code compiles against.
  const root = makeProject({
    'prisma/schema.prisma': 'model User { id Int @id }',
    'src/types/database.types.ts': 'export type Database = {}',
  });
  assert.deepStrictEqual(detectSchemaFiles(root), [
    'prisma/schema.prisma',
    'src/types/database.types.ts',
  ]);
});

test('a Supabase project with only generated types returns them and skips the migrations glob', () => {
  const root = makeProject({
    'src/types/database.types.ts': 'export type Database = {}',
    'supabase/migrations/20240101000000_init.sql': 'create table users();',
  });
  assert.deepStrictEqual(detectSchemaFiles(root), ['src/types/database.types.ts']);
});

test('a project with ONLY migrations returns a glob, since that is all the schema it has', () => {
  const root = makeProject({
    'supabase/migrations/20240101000000_init.sql': 'create table users();',
    'supabase/migrations/20240202000000_add_col.sql': 'alter table users add col text;',
  });
  assert.deepStrictEqual(detectSchemaFiles(root), ['supabase/migrations/*.sql']);
});

test("Prisma's nested migration layout gets a */migration.sql glob, not a flat *.sql one", () => {
  // `prisma/migrations/<timestamp>_<name>/migration.sql` is one level
  // deeper than every other convention — a flat glob would match nothing.
  const root = makeProject({
    'prisma/migrations/20240101000000_init/migration.sql': 'CREATE TABLE users();',
  });
  assert.deepStrictEqual(detectSchemaFiles(root), ['prisma/migrations/*/migration.sql']);
});

test('an empty migrations directory yields nothing rather than a glob matching no files', () => {
  const root = makeProject({ 'package.json': '{}' });
  mkdirSync(join(root, 'db/migrations'), { recursive: true });
  assert.deepStrictEqual(detectSchemaFiles(root), []);
});

test('a project with no database at all returns an empty list', () => {
  // Empty is a real answer here — it injects nothing, which is correct.
  // The same "don't guess" posture as detectLintCmd returning ''.
  const root = makeProject({ 'package.json': '{}', 'src/app.tsx': 'export default 1' });
  assert.deepStrictEqual(detectSchemaFiles(root), []);
});

test('detection is a fixed-location check, not a repo-wide search for anything schema-shaped', () => {
  // A false positive costs prompt budget on every Architect and Dev call
  // for the life of the project, so an unconventional location is left for
  // the setup prompt to ask about rather than guessed at.
  const root = makeProject({
    'packages/backend/infra/weird-place/schema.prisma': 'model User { id Int @id }',
  });
  assert.deepStrictEqual(detectSchemaFiles(root), []);
});

test('a nonexistent project root returns an empty list instead of throwing', () => {
  assert.deepStrictEqual(detectSchemaFiles(join(tmpdir(), 'relay-no-such-root')), []);
});
