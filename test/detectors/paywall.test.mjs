// Tests for skills/relay-setup/scripts/detectors/paywall.mjs
//
// Characterization tests against real source (confirmed by reading
// paywall.mjs directly) — happy-path assertions check the exact literal
// provider string each recognized dependency resolves to, not just
// "truthy."

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectPaywall } from '../../skills/relay-setup/scripts/detectors/paywall.mjs'

test('detectPaywall returns "revenuecat" when react-native-purchases is a dependency', () => {
  const pkg = { dependencies: { 'react-native-purchases': '^7.0.0' }, devDependencies: {} }
  assert.strictEqual(detectPaywall(pkg), 'revenuecat')
})

test('detectPaywall returns "revenuecat" when @revenuecat/purchases-js is a dependency', () => {
  const pkg = { dependencies: { '@revenuecat/purchases-js': '^1.0.0' }, devDependencies: {} }
  assert.strictEqual(detectPaywall(pkg), 'revenuecat')
})

test('detectPaywall returns "expo-iap" when expo-in-app-purchases is a dependency', () => {
  const pkg = { dependencies: { 'expo-in-app-purchases': '^14.0.0' }, devDependencies: {} }
  assert.strictEqual(detectPaywall(pkg), 'expo-iap')
})

test('detectPaywall returns "react-native-iap" when react-native-iap is a dependency', () => {
  const pkg = { dependencies: { 'react-native-iap': '^12.0.0' }, devDependencies: {} }
  assert.strictEqual(detectPaywall(pkg), 'react-native-iap')
})

test('detectPaywall returns "stripe" when @stripe/stripe-js is a dependency', () => {
  const pkg = { dependencies: { '@stripe/stripe-js': '^3.0.0' }, devDependencies: {} }
  assert.strictEqual(detectPaywall(pkg), 'stripe')
})

test('detectPaywall returns "lemonsqueezy" when lemonsqueezy is a dependency', () => {
  const pkg = { dependencies: { lemonsqueezy: '^1.0.0' }, devDependencies: {} }
  assert.strictEqual(detectPaywall(pkg), 'lemonsqueezy')
})

test("detectPaywall returns '' when no paywall/purchase dependency is present", () => {
  const pkg = { dependencies: {}, devDependencies: {} }
  assert.strictEqual(detectPaywall(pkg), '')
})

test("detectPaywall returns '' when dependencies/devDependencies are entirely absent", () => {
  assert.strictEqual(detectPaywall({}), '')
})
