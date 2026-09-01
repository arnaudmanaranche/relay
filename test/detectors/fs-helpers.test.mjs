// Tests for skills/setup/scripts/detectors/fs-helpers.mjs
//
// This is the shared primitive nearly every other filesystem-based detector
// (project.mjs, commands.mjs, source-layout.mjs, analytics.mjs, e2e.mjs,
// locales.mjs) sits on top of. Every exported function here takes `root`
// explicitly as its first argument, then a path/predicate relative to that
// root (confirmed against source — see commit history for the corrected
// signatures): exists(root, ...parts), readJson(root, path),
// readText(root, path), isDirectory(root, rel), ls(root, dir),
// findFiles(root, dir, predicate, maxDepth).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  exists,
  readJson,
  readText,
  isDirectory,
  ls,
  findFiles,
} from '../../skills/setup/scripts/detectors/fs-helpers.mjs';

const tmpDirs = [];

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-fshelpers-'));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exists returns false for a missing path', () => {
  const dir = makeTmpDir();
  assert.strictEqual(exists(dir, 'does-not-exist.txt'), false);
});

test('exists returns true for a present file', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'present.txt'), 'hello');
  assert.strictEqual(exists(dir, 'present.txt'), true);
});

test('readJson returns null for a missing file', () => {
  const dir = makeTmpDir();
  assert.strictEqual(readJson(dir, 'missing.json'), null);
});

test('readJson returns null for a malformed JSON file (does not throw)', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'bad.json'), '{ this is not valid json');
  assert.strictEqual(readJson(dir, 'bad.json'), null);
});

test('readJson returns the parsed object for a valid JSON file', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'good.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
  assert.deepStrictEqual(readJson(dir, 'good.json'), { name: 'demo', version: '1.0.0' });
});

test('readText returns an empty string for a missing file', () => {
  const dir = makeTmpDir();
  assert.strictEqual(readText(dir, 'missing.txt'), '');
});

test('readText returns the file contents for a present file', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'present.txt'), 'export const appId = "com.example.app";');
  assert.strictEqual(readText(dir, 'present.txt'), 'export const appId = "com.example.app";');
});

test('isDirectory returns true for a directory', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'sub'));
  assert.strictEqual(isDirectory(dir, 'sub'), true);
});

test('isDirectory returns false for a file and for a missing path', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'file.txt'), 'x');
  assert.strictEqual(isDirectory(dir, 'file.txt'), false);
  assert.strictEqual(isDirectory(dir, 'missing'), false);
});

test('ls returns [] for a missing directory', () => {
  const dir = makeTmpDir();
  assert.deepStrictEqual(ls(dir, 'missing'), []);
});

test('ls returns the entry names for a present directory', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'a'), '');
  writeFileSync(join(dir, 'sub', 'b.txt'), 'x');
  mkdirSync(join(dir, 'sub', 'a-dir'));
  const entries = ls(dir, 'sub').slice().sort();
  assert.deepStrictEqual(entries, ['a', 'a-dir', 'b.txt']);
});

test('findFiles returns [] when no file matches the given predicate', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'readme.md'), 'x');
  const found = findFiles(dir, '.', name => name.endsWith('.json'));
  assert.deepStrictEqual(found, []);
});

test('findFiles returns matching relative file paths when present', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'app.json'), '{}');
  writeFileSync(join(dir, 'readme.md'), 'x');
  const found = findFiles(dir, '.', name => name.endsWith('.json'));
  assert.strictEqual(found.length, 1);
  assert.ok(found[0].endsWith('app.json'));
});

test('findFiles skips ignored directories (node_modules, dist, build, .git) and dotfiles', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'node_modules', 'ignored.json'), '{}');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'kept.json'), '{}');
  const found = findFiles(dir, '.', name => name.endsWith('.json'));
  assert.strictEqual(found.length, 1);
  assert.ok(found[0].endsWith('kept.json'));
});

test('findFiles respects maxDepth', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'a', 'b', 'c'), { recursive: true });
  writeFileSync(join(dir, 'a', 'b', 'c', 'deep.json'), '{}');
  const shallow = findFiles(dir, '.', name => name.endsWith('.json'), 1);
  assert.deepStrictEqual(shallow, []);
  const deep = findFiles(dir, '.', name => name.endsWith('.json'), 5);
  assert.strictEqual(deep.length, 1);
});
