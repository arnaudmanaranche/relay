// Tests for relay-dashboard/src/ansi.ts — the pty output scrubber.
//
// The app core is executable TypeScript (it typechecks with stock tsc and
// runs unmodified under node), so this is a plain node test against the
// same module the native build compiles. What it pins is the contract the
// scrubber's caller depends on: escape sequences leave nothing behind,
// sequences split across two events still resolve, and a carriage return
// means "redraw this line", not "print another one".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { scanAnsi, dropPartialLine } from '../relay-dashboard/src/ansi.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b = s => enc.encode(s);
const text = u8 => dec.decode(u8);

// One batch through a fresh scan.
function scrub(s) {
  return text(scanAnsi(b(s), 'text').bytes);
}

describe('scanAnsi — escape sequences', () => {
  test('plain output passes through untouched', () => {
    assert.equal(scrub('==> Running Architect...\n'), '==> Running Architect...\n');
  });

  test('SGR color sequences leave nothing behind', () => {
    // What any CLI with colored output actually emits.
    assert.equal(scrub('[32mPASS[0m ok\n'), 'PASS ok\n');
  });

  test('cursor-motion and erase CSI sequences are dropped', () => {
    assert.equal(scrub('a[2Kb[1;3Hc[?25ld'), 'abcd');
  });

  test('an OSC title sequence terminated by BEL is dropped whole', () => {
    assert.equal(scrub(']0;relay pipelinedone'), 'done');
  });

  test('an OSC terminated by ST (ESC backslash) is dropped whole', () => {
    assert.equal(scrub(']8;;https://example.com\\link'), 'link');
  });

  test('a two-byte escape drops both bytes, not just the ESC', () => {
    assert.equal(scrub('xMy'), 'xy');
  });

  test('control bytes with no meaning outside a terminal are dropped, tabs and newlines kept', () => {
    assert.equal(scrub('abc\td\ne'), 'abc\td\ne');
  });

  test('UTF-8 multibyte output survives byte-level scanning', () => {
    // The scan works on bytes; every continuation byte is >= 0x80, so it
    // must fall through the control-byte checks untouched.
    assert.equal(scrub('coût : 3 €\n'), 'coût : 3 €\n');
  });
});

describe('scanAnsi — resumability across output events', () => {
  test('a CSI sequence split mid-parameter resolves across two batches', () => {
    // The engine coalesces output on its own schedule, not on sequence
    // boundaries, so this is the normal case, not a pathological one.
    const first = scanAnsi(b('ok [3'), 'text');
    assert.equal(text(first.bytes), 'ok ');
    assert.equal(first.mode, 'csi');
    const second = scanAnsi(b('2mgreen'), first.mode);
    assert.equal(text(second.bytes), 'green');
    assert.equal(second.mode, 'text');
  });

  test('an ESC alone at the end of a batch does not leak into the next batch as text', () => {
    const first = scanAnsi(b('a'), 'text');
    assert.equal(text(first.bytes), 'a');
    assert.equal(first.mode, 'esc');
    const second = scanAnsi(b('[0mb'), first.mode);
    assert.equal(text(second.bytes), 'b');
  });

  test('an OSC split across batches stays swallowed until its terminator', () => {
    const first = scanAnsi(b(']0;ti'), 'text');
    assert.equal(text(first.bytes), '');
    assert.equal(first.mode, 'osc');
    const second = scanAnsi(b('tleafter'), first.mode);
    assert.equal(text(second.bytes), 'after');
    assert.equal(second.mode, 'text');
  });

  test('a malformed OSC ends at the next byte after ESC instead of swallowing the rest', () => {
    // Failure mode this guards: one bad sequence eating every later line
    // of a run's output, with nothing to show the user why.
    const scan = scanAnsi(b(']0;xZstill here'), 'text');
    assert.equal(text(scan.bytes), 'still here');
    assert.equal(scan.mode, 'text');
  });
});

