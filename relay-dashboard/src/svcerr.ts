// Making a service failure readable.
//
// A service's boundary throw (`{ kind, message }`) reaches the core's `err`
// arm as UTF-8 JSON bytes — that is the documented contract, not an
// accident. Displayed verbatim, a missing worktree reads as
//
//   {"kind":"path_missing","message":"/Users/…/worktrees/x does not exist."}
//
// in the status bar, which is how this file came to exist. The core can't
// call JSON.parse (banned in the subset, and rightly — it would need a JS
// heap), but it doesn't need to: pulling one known string field out of a
// known shape is a bounded byte scan, the same kind of work as ansi.ts.
//
// The rule that matters most here is the fallback. Not every `err` arm
// carries JSON: engine-level failures (`cancelled`, `rejected`,
// `spawn_failed`, `io_failed`) arrive as bare reason words, and a future
// error family could arrive as something else again. So anything this
// scanner does not recognize is returned UNCHANGED. Showing a raw blob is
// bad; swallowing an error nobody can then explain is worse.

// "message" as bytes, the single source of truth for both the compare and
// the offset arithmetic. Not a string: `.length` on one counts UTF-16 code
// units, which the subset bans outright (NS1004) precisely because it
// would read differently under node and native.
const MESSAGE_KEY = [0x6d, 0x65, 0x73, 0x73, 0x61, 0x67, 0x65];

/// Reads `message` out of a service error's JSON bytes. Returns the input
/// unchanged when it isn't a `{ … "message": "…" … }` shape — a bare engine
/// reason word passes straight through.
export function serviceErrorText(raw: Uint8Array): Uint8Array {
  const start = messageValueStart(raw);
  if (start < 0) return raw;

  // Pass one: measure. The value can only shrink (escapes are two bytes in
  // and one out, `\uXXXX` six in and none), so the remaining input length
  // is a safe bound.
  let n = 0;
  let i = start;
  while (i < raw.length) {
    const b = raw[i];
    if (b === 0x22) break; // the closing quote
    if (b === 0x5c) {
      // A backslash escape.
      if (i + 1 >= raw.length) break;
      const e = raw[i + 1];
      if (e === 0x75) {
        // \uXXXX — a control character, since JSON.stringify leaves
        // ordinary non-ASCII text alone. Nothing worth putting in a
        // status bar, so it is dropped rather than half-decoded.
        i = i + 6;
        continue;
      }
      n = n + 1;
      i = i + 2;
      continue;
    }
    n = n + 1;
    i = i + 1;
  }
  // An unterminated value means this wasn't the shape we thought it was.
  if (i >= raw.length || raw[i] !== 0x22) return raw;
  if (n === 0) return raw;

  // Pass two: unescape into the exact-size buffer.
  const out = new Uint8Array(n);
  let w = 0;
  let j = start;
  while (j < raw.length) {
    const b = raw[j];
    if (b === 0x22) break;
    if (b === 0x5c) {
      if (j + 1 >= raw.length) break;
      const e = raw[j + 1];
      if (e === 0x75) {
        j = j + 6;
        continue;
      }
      out[w] = unescapeByte(e);
      w = w + 1;
      j = j + 2;
      continue;
    }
    out[w] = b;
    w = w + 1;
    j = j + 1;
  }
  return out;
}

/// The two-character JSON escapes. Anything else after a backslash is not
/// valid JSON; passing the byte through keeps a malformed message readable
/// instead of turning it into a mystery.
function unescapeByte(e: number): number {
  if (e === 0x6e) return 0x0a; // \n
  if (e === 0x74) return 0x09; // \t
  if (e === 0x72) return 0x0d; // \r
  if (e === 0x62) return 0x20; // \b -> a space; a backspace can't render
  if (e === 0x66) return 0x0a; // \f -> a newline, its nearest meaning
  return e; // \" \\ \/ and anything unexpected
}

/// Index of the first byte of `message`'s value, or -1. Tolerates the
/// whitespace a pretty-printer would add even though the runtime's encoder
/// emits none.
function messageValueStart(raw: Uint8Array): number {
  const keyLen = MESSAGE_KEY.length;
  // The key, its quotes, the colon and one opening quote: below that there
  // is nothing to find.
  for (let i = 0; i + keyLen + 4 <= raw.length; i++) {
    if (raw[i] !== 0x22) continue;
    if (!matchesKeyAt(raw, i + 1)) continue;
    let k = i + 1 + keyLen;
    if (k >= raw.length || raw[k] !== 0x22) continue;
    k = skipSpaces(raw, k + 1);
    if (k >= raw.length || raw[k] !== 0x3a) continue; // ':'
    k = skipSpaces(raw, k + 1);
    if (k >= raw.length || raw[k] !== 0x22) continue;
    return k + 1;
  }
  return -1;
}

function matchesKeyAt(raw: Uint8Array, at: number): boolean {
  if (at + MESSAGE_KEY.length > raw.length) return false;
  for (const [offset, want] of MESSAGE_KEY.entries()) {
    if (raw[at + offset] !== want) return false;
  }
  return true;
}

function skipSpaces(raw: Uint8Array, from: number): number {
  let i = from;
  while (i < raw.length) {
    const b = raw[i];
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) break;
    i = i + 1;
  }
  return i;
}
