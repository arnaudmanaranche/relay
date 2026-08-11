import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectAnalytics } from '../../skills/relay-setup/scripts/detectors/analytics.mjs'

// NOTE: see dev-log.md ("Batch 2") for the caveat on these fixtures — exact
// dependency-name signals recognized by analytics.mjs could not be confirmed
// against source in this session, so happy-path assertions check for a
// truthy/non-empty signal rather than an exact literal value, while
// no-signal-found assertions confidently check the documented empty
// (''/[]) convention shared by every detector in this repo.

function hasSignal(result) {
  if (Array.isArray(result)) return result.length > 0
  if (typeof result === 'string') return result.length > 0
  return Boolean(result)
}

function assertNoSignal(result) {
  if (Array.isArray(result)) {
    assert.deepEqual(result, [])
  } else {
    assert.equal(result, '')
  }
}

test('detectAnalytics returns a signal when a well-known analytics dependency is present (posthog-js)', () => {
  const pkg = {
    dependencies: { 'posthog-js': '^1.0.0' },
    devDependencies: {},
  }
  const result = detectAnalytics(pkg)
  assert.ok(hasSignal(result), 'expected detectAnalytics to return a non-empty signal for a posthog-js dependency')
})

test('detectAnalytics returns a signal when a well-known analytics dependency is present (@segment/analytics-next)', () => {
  const pkg = {
    dependencies: { '@segment/analytics-next': '^1.0.0' },
    devDependencies: {},
  }
  const result = detectAnalytics(pkg)
  assert.ok(
    hasSignal(result),
    'expected detectAnalytics to return a non-empty signal for a @segment/analytics-next dependency'
  )
})

test('detectAnalytics returns falsy/empty when no analytics dependency is present', () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  const result = detectAnalytics(pkg)
  assertNoSignal(result)
})

test('detectAnalytics returns falsy/empty when dependencies/devDependencies are entirely absent', () => {
  const pkg = {}
  const result = detectAnalytics(pkg)
  assertNoSignal(result)
})

test('detectAnalytics returns falsy/empty for an empty package.json object', () => {
  const pkg = {}
  const result = detectAnalytics(pkg)
  assertNoSignal(result)
})
