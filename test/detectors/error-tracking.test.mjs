// Tests for skills/relay-setup/scripts/detectors/error-tracking.mjs
//
// Characterization tests against real source (confirmed by reading
// error-tracking.mjs directly) — happy-path assertions check the exact
// literal provider string each recognized dependency resolves to, not
// just "truthy."

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectErrorTracking } from '../../skills/relay-setup/scripts/detectors/error-tracking.mjs'

test('detectErrorTracking returns "sentry" when @sentry/node is a dependency', () => {
  const pkg = { dependencies: { '@sentry/node': '^7.0.0' }, devDependencies: {} }
  assert.strictEqual(detectErrorTracking(pkg), 'sentry')
})

test('detectErrorTracking returns "sentry" when @sentry/react-native is a dependency', () => {
  const pkg = { dependencies: { '@sentry/react-native': '^5.0.0' }, devDependencies: {} }
  assert.strictEqual(detectErrorTracking(pkg), 'sentry')
})

test('detectErrorTracking returns "bugsnag" when @bugsnag/js is a dependency', () => {
  const pkg = { dependencies: { '@bugsnag/js': '^7.0.0' }, devDependencies: {} }
  assert.strictEqual(detectErrorTracking(pkg), 'bugsnag')
})

test('detectErrorTracking returns "datadog" when @datadog/browser-rum is a dependency', () => {
  const pkg = { dependencies: { '@datadog/browser-rum': '^5.0.0' }, devDependencies: {} }
  assert.strictEqual(detectErrorTracking(pkg), 'datadog')
})

test('detectErrorTracking returns "rollbar" when rollbar is a dependency', () => {
  const pkg = { dependencies: { rollbar: '^2.0.0' }, devDependencies: {} }
  assert.strictEqual(detectErrorTracking(pkg), 'rollbar')
})

test('detectErrorTracking returns "highlight" when highlight.run is a dependency', () => {
  const pkg = { dependencies: { 'highlight.run': '^9.0.0' }, devDependencies: {} }
  assert.strictEqual(detectErrorTracking(pkg), 'highlight')
})

test("detectErrorTracking returns '' when no error tracking dependency is present", () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  assert.strictEqual(detectErrorTracking(pkg), '')
})

test("detectErrorTracking returns '' when dependencies/devDependencies are entirely absent", () => {
  assert.strictEqual(detectErrorTracking({}), '')
})
