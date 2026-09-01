// Tests for skills/setup/scripts/detectors/analytics.mjs
//
// Characterization tests against real source (confirmed by reading
// analytics.mjs directly) — happy-path assertions check the exact literal
// provider string each recognized dependency resolves to, not just
// "truthy." Real signature: detectAnalytics(pkg, root) — root is only
// actually read for the firebase branch (`exists(root, 'src')`); every
// other branch short-circuits on the dependency check first, so it's safe
// to omit root for those cases.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectAnalytics } from '../../skills/setup/scripts/detectors/analytics.mjs'

const tmpDirs = []
function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'relay-detector-analytics-'))
  tmpDirs.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
})

test('detectAnalytics returns "posthog" when posthog-js is a dependency', () => {
  const pkg = { dependencies: { 'posthog-js': '^1.0.0' }, devDependencies: {} }
  assert.strictEqual(detectAnalytics(pkg), 'posthog')
})

test('detectAnalytics returns "segment" when @segment/analytics-next is a dependency', () => {
  const pkg = { dependencies: { '@segment/analytics-next': '^1.0.0' }, devDependencies: {} }
  assert.strictEqual(detectAnalytics(pkg), 'segment')
})

test('detectAnalytics returns "mixpanel" when mixpanel-browser is a dependency', () => {
  const pkg = { dependencies: { 'mixpanel-browser': '^2.0.0' }, devDependencies: {} }
  assert.strictEqual(detectAnalytics(pkg), 'mixpanel')
})

test('detectAnalytics returns "amplitude" when @amplitude/analytics-browser is a dependency', () => {
  const pkg = { dependencies: { '@amplitude/analytics-browser': '^1.0.0' }, devDependencies: {} }
  assert.strictEqual(detectAnalytics(pkg), 'amplitude')
})

test('detectAnalytics returns "rudderstack" when @rudderstack/analytics-js is a dependency', () => {
  const pkg = { dependencies: { '@rudderstack/analytics-js': '^1.0.0' }, devDependencies: {} }
  assert.strictEqual(detectAnalytics(pkg), 'rudderstack')
})

test('detectAnalytics returns "firebase-analytics" when firebase is a dependency AND a src/ directory exists', () => {
  const dir = makeTmpDir()
  mkdirSync(join(dir, 'src'))
  const pkg = { dependencies: { firebase: '^10.0.0' }, devDependencies: {} }
  assert.strictEqual(detectAnalytics(pkg, dir), 'firebase-analytics')
})

test("detectAnalytics returns '' when firebase is a dependency but there is no src/ directory", () => {
  const dir = makeTmpDir()
  const pkg = { dependencies: { firebase: '^10.0.0' }, devDependencies: {} }
  assert.strictEqual(detectAnalytics(pkg, dir), '')
})

test("detectAnalytics returns '' when no analytics dependency is present", () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  assert.strictEqual(detectAnalytics(pkg), '')
})

test("detectAnalytics returns '' when dependencies/devDependencies are entirely absent", () => {
  assert.strictEqual(detectAnalytics({}), '')
})
