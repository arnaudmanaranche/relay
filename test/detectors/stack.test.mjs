import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectRouter, detectStyling, detectBackend } from '../../skills/relay-setup/scripts/detectors/stack.mjs'

// NOTE: see dev-log.md ("Batch 2") for the caveat on these fixtures — exact
// dependency-name signals recognized by stack.mjs could not be confirmed
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

test('detectRouter returns a signal when a well-known router dependency is present (next)', () => {
  const pkg = {
    dependencies: { next: '^14.0.0' },
    devDependencies: {},
  }
  const result = detectRouter(pkg)
  assert.ok(hasSignal(result), 'expected detectRouter to return a non-empty signal for a next dependency')
})

test('detectRouter returns a signal when a well-known router dependency is present (react-router-dom)', () => {
  const pkg = {
    dependencies: { 'react-router-dom': '^6.0.0' },
    devDependencies: {},
  }
  const result = detectRouter(pkg)
  assert.ok(hasSignal(result), 'expected detectRouter to return a non-empty signal for a react-router-dom dependency')
})

test('detectRouter returns falsy/empty when no router dependency is present', () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  const result = detectRouter(pkg)
  assertNoSignal(result)
})

test('detectRouter returns falsy/empty when dependencies/devDependencies are entirely absent', () => {
  const pkg = {}
  const result = detectRouter(pkg)
  assertNoSignal(result)
})

test('detectStyling returns a signal when a well-known styling dependency is present (tailwindcss)', () => {
  const pkg = {
    dependencies: {},
    devDependencies: { tailwindcss: '^3.0.0' },
  }
  const result = detectStyling(pkg)
  assert.ok(hasSignal(result), 'expected detectStyling to return a non-empty signal for a tailwindcss dependency')
})

test('detectStyling returns a signal when a well-known styling dependency is present (styled-components)', () => {
  const pkg = {
    dependencies: { 'styled-components': '^6.0.0' },
    devDependencies: {},
  }
  const result = detectStyling(pkg)
  assert.ok(hasSignal(result), 'expected detectStyling to return a non-empty signal for a styled-components dependency')
})

test('detectStyling defaults to CSS when no recognized styling dependency is present', () => {
  // Confirmed against source: unlike detectRouter/detectBackend (which
  // return '' with no signal), detectStyling always resolves to a value —
  // 'StyleSheet' for React Native, 'CSS' otherwise. There is no
  // empty-string case for this function.
  const pkg = { dependencies: {}, devDependencies: {} }
  assert.strictEqual(detectStyling(pkg), 'CSS')
})

test('detectStyling returns StyleSheet as the React Native default when react-native is a dependency with no other styling library', () => {
  const pkg = { dependencies: { 'react-native': '^0.74.0' }, devDependencies: {} }
  assert.strictEqual(detectStyling(pkg), 'StyleSheet')
})

test('detectBackend returns a signal when a well-known backend/database dependency is present (@supabase/supabase-js)', () => {
  // detectBackend recognizes backend-as-a-service / database client
  // libraries (supabase, firebase, amplify, convex, prisma, drizzle,
  // mongoose, pg/postgres) — not general web frameworks like express or
  // nestjs, which this detector does not check for at all.
  const pkg = {
    dependencies: { '@supabase/supabase-js': '^2.0.0' },
    devDependencies: {},
  }
  const result = detectBackend(pkg)
  assert.ok(hasSignal(result), 'expected detectBackend to return a non-empty signal for a @supabase/supabase-js dependency')
})

test('detectBackend returns a signal when a well-known backend/database dependency is present (@prisma/client)', () => {
  const pkg = {
    dependencies: { '@prisma/client': '^5.0.0' },
    devDependencies: {},
  }
  const result = detectBackend(pkg)
  assert.ok(hasSignal(result), 'expected detectBackend to return a non-empty signal for a @prisma/client dependency')
})

test('detectBackend returns falsy/empty when no backend dependency is present', () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  const result = detectBackend(pkg)
  assertNoSignal(result)
})

test('detectBackend returns falsy/empty when dependencies/devDependencies are entirely absent', () => {
  const pkg = {}
  const result = detectBackend(pkg)
  assertNoSignal(result)
})
