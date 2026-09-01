// Tests for skills/setup/scripts/detectors/e2e.mjs
//
// Real signature (confirmed against source): detectE2E(root) — a
// filesystem-based detector, not dependency-based. It inspects
// framework-specific config files/directories and always returns
// { framework, dir }, defaulting to { framework: '', dir: 'e2e' } when
// nothing is recognized (never a bare '' or []).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectE2E } from '../../skills/setup/scripts/detectors/e2e.mjs';

const tmpDirs = [];

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-e2e-'));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectE2E returns maestro when e2e/maestro directory exists', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'e2e', 'maestro'), { recursive: true });
  assert.deepStrictEqual(detectE2E(dir), { framework: 'maestro', dir: 'e2e/maestro' });
});

test('detectE2E returns playwright with dir "e2e" when playwright.config.ts and e2e/ both exist', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'playwright.config.ts'), '');
  mkdirSync(join(dir, 'e2e'));
  assert.deepStrictEqual(detectE2E(dir), { framework: 'playwright', dir: 'e2e' });
});

test('detectE2E returns playwright with dir "tests" when only tests/ exists (no e2e/)', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'playwright.config.ts'), '');
  mkdirSync(join(dir, 'tests'));
  assert.deepStrictEqual(detectE2E(dir), { framework: 'playwright', dir: 'tests' });
});

test('detectE2E returns cypress when cypress.config.ts exists', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'cypress.config.ts'), '');
  assert.deepStrictEqual(detectE2E(dir), { framework: 'cypress', dir: 'cypress/e2e' });
});

test('detectE2E returns detox when .detoxrc.js exists', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, '.detoxrc.js'), '');
  assert.deepStrictEqual(detectE2E(dir), { framework: 'detox', dir: 'e2e' });
});

test('detectE2E returns webdriverio when wdio.conf.js exists', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'wdio.conf.js'), '');
  assert.deepStrictEqual(detectE2E(dir), { framework: 'webdriverio', dir: 'test' });
});

test('detectE2E falls back to an empty framework with dir "e2e" when no e2e config is present', () => {
  const dir = makeTmpDir();
  assert.deepStrictEqual(detectE2E(dir), { framework: '', dir: 'e2e' });
});
