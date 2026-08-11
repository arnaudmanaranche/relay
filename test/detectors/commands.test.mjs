// Tests for skills/relay-setup/scripts/detectors/commands.mjs
//
// Covers AC 7-20 (detectLintCmd / detectFormatCmd / detectFormatWriteCmd /
// detectTestCmd) plus baseline happy-path + no-signal-found coverage for
// detectPackageManager, runScriptPrefix, detectRunScript, and
// detectTypecheckCmd (AC 21).
//
// Real signatures (confirmed against source):
//   detectPackageManager(root)                — fs-based
//   runScriptPrefix(packageManager)            — 'npm'->'npm run', 'yarn'->'yarn run',
//                                                 'bun'->'bun run', else '<pm> run'
//   detectRunScript(pkg)                       — NOT script-name-aware; detects the
//                                                 TS/JS *runner* itself (tsx/ts-node/
//                                                 bun run/npx tsx), unrelated to any
//                                                 particular package.json script name
//   detectTypecheckCmd(pkg, packageManager)     — an explicit script resolves to
//                                                 "<prefix> <key>" (the command that
//                                                 INVOKES the script by name, not the
//                                                 script's own literal command string);
//                                                 with no script, ALWAYS falls back to
//                                                 'tsc --noEmit' (never '')
//   detectLintCmd/detectFormatCmd/
//   detectFormatWriteCmd(pkg, packageManager)   — same "<prefix> <key>" pattern for an
//                                                 explicit script; tool-dependency
//                                                 fallbacks are literal (e.g.
//                                                 'eslint .'); '' when nothing matches
//   detectTestCmd(pkg, packageManager)          — an explicit non-placeholder test
//                                                 script resolves to "<packageManager>
//                                                 test" (not "<prefix> test"); test:unit/
//                                                 test:ci fall back to "<prefix> <key>"
//
// Note on multi-tool precedence (brief's Risks & Open Questions #5): this
// file does not assert a winner when both biome and eslint/prettier are
// present simultaneously with no explicit script, since biome is checked
// first in source but that ordering is incidental, not a documented
// contract — biome-only and eslint/prettier-only fallback paths are each
// tested in isolation instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectPackageManager,
  runScriptPrefix,
  detectRunScript,
  detectTypecheckCmd,
  detectLintCmd,
  detectTestCmd,
  detectFormatCmd,
  detectFormatWriteCmd,
} from '../../skills/relay-setup/scripts/detectors/commands.mjs';

// --- detectPackageManager ---

