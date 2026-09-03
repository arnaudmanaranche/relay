// Tests for skills/setup/scripts/detectors/style.mjs
//
// This detector's only job is reporting which style sources exist, so the
// setup skill knows what to read when distilling `.relay/skills/
// code-style.md`. It deliberately does NOT parse them — resolving a real
// eslint.config.js means executing it. These tests pin that contract:
// presence, ordering, and the locations a naive path scan would miss.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  detectLintConfigFiles,
  detectFormatConfigFiles,
  detectStyleDocFiles,
  detectPackageJsonStyleKeys,
} from '../../skills/setup/scripts/detectors/style.mjs';

const tmpDirs = [];
function makeProject(files) {
  const root = mkdtempSync(join(tmpdir(), 'relay-style-'));
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

test('a flat-config ESLint project reports its config file', () => {
  const root = makeProject({ 'eslint.config.js': 'export default []' });
  assert.deepStrictEqual(detectLintConfigFiles(root), ['eslint.config.js']);
});

test('a project with both flat and legacy ESLint config lists the flat one first', () => {
  // A project with both is using the flat one; the .eslintrc is a leftover.
  // Order is what tells the setup skill which to read as authoritative.
  const root = makeProject({
    '.eslintrc.json': '{}',
    'eslint.config.mjs': 'export default []',
  });
  assert.deepStrictEqual(detectLintConfigFiles(root), [
    'eslint.config.mjs',
    '.eslintrc.json',
  ]);
});

test('Biome and oxlint count as linters, not just ESLint', () => {
  assert.deepStrictEqual(detectLintConfigFiles(makeProject({ 'biome.json': '{}' })), ['biome.json']);
  assert.deepStrictEqual(detectLintConfigFiles(makeProject({ 'oxlint.json': '{}' })), ['oxlint.json']);
});

test('formatter detection covers the prettier config variants and .editorconfig', () => {
  const root = makeProject({
    '.prettierrc': '{}',
    'prettier.config.mjs': 'export default {}',
    '.editorconfig': 'root = true',
  });
  assert.deepStrictEqual(detectFormatConfigFiles(root), [
    '.prettierrc',
    'prettier.config.mjs',
    '.editorconfig',
  ]);
});

test('hand-written guidance is reported, agent docs before contributor docs', () => {
  // CLAUDE.md/AGENTS.md are the highest-value source for a distilled style
  // doc: they already explain the why, which a lint config can only imply.
  const root = makeProject({
    'CONTRIBUTING.md': '# Contributing',
    'CLAUDE.md': '# Project rules',
    'docs/code-style.md': '# Style',
  });
  assert.deepStrictEqual(detectStyleDocFiles(root), [
    'CLAUDE.md',
    'CONTRIBUTING.md',
    'docs/code-style.md',
  ]);
});

test('config held inside package.json is reported — a path scan alone would call this project style-less', () => {
  const pkg = { name: 'x', prettier: { semi: false }, eslintConfig: { extends: 'next' } };
  assert.deepStrictEqual(detectPackageJsonStyleKeys(pkg), ['prettier', 'eslintConfig']);
});

test('a package.json with no style keys, or none at all, reports nothing', () => {
  assert.deepStrictEqual(detectPackageJsonStyleKeys({ name: 'x' }), []);
  assert.deepStrictEqual(detectPackageJsonStyleKeys(null), []);
});

test('a project with no style sources at all reports empty lists, not defaults', () => {
  // Empty is the honest answer, and it's what makes setup ask the user
  // instead of fabricating a code-style.md from generic defaults.
  const root = makeProject({ 'package.json': '{"name":"x"}', 'src/app.ts': 'export default 1' });
  assert.deepStrictEqual(detectLintConfigFiles(root), []);
  assert.deepStrictEqual(detectFormatConfigFiles(root), []);
  assert.deepStrictEqual(detectStyleDocFiles(root), []);
});

test('a nonexistent project root returns empty lists instead of throwing', () => {
  const missing = join(tmpdir(), 'relay-no-such-style-root');
  assert.deepStrictEqual(detectLintConfigFiles(missing), []);
  assert.deepStrictEqual(detectFormatConfigFiles(missing), []);
  assert.deepStrictEqual(detectStyleDocFiles(missing), []);
});
