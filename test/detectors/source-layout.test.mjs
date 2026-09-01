// Tests for skills/setup/scripts/detectors/source-layout.mjs
//
// Covers AC 11-16 for detectSourceDirs, plus baseline happy-path coverage
// for detectSkipDirs and detectSourceExtensions (AC 21).
//
// Real signatures (confirmed against source): detectSourceDirs(pkg, root),
// detectSkipDirs(pkg, root), detectSourceExtensions(pkg).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectSourceDirs,
  detectSkipDirs,
  detectSourceExtensions,
} from '../../skills/setup/scripts/detectors/source-layout.mjs';

const tmpDirs = [];

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-sourcelayout-'));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- AC 11 ---
test("detectSourceDirs returns ['src'] when a top-level src/ directory exists", () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'src'));
  assert.deepStrictEqual(detectSourceDirs({}, dir), ['src']);
});

// --- AC 12 ---
test("detectSourceDirs returns ['app'] when a top-level, non-expo-router app/ directory exists", () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'app'));
  writeFileSync(join(dir, 'app', 'index.js'), 'export default function App() {}');
  assert.deepStrictEqual(detectSourceDirs({}, dir), ['app']);
});

// --- AC 13 ---
test("detectSourceDirs returns ['pages'] when a top-level pages/ directory exists", () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'pages'));
  assert.deepStrictEqual(detectSourceDirs({}, dir), ['pages']);
});

// --- AC 14: app+pages hybrid ---
test('detectSourceDirs returns both app and pages when both top-level directories exist (hybrid layout)', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'app'));
  mkdirSync(join(dir, 'pages'));
  assert.deepStrictEqual(detectSourceDirs({}, dir), ['app', 'pages']);
});

// --- AC 15: Expo-router layout ---
// Confirmed against source: the real guard is
// `if (deps?.['expo-router'] && exists(root, 'app')) { ... }` — the
// signal is the `expo-router` package.json dependency, NOT the presence
// of an `app/_layout.tsx` file (the brief's AC15 wording used
// `app/_layout.tsx` as illustrative flavor text for "an Expo-router-style
// app/ layout," not as the actual detection mechanism). A `_layout.tsx`
// file is not read anywhere in source-layout.mjs. This scenario is
// therefore correctly exercised via the dependency, not the file.
test('detectSourceDirs returns filtered expo-router source dirs when expo-router is a dependency', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'app'));
  mkdirSync(join(dir, 'hooks'));
  // 'components' and 'lib' deliberately absent — the real implementation
  // filters the candidate list down to directories that actually exist.
  const pkg = { dependencies: { 'expo-router': '^3.0.0' } };
  assert.deepStrictEqual(detectSourceDirs(pkg, dir), ['app', 'hooks']);
});

test('detectSourceDirs falls through to the generic app/ match when expo-router is a dependency but app/ does not exist', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'src'));
  const pkg = { dependencies: { 'expo-router': '^3.0.0' } };
  assert.deepStrictEqual(detectSourceDirs(pkg, dir), ['src']);
});

// --- AC 16 ---
test('detectSourceDirs returns [] when none of src/, app/, pages/ exist', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'other'));
  assert.deepStrictEqual(detectSourceDirs({}, dir), []);
});

test('detectSourceDirs returns [] for a completely empty directory', () => {
  const dir = makeTmpDir();
  assert.deepStrictEqual(detectSourceDirs({}, dir), []);
});

// --- detectSkipDirs (baseline coverage, AC 21) ---
test('detectSkipDirs includes common ignorable directories like node_modules', () => {
  const dir = makeTmpDir();
  const result = detectSkipDirs({}, dir);
  assert.ok(Array.isArray(result));
  assert.ok(result.includes('node_modules'));
});

test('detectSkipDirs adds mobile-specific ignore dirs when react-native/expo is a dependency', () => {
  const dir = makeTmpDir();
  const result = detectSkipDirs({ dependencies: { expo: '^51.0.0' } }, dir);
  assert.ok(result.includes('ios'));
  assert.ok(result.includes('android'));
  assert.ok(result.includes('.expo'));
});

// --- detectSourceExtensions (baseline coverage, AC 21) ---
test('detectSourceExtensions returns .ts/.tsx by default', () => {
  const result = detectSourceExtensions({});
  assert.ok(Array.isArray(result));
  assert.ok(result.includes('.ts'));
  assert.ok(result.includes('.tsx'));
});

test('detectSourceExtensions adds .js/.jsx for a React project with no TypeScript dependency', () => {
  const result = detectSourceExtensions({ dependencies: { react: '^18.0.0' } });
  assert.ok(result.includes('.js'));
  assert.ok(result.includes('.jsx'));
});