test('detectPackageManager returns npm when a package-lock.json file is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-commands-'));
  try {
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    assert.strictEqual(detectPackageManager(dir), 'npm');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPackageManager returns pnpm when a pnpm-lock.yaml file is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-commands-'));
  try {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    assert.strictEqual(detectPackageManager(dir), 'pnpm');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPackageManager returns yarn when a yarn.lock file is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-commands-'));
  try {
    writeFileSync(join(dir, 'yarn.lock'), '');
    assert.strictEqual(detectPackageManager(dir), 'yarn');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPackageManager falls back to npm when no lockfile is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-commands-'));
  try {
    assert.strictEqual(detectPackageManager(dir), 'npm');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- runScriptPrefix ---

test('runScriptPrefix returns "npm run" for npm', () => {
  assert.strictEqual(runScriptPrefix('npm'), 'npm run');
});

test('runScriptPrefix returns "yarn run" for yarn', () => {
  assert.strictEqual(runScriptPrefix('yarn'), 'yarn run');
});

test('runScriptPrefix returns "pnpm run" for pnpm', () => {
  assert.strictEqual(runScriptPrefix('pnpm'), 'pnpm run');
});

test('runScriptPrefix returns "bun run" for bun', () => {
  assert.strictEqual(runScriptPrefix('bun'), 'bun run');
});

// --- detectRunScript (the TS/JS runner itself, not a script-name composer) ---

test('detectRunScript returns "tsx" when tsx is a dependency', () => {
  const pkg = { devDependencies: { tsx: '^4.0.0' } };
  assert.strictEqual(detectRunScript(pkg), 'tsx');
});

test('detectRunScript returns "ts-node" when ts-node is a dependency and tsx is not', () => {
  const pkg = { devDependencies: { 'ts-node': '^10.0.0' } };
  assert.strictEqual(detectRunScript(pkg), 'ts-node');
});

test('detectRunScript returns "bun run" when bun is a dependency and neither tsx nor ts-node is', () => {
  const pkg = { devDependencies: { bun: '^1.0.0' } };
  assert.strictEqual(detectRunScript(pkg), 'bun run');
});

test('detectRunScript falls back to "npx tsx" when none of tsx/ts-node/bun is a dependency', () => {
  const pkg = { devDependencies: {} };
  assert.strictEqual(detectRunScript(pkg), 'npx tsx');
});

// --- detectTypecheckCmd ---

test('detectTypecheckCmd resolves the explicit typecheck script via the package-manager prefix', () => {
  const pkg = { scripts: { typecheck: 'tsc --noEmit -p tsconfig.json' } };
  assert.strictEqual(detectTypecheckCmd(pkg, 'npm'), 'npm run typecheck');
});

test('detectTypecheckCmd always falls back to "tsc --noEmit" when no matching script exists', () => {
  // Confirmed against source: this fallback is unconditional, not gated
  // on a typescript dependency check — there is no '' case for this
  // function at all.
  const pkg = { scripts: {} };
  assert.strictEqual(detectTypecheckCmd(pkg, 'npm'), 'tsc --noEmit');
});

// --- AC 7: explicit script wins over any competing tool dependency ---

test('detectLintCmd resolves the explicit lint script via the package-manager prefix even when eslint is also a dependency', () => {
  const pkg = {
    scripts: { lint: 'custom-lint-runner --strict' },
    devDependencies: { eslint: '^9.0.0' },
  };
  assert.strictEqual(detectLintCmd(pkg, 'pnpm'), 'pnpm run lint');
});

test('detectFormatCmd resolves the explicit format script via the package-manager prefix even when prettier is also a dependency', () => {
  const pkg = {
    scripts: { format: 'custom-format-check' },
    devDependencies: { prettier: '^3.0.0' },
  };
  assert.strictEqual(detectFormatCmd(pkg, 'npm'), 'npm run format');
});

test('detectFormatWriteCmd resolves the explicit format:write script via the package-manager prefix even when prettier is also a dependency', () => {
  const pkg = {
    scripts: { 'format:write': 'custom-format-write' },
    devDependencies: { prettier: '^3.0.0' },
  };
  assert.strictEqual(detectFormatWriteCmd(pkg, 'npm'), 'npm run format:write');
});

// --- AC 8: biome fallback when no script but biome is a dependency ---
// (real dependency key is '@biomejs/biome' — see commit history)

test('detectLintCmd returns "biome lint ." when @biomejs/biome is a dependency and no lint script exists', () => {
  const pkg = { scripts: {}, devDependencies: { '@biomejs/biome': '^1.8.0' } };
  assert.strictEqual(detectLintCmd(pkg, 'npm'), 'biome lint .');
});

test('detectFormatCmd returns "biome format ." when @biomejs/biome is a dependency and no format script exists', () => {
  const pkg = { scripts: {}, devDependencies: { '@biomejs/biome': '^1.8.0' } };
  assert.strictEqual(detectFormatCmd(pkg, 'npm'), 'biome format .');
});

test('detectFormatWriteCmd returns "biome format --write ." when @biomejs/biome is a dependency and no format:write script exists', () => {
  const pkg = { scripts: {}, devDependencies: { '@biomejs/biome': '^1.8.0' } };
  assert.strictEqual(detectFormatWriteCmd(pkg, 'npm'), 'biome format --write .');
});

// --- AC 9: eslint/prettier fallback when no script and no biome dependency ---

test('detectLintCmd returns "eslint ." when eslint is a dependency and no lint script or biome dependency exists', () => {
  const pkg = { scripts: {}, devDependencies: { eslint: '^9.0.0' } };
  assert.strictEqual(detectLintCmd(pkg, 'npm'), 'eslint .');
});

test('detectFormatCmd returns "prettier --check ." when prettier is a dependency and no format script or biome dependency exists', () => {
  const pkg = { scripts: {}, devDependencies: { prettier: '^3.0.0' } };
  assert.strictEqual(detectFormatCmd(pkg, 'npm'), 'prettier --check .');
});

test('detectFormatWriteCmd returns "prettier --write ." when prettier is a dependency and no format:write script or biome dependency exists', () => {
  const pkg = { scripts: {}, devDependencies: { prettier: '^3.0.0' } };
  assert.strictEqual(detectFormatWriteCmd(pkg, 'npm'), 'prettier --write .');
});

// --- AC 10: no script and no matching tool dependency at all -> '' ---

test("detectLintCmd returns '' when there is no lint script and no lint tool dependency at all", () => {
  const pkg = { scripts: {}, dependencies: {}, devDependencies: {} };
  assert.strictEqual(detectLintCmd(pkg, 'npm'), '');
});

test("detectFormatCmd returns '' when there is no format script and no format tool dependency at all", () => {
  const pkg = { scripts: {}, dependencies: {}, devDependencies: {} };
  assert.strictEqual(detectFormatCmd(pkg, 'npm'), '');
});

test("detectFormatWriteCmd returns '' when there is no format:write script and no format tool dependency at all", () => {
  const pkg = { scripts: {}, dependencies: {}, devDependencies: {} };
  assert.strictEqual(detectFormatWriteCmd(pkg, 'npm'), '');
});

test("detectLintCmd returns '' when package.json has no scripts or dependencies keys at all", () => {
  const pkg = {};
  assert.strictEqual(detectLintCmd(pkg, 'npm'), '');
});

test("detectFormatCmd returns '' when package.json has no scripts or dependencies keys at all", () => {
  const pkg = {};
  assert.strictEqual(detectFormatCmd(pkg, 'npm'), '');
});

test("detectFormatWriteCmd returns '' when package.json has no scripts or dependencies keys at all", () => {
  const pkg = {};
  assert.strictEqual(detectFormatWriteCmd(pkg, 'npm'), '');
});

// --- AC 17: explicit, non-placeholder test script ---

test('detectTestCmd resolves the explicit non-placeholder test script to "<packageManager> test"', () => {
  const pkg = { scripts: { test: 'node --test test/**/*.test.mjs' } };
  assert.strictEqual(detectTestCmd(pkg, 'npm'), 'npm test');
});

// --- AC 18: npm-init placeholder test script is treated as absent ---

test('detectTestCmd treats the npm-init placeholder test script as absent and falls through to test:ci', () => {
  const pkg = {
    scripts: {
      test: 'echo "Error: no test specified" && exit 1',
      'test:ci': 'vitest run',
    },
  };
  assert.strictEqual(detectTestCmd(pkg, 'npm'), 'npm run test:ci');
});

test("detectTestCmd returns '' when only the npm-init placeholder test script is present", () => {
  const pkg = { scripts: { test: 'echo "Error: no test specified" && exit 1' } };
  assert.strictEqual(detectTestCmd(pkg, 'npm'), '');
});

// --- AC 19: test:unit preferred over test:ci when both present ---

test('detectTestCmd prefers test:unit over test:ci when both are present and there is no usable test script', () => {
  const pkg = { scripts: { 'test:unit': 'vitest run unit', 'test:ci': 'vitest run --ci' } };
  assert.strictEqual(detectTestCmd(pkg, 'npm'), 'npm run test:unit');
});

test('detectTestCmd falls back to test:ci when only test:ci is present and there is no usable test script', () => {
  const pkg = { scripts: { 'test:ci': 'vitest run --ci' } };
  assert.strictEqual(detectTestCmd(pkg, 'npm'), 'npm run test:ci');
});

// --- AC 20: no test-related script at all -> '' ---

test("detectTestCmd returns '' when there is no test-related script at all", () => {
  const pkg = { scripts: {} };
  assert.strictEqual(detectTestCmd(pkg, 'npm'), '');
});

test("detectTestCmd returns '' when package.json has no scripts key at all", () => {
  const pkg = {};
  assert.strictEqual(detectTestCmd(pkg, 'npm'), '');
});
