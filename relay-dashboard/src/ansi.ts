// Turning raw pty output into something a text widget can show.
//
// Cmd.ptySpawn delivers exactly what the child wrote — escape sequences
// included — and the markup vocabulary has no terminal widget. So the core
// scrubs the control bytes itself. This is byte work, not text work, which
// is why it belongs in the app-core subset (no regexes there, and none
// needed: a VT escape is a two-state prefix, not a pattern).
//
// Two things are handled, and nothing else is emulated. There is no cursor,
// no scroll region, no color:
//
//   - Escape sequences are dropped. CSI (`ESC [ … final`), OSC
//     (`ESC ] … BEL` or `ESC ] … ESC \`), and the two-byte forms.
//   - A carriage return rewinds to the start of the current line, because
//     that is what the child means by it: run-pipeline.sh's spinners and
//     progress counters redraw one line over and over, and keeping every
//     revision would turn a 3-second stage into hundreds of near-identical
//     lines of scrollback.
//
//     EXCEPT before a newline. A pty in canonical mode has ONLCR on, so it
//     translates every `\n` the child writes into `\r\n` on the way out —
//     which means CRLF is not a redraw, it is how ordinary lines arrive.
//     Rewinding on the CR there wipes the line that just finished, every
//     line, which is what the first version of this file did (caught by
//     test/ansi.test.mjs, not by reading it). So a CR is deferred: what
//     the NEXT byte is decides whether it terminated a line or began a
//     redraw of it.
//
// The scan is resumable: a sequence can be split across two output events
// (the engine coalesces batches on its own schedule, not on sequence
// boundaries), so the caller threads `mode` from one call into the next.

/// Scan state, carried across output events. A string-literal union, not a
/// number: this is held in the Model between dispatches, and an integer
/// model slot needs a wholeness proof the scan's own arithmetic can't give
/// it (SC4022). Tags need no proof, and read better at the call site.
///   "text"    — ordinary output
///   "esc"     — saw ESC; the next byte picks the sequence family
///   "csi"     — inside `ESC [ … ` — drop until a final byte in 0x40..0x7E
///   "osc"     — inside `ESC ] … ` — drop until BEL, or ESC (then `\`)
///   "osc_esc" — an OSC that just saw ESC: the `\` of the ST terminator
///   "cr"      — saw CR, waiting to find out what it meant (see below)
export type AnsiMode = "text" | "esc" | "csi" | "osc" | "osc_esc" | "cr";

export interface AnsiScan {
  /// The printable bytes, newlines and tabs kept.
  readonly bytes: Uint8Array;
  /// Scan state to pass into the next call.
  readonly mode: AnsiMode;
  /// A carriage return rewound past the start of THIS batch, so the line
  /// being redrawn began in whatever the caller already has. The caller
  /// must drop its own trailing partial line before appending — otherwise
  /// the redraw stacks under the line it was meant to replace.
  readonly lineReset: boolean;
}

export function scanAnsi(input: Uint8Array, mode: AnsiMode): AnsiScan {
  // Output can only ever be shorter than input (every branch either keeps
  // one byte or drops it), so one input-sized buffer needs no growth.
  const out = new Uint8Array(input.length);
  let n = 0;
  let lineStart = 0;
  let lineReset = false;
  let m = mode;

  for (const b of input) {
    if (m === "cr") {
      // CRLF: the CR was part of a line terminator (ONLCR), so the line
      // stands and the LF below ends it.
      if (b === 0x0a) {
        out[n] = b;
        n = n + 1;
        lineStart = n;
        m = "text";
        continue;
      }
      // A real redraw. No newline emitted yet in this batch means the line
      // being overwritten started before it — tell the caller.
      if (lineStart === 0) lineReset = true;
      n = lineStart;
      m = "text";
      // Deliberately NOT `continue`: this byte is the first of the
      // replacement line and still has to be processed below.
    }
    if (m === "esc") {
      if (b === 0x5b) {
        m = "csi";
        continue;
      }
      if (b === 0x5d) {
        m = "osc";
        continue;
      }
      // A two-byte escape (ESC c, ESC M, ESC 7, …): this byte is its
      // final one, so drop it with the ESC.
      m = "text";
      continue;
    }
    if (m === "csi") {
      if (b >= 0x40 && b <= 0x7e) m = "text";
      continue;
    }
    if (m === "osc") {
      if (b === 0x07) m = "text";
      else if (b === 0x1b) m = "osc_esc";
      continue;
    }
    if (m === "osc_esc") {
      // `ESC \` ends the string. Anything else here is a malformed OSC —
      // end it anyway rather than swallowing the rest of the output.
      m = "text";
      continue;
    }
    if (b === 0x1b) {
      m = "esc";
      continue;
    }
    if (b === 0x0d) {
      // Deferred — the next byte says whether this ended a line or began
      // a redraw of it.
      m = "cr";
      continue;
    }
    if (b === 0x0a) {
      out[n] = b;
      n = n + 1;
      lineStart = n;
      continue;
    }
    if (b === 0x09) {
      out[n] = b;
      n = n + 1;
      continue;
    }
    // Every other C0 control and DEL: backspace, bell, form feed, the
    // vertical tabs. None of them mean anything without a cursor.
    if (b < 0x20 || b === 0x7f) continue;
    out[n] = b;
    n = n + 1;
  }

  return { bytes: out.slice(0, n), mode: m, lineReset };
}

/// Drops the trailing partial line — everything after the last newline.
/// Pair with a scan whose `lineReset` is set.
export function dropPartialLine(content: Uint8Array): Uint8Array {
  // A backward scan spelled out: `lastIndexOf` typechecks but has no
  // scriptc lowering yet (SC2020), and the loop is the same one byte pass.
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i] === 0x0a) return content.slice(0, i + 1);
  }
  return new Uint8Array(0);
}
