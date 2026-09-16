/** Copies text, falling back to the deprecated execCommand path.
 *
 *  navigator.clipboard.writeText rejects whenever the document is not focused,
 *  and on an insecure origin, and when permission is refused. Studio is a
 *  local dev tool where all three happen, so a bare writeText meant Copy
 *  silently did nothing. Same fallback the documentation site uses. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:absolute;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  if (!ok) throw new Error('Could not reach the clipboard — copy the command from the run instead.');
}
