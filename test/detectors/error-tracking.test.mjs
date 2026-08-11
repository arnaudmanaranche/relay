import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectErrorTracking } from '../../skills/relay-setup/scripts/detectors/error-tracking.mjs'

// NOTE: see dev-log.md ("Batch 2") for the caveat on these fixtures — exact
// dependency-name signals recognized by error-tracking.mjs could not be
// confirmed against source in this session, so happy-path assertions check
// for a truthy/non-empty signal rather than an exact literal value, while
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

test('detectErrorTracking returns a signal when a well-known error tracking dependency is present (@sentry/node)', () => {
  const pkg = {
    dependencies: { '@sentry/node': '^7.0.0' },
    devDependencies: {},
  }
  const result = detectErrorTracking(pkg)
  assert.ok(
    hasSignal(result),
    'expected detectErrorTracking to return a non-empty signal for a @sentry/node dependency'
  )
})

test('detectErrorTracking returns a signal when a well-known error tracking dependency is present (@bugsnag/js)', () => {
  const pkg = {
    dependencies: { '@bugsnag/js': '^7.0.0' },
    devDependencies: {},
  }
  const result = detectErrorTracking(pkg)
  assert.ok(
    hasSignal(result),
    'expected detectErrorTracking to return a non-empty signal for a @bugsnag/js dependency'
  )
})

test('detectErrorTracking returns falsy/empty when no error tracking dependency is present', () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  const result = detectErrorTracking(pkg)
  assertNoSignal(result)
})

test('detectErrorTracking returns falsy/empty when dependencies/devDependencies are entirely absent', () => {
  const pkg = {}
  const result = detectErrorTracking(pkg)
  assertNoSignal(result)
})
