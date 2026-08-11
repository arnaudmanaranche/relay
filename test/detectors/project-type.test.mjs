// Tests for skills/relay-setup/scripts/detectors/project-type.mjs
//
// detectProjectType's output ('mobile' | 'web' | 'unknown') is a required
// input fixture for detectAppId's AC 4-6 in project.test.mjs.
//
// Real signature (confirmed against source): detectProjectType(pkg) — a
// single, dependency-only argument. No filesystem reads (e.g. a
// capacitor.config.json file is not a signal this function itself
// checks — that's project.mjs's detectAppId).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProjectType } from '../../skills/relay-setup/scripts/detectors/project-type.mjs';

test('detectProjectType returns mobile when react-native is a dependency', () => {
  const pkg = { dependencies: { 'react-native': '^0.74.0' } };
  assert.strictEqual(detectProjectType(pkg), 'mobile');
});

test('detectProjectType returns mobile when expo is a dependency', () => {
  const pkg = { dependencies: { expo: '^51.0.0' } };
  assert.strictEqual(detectProjectType(pkg), 'mobile');
});

test('detectProjectType returns web when next is a dependency', () => {
  const pkg = { dependencies: { next: '^14.0.0' } };
  assert.strictEqual(detectProjectType(pkg), 'web');
});

test('detectProjectType returns web when vite is a dependency', () => {
  const pkg = { devDependencies: { vite: '^5.0.0' } };
  assert.strictEqual(detectProjectType(pkg), 'web');
});

test('detectProjectType returns unknown when a plain react dependency is present with no recognized framework', () => {
  // Bare `react` alone is not one of the recognized web-framework signals
  // (next/vite/react-scripts/nuxt/@sveltejs/kit/astro/@angular/core) — this
  // deliberately locks in that this function does not treat every React
  // project as "web" on its own.
  const pkg = { dependencies: { react: '^18.0.0' } };
  assert.strictEqual(detectProjectType(pkg), 'unknown');
});

test('detectProjectType returns unknown when there is no recognizable web or mobile signal', () => {
  const pkg = { dependencies: {} };
  assert.strictEqual(detectProjectType(pkg), 'unknown');
});

test('detectProjectType returns unknown when package.json has no dependencies key at all', () => {
  const pkg = {};
  assert.strictEqual(detectProjectType(pkg), 'unknown');
});
