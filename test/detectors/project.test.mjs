// Tests for skills/relay-setup/scripts/detectors/project.mjs
//
// Covers AC 1-6 for detectAppId, plus detectProjectName, detectGithubRepo,
// and detectDefaultBranch (baseline happy-path + no-signal-found coverage
// per AC 21).
//
// Real signatures (confirmed against source):
//   detectProjectName(pkg, root)
//   detectAppId(pkg, root, projectType)
//   detectGithubRepo(root)
//   detectDefaultBranch(root)
//
// Note on AC 1 precedence: the source checks android.package before
// ios.bundleIdentifier in the static app.json branch, so a fixture setting
// both would resolve to android's value; this file tests each in isolation
// to avoid asserting an order the brief never specified.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import {
  detectProjectName,
  detectAppId,
  detectGithubRepo,
  detectDefaultBranch,
} from '../../skills/relay-setup/scripts/detectors/project.mjs';

const tmpDirs = [];

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-project-'));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- detectAppId: AC 1 (Expo static config) ---

test('detectAppId returns the bundle id from app.json expo.android.package when present', () => {
  const dir = makeTmpDir();
  writeFileSync(
    join(dir, 'app.json'),
    JSON.stringify({ expo: { name: 'demo', android: { package: 'com.example.androidapp' } } })
  );
  assert.strictEqual(detectAppId({ name: 'demo' }, dir, 'mobile'), 'com.example.androidapp');
});

test('detectAppId returns the bundle id from app.json expo.ios.bundleIdentifier when present (and no android.package)', () => {
  const dir = makeTmpDir();
  writeFileSync(
    join(dir, 'app.json'),
    JSON.stringify({ expo: { name: 'demo', ios: { bundleIdentifier: 'com.example.iosapp' } } })
  );
  assert.strictEqual(detectAppId({ name: 'demo' }, dir, 'mobile'), 'com.example.iosapp');
});

// --- detectAppId: AC 2 (Expo dynamic config) ---

test('detectAppId parses the bundle id from an app.config.js dynamic Expo config (ios.bundleIdentifier)', () => {
  const dir = makeTmpDir();
  writeFileSync(
    join(dir, 'app.config.js'),
    [
      "module.exports = {",
      "  expo: {",
      "    name: 'demo',",
      "    ios: { bundleIdentifier: 'com.example.dynamic' },",
      "  },",
      "};",
      '',
    ].join('\n')
  );
  assert.strictEqual(detectAppId({ name: 'demo' }, dir, 'mobile'), 'com.example.dynamic');
});

test('detectAppId parses the bundle id from an app.config.ts dynamic Expo config (android.package)', () => {
  const dir = makeTmpDir();
  writeFileSync(
    join(dir, 'app.config.ts'),
    [
      'export default {',
      "  expo: {",
      "    name: 'demo',",
      "    android: { package: 'com.example.dynamicandroid' },",
      '  },',
      '};',
      '',
    ].join('\n')
  );
  assert.strictEqual(detectAppId({ name: 'demo' }, dir, 'mobile'), 'com.example.dynamicandroid');
});

// --- detectAppId: AC 3 (Capacitor config — only capacitor.config.json is read, per source) ---

test('detectAppId returns the appId from capacitor.config.json when present', () => {
  const dir = makeTmpDir();
  writeFileSync(join(dir, 'capacitor.config.json'), JSON.stringify({ appId: 'com.example.capacitor' }));
  assert.strictEqual(detectAppId({ name: 'demo' }, dir, 'mobile'), 'com.example.capacitor');
});

// --- detectAppId: AC 4 & 5 (no mobile signal, web/unknown project type) ---

test("detectAppId returns '' when project_type is web and no mobile config exists", () => {
  const dir = makeTmpDir();
  assert.strictEqual(detectAppId({ name: 'demo' }, dir, 'web'), '');
});

test("detectAppId returns '' when project_type is unknown and no mobile config exists", () => {
  const dir = makeTmpDir();
  assert.strictEqual(detectAppId({ name: 'demo' }, dir, 'unknown'), '');
});

// --- detectAppId: AC 6 (mobile fallback fabrication) ---

test('detectAppId fabricates a com.example.<name> bundle id when project_type is mobile and no mobile config exists', () => {
  const dir = makeTmpDir();
  assert.strictEqual(detectAppId({ name: 'demo-app' }, dir, 'mobile'), 'com.example.demo.app');
});

test('detectAppId falls back to com.example.app when project_type is mobile and package.json has no name', () => {
  const dir = makeTmpDir();
  assert.strictEqual(detectAppId({}, dir, 'mobile'), 'com.example.app');
});

// --- detectProjectName ---

test('detectProjectName returns the package.json name field, title-cased with separators as spaces', () => {
  const dir = makeTmpDir();
  assert.strictEqual(detectProjectName({ name: 'my-cool-project' }, dir), 'My Cool Project');
});

test('detectProjectName falls back to the directory basename, title-cased, when package.json has no name field', () => {
  const dir = makeTmpDir();
  const expected = basename(dir).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  assert.strictEqual(detectProjectName({}, dir), expected);
});

// --- detectGithubRepo ---

test('detectGithubRepo returns owner/repo parsed from a .git/config https remote origin url', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, '.git'));
  writeFileSync(
    join(dir, '.git', 'config'),
    [
      '[core]',
      '\trepositoryformatversion = 0',
      '[remote "origin"]',
      '\turl = https://github.com/arnaudmanaranche/ai-feature-pipeline.git',
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '',
    ].join('\n')
  );
  assert.strictEqual(detectGithubRepo(dir), 'arnaudmanaranche/ai-feature-pipeline');
});

test("detectGithubRepo falls back to 'org/repo' when there is no .git/config file", () => {
  const dir = makeTmpDir();
  assert.strictEqual(detectGithubRepo(dir), 'org/repo');
});

// --- detectDefaultBranch ---

test('detectDefaultBranch returns the branch name parsed from .git/HEAD', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/develop\n');
  assert.strictEqual(detectDefaultBranch(dir), 'develop');
});

test("detectDefaultBranch falls back to 'main' when there is no .git/HEAD file", () => {
  const dir = makeTmpDir();
  assert.strictEqual(detectDefaultBranch(dir), 'main');
});
