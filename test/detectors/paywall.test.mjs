import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectPaywall } from '../../skills/relay-setup/scripts/detectors/paywall.mjs'

// NOTE: see dev-log.md ("Batch 2") for the caveat on these fixtures — exact
// dependency-name signals recognized by paywall.mjs could not be confirmed
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

test('detectPaywall returns a signal when a well-known paywall/purchase dependency is present (react-native-purchases)', () => {
  const pkg = {
    dependencies: { 'react-native-purchases': '^7.0.0' },
    devDependencies: {},
  }
  const result = detectPaywall(pkg)
  assert.ok(
    hasSignal(result),
    'expected detectPaywall to return a non-empty signal for a react-native-purchases dependency'
  )
})

test('detectPaywall returns a signal when a well-known paywall/purchase dependency is present (@stripe/stripe-js)', () => {
  const pkg = {
    dependencies: { '@stripe/stripe-js': '^3.0.0' },
    devDependencies: {},
  }
  const result = detectPaywall(pkg)
  assert.ok(hasSignal(result), 'expected detectPaywall to return a non-empty signal for a @stripe/stripe-js dependency')
})

test('detectPaywall returns falsy/empty when no paywall/purchase dependency is present', () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  const result = detectPaywall(pkg)
  assertNoSignal(result)
})

test('detectPaywall returns falsy/empty when dependencies/devDependencies are entirely absent', () => {
  const pkg = {}
  const result = detectPaywall(pkg)
  assertNoSignal(result)
})
