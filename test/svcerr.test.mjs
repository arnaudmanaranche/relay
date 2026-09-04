// Tests for relay-dashboard/src/svcerr.ts — service errors made readable.
//
// The bug this module exists for was visible, not theoretical: opening a
// run whose worktree had been removed put a raw JSON blob in the status
// bar. The first case below is the exact byte string the running app
// produced, captured from a probe app's snapshot rather than guessed.
//
// The other half of the contract is the fallback. Engine-level failures
// arrive as bare reason words, not JSON, and those must pass through
// untouched — a scanner that "cleans up" what it doesn't understand would
// turn an error into a mystery.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { serviceErrorText } from '../relay-dashboard/src/svcerr.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const clean = s => dec.decode(serviceErrorText(enc.encode(s)));

describe('serviceErrorText — the real shape', () => {
  test('the exact blob the app showed for a missing worktree becomes its sentence', () => {
    const observed =
      '{"kind":"path_missing","message":"/Users/amanaranche/relay/.relay/worktrees/gone-run does not exist."}';
    assert.equal(
      clean(observed),
      '/Users/amanaranche/relay/.relay/worktrees/gone-run does not exist.'
    );
  });

  test('every other boundary throw in the service maps the same way', () => {
    assert.equal(
      clean('{"kind":"script_missing","message":"/repo/run-pipeline.sh does not exist."}'),
      '/repo/run-pipeline.sh does not exist.'
    );
    assert.equal(
      clean('{"kind":"not_resumable","message":"This run has no resume command."}'),
      'This run has no resume command.'
    );
  });

  test('key order does not matter — message first still resolves', () => {
    assert.equal(clean('{"message":"first field","kind":"x"}'), 'first field');
  });

  test('whitespace a pretty-printer would add is tolerated', () => {
    assert.equal(clean('{ "message" : "spaced out" }'), 'spaced out');
  });
});

describe('serviceErrorText — escapes', () => {
  test('an escaped quote and backslash come back as themselves', () => {
    assert.equal(
      clean('{"message":"a \\"quoted\\" path C:\\\\tmp\\\\x"}'),
      'a "quoted" path C:\\tmp\\x'
    );
  });

  test('a newline escape becomes a real newline', () => {
    assert.equal(clean('{"message":"line one\\nline two"}'), 'line one\nline two');
  });

  test('an escaped forward slash resolves to a plain slash', () => {
    assert.equal(clean('{"message":"a\\/b"}'), 'a/b');
  });

  test('a \\uXXXX control escape is dropped rather than half-decoded', () => {
    // JSON.stringify only emits \u for control characters; none of them
    // belong in a status bar.
    assert.equal(clean('{"message":"before\\u0007after"}'), 'beforeafter');
  });

  test('non-ASCII text survives — the scan never re-encodes it', () => {
    // JSON.stringify leaves these alone, so they arrive as raw UTF-8 and
    // must pass through byte-for-byte.
    assert.equal(clean('{"message":"le dossier n\'existe pas — coût 3 €"}'), "le dossier n'existe pas — coût 3 €");
  });
});

describe('serviceErrorText — anything unrecognized passes through untouched', () => {
  test('a bare engine reason word is left exactly as it is', () => {
    // What Cmd.spawn/ptySpawn/fetch failures actually deliver.
    for (const reason of ['cancelled', 'rejected', 'spawn_failed', 'io_failed', 'signaled']) {
      assert.equal(clean(reason), reason);
    }
  });

  test('JSON with no message field is shown whole rather than blanked', () => {
    const raw = '{"kind":"timeout"}';
    assert.equal(clean(raw), raw);
  });

  test('an empty message falls back to the raw blob — a blank status bar explains nothing', () => {
    const raw = '{"kind":"x","message":""}';
    assert.equal(clean(raw), raw);
  });

  test('a truncated blob is shown whole rather than half-parsed', () => {
    const raw = '{"kind":"x","message":"never closed';
    assert.equal(clean(raw), raw);
  });

  test('a key that merely ends in "message" is not mistaken for it', () => {
    // `messages` and `my_message` must not match: the scan requires the
    // closing quote right after the key.
    const raw = '{"messages":"plural","kind":"x"}';
    assert.equal(clean(raw), raw);
  });

  test('empty input stays empty', () => {
    assert.equal(serviceErrorText(new Uint8Array(0)).length, 0);
  });
});
