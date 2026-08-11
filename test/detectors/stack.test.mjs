// Tests for skills/relay-setup/scripts/detectors/stack.mjs
//
// Characterization tests against real source (confirmed by reading
// stack.mjs directly) — happy-path assertions check the exact literal
// value each detector returns for a given recognized dependency, not just
// "truthy," so a regression to a wrong-but-still-truthy value is caught.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectRouter, detectStyling, detectBackend } from '../../skills/relay-setup/scripts/detectors/stack.mjs'

test('detectRouter returns "next" when next is a dependency', () => {
  const pkg = { dependencies: { next: '^14.0.0' }, devDependencies: {} }
  assert.strictEqual(detectRouter(pkg), 'next')
})

test('detectRouter returns "react-router" when react-router-dom is a dependency', () => {
  const pkg = { dependencies: { 'react-router-dom': '^6.0.0' }, devDependencies: {} }
  assert.strictEqual(detectRouter(pkg), 'react-router')
})

test('detectRouter returns "expo-router" when expo-router is a dependency', () => {
  const pkg = { dependencies: { 'expo-router': '^3.0.0' }, devDependencies: {} }
  assert.strictEqual(detectRouter(pkg), 'expo-router')
})

test("detectRouter returns '' when no router dependency is present", () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  assert.strictEqual(detectRouter(pkg), '')
})

test("detectRouter returns '' when dependencies/devDependencies are entirely absent", () => {
  assert.strictEqual(detectRouter({}), '')
})

test('detectStyling returns "tailwind" when tailwindcss is a dependency', () => {
  const pkg = { dependencies: {}, devDependencies: { tailwindcss: '^3.0.0' } }
  assert.strictEqual(detectStyling(pkg), 'tailwind')
})

test('detectStyling returns "styled-components" when styled-components is a dependency', () => {
  const pkg = { dependencies: { 'styled-components': '^6.0.0' }, devDependencies: {} }
  assert.strictEqual(detectStyling(pkg), 'styled-components')
})

test('detectStyling defaults to "CSS" when no recognized styling dependency is present', () => {
  // Confirmed against source: unlike detectRouter/detectBackend (which
  // return '' with no signal), detectStyling always resolves to a value —
  // 'StyleSheet' for React Native, 'CSS' otherwise. There is no
  // empty-string case for this function.
  const pkg = { dependencies: {}, devDependencies: {} }
  assert.strictEqual(detectStyling(pkg), 'CSS')
})

test('detectStyling returns "StyleSheet" as the React Native default when react-native is a dependency with no other styling library', () => {
  const pkg = { dependencies: { 'react-native': '^0.74.0' }, devDependencies: {} }
  assert.strictEqual(detectStyling(pkg), 'StyleSheet')
})

test('detectBackend returns "supabase" when @supabase/supabase-js is a dependency', () => {
  // detectBackend recognizes backend-as-a-service / database client
  // libraries (supabase, firebase, amplify, convex, prisma, drizzle,
  // mongoose, pg/postgres) — not general web frameworks like express or
  // nestjs, which this detector does not check for at all.
  const pkg = { dependencies: { '@supabase/supabase-js': '^2.0.0' }, devDependencies: {} }
  assert.strictEqual(detectBackend(pkg), 'supabase')
})

test('detectBackend returns "prisma" when @prisma/client is a dependency', () => {
  const pkg = { dependencies: { '@prisma/client': '^5.0.0' }, devDependencies: {} }
  assert.strictEqual(detectBackend(pkg), 'prisma')
})

test('detectBackend returns "postgres" when pg is a dependency', () => {
  const pkg = { dependencies: { pg: '^8.0.0' }, devDependencies: {} }
  assert.strictEqual(detectBackend(pkg), 'postgres')
})

test("detectBackend returns '' when no backend dependency is present", () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  assert.strictEqual(detectBackend(pkg), '')
})

test("detectBackend returns '' when dependencies/devDependencies are entirely absent", () => {
  assert.strictEqual(detectBackend({}), '')
})
