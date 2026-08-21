// Tests for skills/relay-setup/scripts/detectors/ios.mjs
//
// Real signature (confirmed against source): detectIos(root) — a
// filesystem-based detector. It scans the conventional ios/ directory
// first, then the repo root, and always returns { scheme, workspace,
// project }, with empty strings when nothing is recognized.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectIos } from '../../skills/relay-setup/scripts/detectors/ios.mjs';

const tmpDirs = [];

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-ios-'));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detectIos returns empty fields when no iOS project exists', () => {
  const dir = makeTmpDir();
  assert.deepStrictEqual(detectIos(dir), { scheme: '', workspace: '', project: '' });
});

test('detectIos finds workspace and project in ios/ and derives the scheme from the project name', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'ios', 'MyApp.xcworkspace'), { recursive: true });
  mkdirSync(join(dir, 'ios', 'MyApp.xcodeproj'), { recursive: true });
  assert.deepStrictEqual(detectIos(dir), {
    scheme: 'MyApp',
    workspace: 'ios/MyApp.xcworkspace',
    project: 'ios/MyApp.xcodeproj',
  });
});

test('detectIos prefers the workspace over a bare project when both exist', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'ios', 'App.xcworkspace'), { recursive: true });
  mkdirSync(join(dir, 'ios', 'App.xcodeproj'), { recursive: true });
  const result = detectIos(dir);
  assert.strictEqual(result.workspace, 'ios/App.xcworkspace');
  // Both are still reported — upload-build.sh archives from the workspace
  // but keeps the project path as a fallback for non-CocoaPods setups.
  assert.strictEqual(result.project, 'ios/App.xcodeproj');
});

test('detectIos falls back to a bare .xcodeproj without a workspace', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'ios', 'Bare.xcodeproj'), { recursive: true });
  assert.deepStrictEqual(detectIos(dir), {
    scheme: 'Bare',
    workspace: '',
    project: 'ios/Bare.xcodeproj',
  });
});

test('detectIos scans the repo root when there is no ios/ directory', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'RootApp.xcodeproj'), { recursive: true });
  assert.deepStrictEqual(detectIos(dir), {
    scheme: 'RootApp',
    workspace: '',
    project: 'RootApp.xcodeproj',
  });
});

test('detectIos prefers ios/ over a root-level project when both exist', () => {
  const dir = makeTmpDir();
  mkdirSync(join(dir, 'ios', 'Native.xcodeproj'), { recursive: true });
  mkdirSync(join(dir, 'Other.xcodeproj'), { recursive: true });
  const result = detectIos(dir);
  assert.strictEqual(result.project, 'ios/Native.xcodeproj');
  assert.strictEqual(result.scheme, 'Native');
});
