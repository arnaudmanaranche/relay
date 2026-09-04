import { useRef, useState } from 'react';

/** execCommand is deprecated but still the only fallback when the async
 *  clipboard API is unavailable or refuses (permissions, insecure origin). */
function legacyCopy(text: string) {
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
  return ok;
}

export function CopyButton({ text, label = 'Copy', className = 'copy' }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<number>();

  function flash(ok: boolean) {
    setState(ok ? 'done' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1600);
  }

  function onClick() {
    const fallback = () => flash(legacyCopy(text));
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => flash(true), fallback);
    } else {
      fallback();
    }
  }

  return (
    <button
      type="button"
      className={className + (state === 'idle' ? '' : ` ${state}`)}
      onClick={onClick}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
