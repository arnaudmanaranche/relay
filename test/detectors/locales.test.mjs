// Tests for skills/setup/scripts/detectors/locales.mjs
//
// Real signature (confirmed against source): detectLocales(root) — a
// filesystem-based detector that scans known i18n directory patterns for
// locale files or subdirectories, then falls back to scanning for any
// i18n-like directory name, and finally defaults to
// { locales: 'en', dir: 'i18n/locales' }. It always returns a truthy
// { locales, dir } object — there is no empty-string/no-signal case.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLocales } from '../../skills/setup/scripts/detectors/locales.mjs';

const tmpDirs = [];

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-locales-'));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectLocales finds locale files (en.ts, fr.ts) under i18n/locales', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'i18n', 'locales'), { recursive: true });
  writeFileSync(join(dir, 'i18n', 'locales', 'en.ts'), '');
  writeFileSync(join(dir, 'i18n', 'locales', 'fr.ts'), '');
  const result = detectLocales(dir);
  assert.strictEqual(result.dir, 'i18n/locales');
  assert.deepStrictEqual(result.locales.split(',').sort(), ['en', 'fr']);
});

test('detectLocales finds locale subdirectories (en/, fr/) under locales/', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'locales', 'en'), { recursive: true });
  mkdirSync(join(dir, 'locales', 'fr'), { recursive: true });
  const result = detectLocales(dir);
  assert.strictEqual(result.dir, 'locales');
  assert.deepStrictEqual(result.locales.split(',').sort(), ['en', 'fr']);
});

test('detectLocales falls back to scanning for a generic i18n-like directory name', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'src', 'translations'), { recursive: true });
  const result = detectLocales(dir);
  assert.strictEqual(result.locales, 'en');
  assert.strictEqual(result.dir, './src/translations');
});

test('detectLocales defaults to en / i18n/locales when no i18n signal is present at all', () => {
  const dir = makeTmpDir();
  assert.deepStrictEqual(detectLocales(dir), { locales: 'en', dir: 'i18n/locales' });
});