describe('scanAnsi — carriage returns are a redraw, not a new line', () => {
  test('a progress line redrawn in one batch keeps only its last revision', () => {
    assert.equal(scrub('10%\r50%\r100%\n'), '100%\n');
  });

  test('a redraw after a completed line leaves that line alone', () => {
    assert.equal(scrub('done\nstep 1\rstep 2\n'), 'done\nstep 2\n');
  });

  test('CRLF stays a plain line break', () => {
    // The CR rewinds to the line start, but nothing was written since it,
    // so the following LF still terminates the line.
    assert.equal(scrub('a\r\nb\r\n'), 'a\nb\n');
  });

  test('every pty line arrives as CRLF and none of them get wiped', () => {
    // The regression this guards: a pty in canonical mode has ONLCR on, so
    // it translates the child's every `\n` into `\r\n`. Treating that CR
    // as a redraw erased each line as it completed — the whole output came
    // out as blank lines. Caught here, not by reading the code.
    assert.equal(
      scrub('==> Architect\r\n==> Dev\r\n==> Review\r\n'),
      '==> Architect\n==> Dev\n==> Review\n'
    );
  });

  test('a batch ending on CR defers the decision to the next batch', () => {
    // The CR is the last byte the engine coalesced; whether it terminated
    // the line or starts a redraw is not knowable yet.
    const first = scanAnsi(b('50%\r'), 'text');
    assert.equal(text(first.bytes), '50%');
    assert.equal(first.mode, 'cr');

    // Continuing with LF: it was a line terminator, and 50% stands.
    const asNewline = scanAnsi(b('\ndone\n'), first.mode);
    assert.equal(text(asNewline.bytes), '\ndone\n');

    // Continuing with anything else: it was a redraw of that line.
    const asRedraw = scanAnsi(b('90%\n'), first.mode);
    assert.equal(text(asRedraw.bytes), '90%\n');
    assert.equal(asRedraw.lineReset, true);
  });

  test('lineReset is set when the redrawn line began in an earlier batch', () => {
    // This is the signal the caller needs: the line being overwritten is
    // already in the scrollback, so appending alone would stack both
    // revisions.
    const scan = scanAnsi(b('\r100%'), 'text');
    assert.equal(scan.lineReset, true);
    assert.equal(text(scan.bytes), '100%');
  });

  test('lineReset stays false when the redraw is entirely inside this batch', () => {
    const scan = scanAnsi(b('10%\n50%\r90%'), 'text');
    assert.equal(scan.lineReset, false);
    assert.equal(text(scan.bytes), '10%\n90%');
  });
});

describe('dropPartialLine', () => {
  test('keeps everything through the last newline', () => {
    assert.equal(text(dropPartialLine(b('done\nstep 1\n50%'))), 'done\nstep 1\n');
  });

  test('a buffer with no newline at all drops entirely — it is all one partial line', () => {
    assert.equal(text(dropPartialLine(b('50%'))), '');
  });

  test('a buffer already ending in a newline is unchanged', () => {
    assert.equal(text(dropPartialLine(b('done\n'))), 'done\n');
  });

  test('empty in, empty out', () => {
    assert.equal(dropPartialLine(b('')).length, 0);
  });
});

describe('the two together — a spinner across batches', () => {
  test('a line redrawn across three events ends up once, after the completed lines', () => {
    // The exact shape the run-detail window handles: append, but drop the
    // trailing partial line first whenever the scan says the redraw
    // reached back into it.
    let scrollback = b('==> Architect\n');
    let mode = 'text';
    for (const chunk of ['thinking |', '\rthinking /', '\rthinking -', '\rdone\n']) {
      const scan = scanAnsi(b(chunk), mode);
      mode = scan.mode;
      const base = scan.lineReset ? dropPartialLine(scrollback) : scrollback;
      const merged = new Uint8Array(base.length + scan.bytes.length);
      merged.set(base, 0);
      merged.set(scan.bytes, base.length);
      scrollback = merged;
    }
    assert.equal(text(scrollback), '==> Architect\ndone\n');
  });
});
