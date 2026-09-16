import { closeDom } from './setup-dom.ts';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../src/clipboard.ts';

after(closeDom);

describe('copyText', () => {
  test('uses the async clipboard when it works', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void written.push(t) },
      configurable: true,
    });
    await copyText('bash run-pipeline.sh slug');
    assert.deepEqual(written, ['bash run-pipeline.sh slug']);
  });

  test('falls back to execCommand when the clipboard rejects', async () => {
    // What actually happens in Studio: writeText rejects with "Document is not
    // focused" whenever the window is not frontmost, and Copy did nothing.
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Document is not focused.');
        },
      },
      configurable: true,
    });
    let selected = '';
    (document as unknown as { execCommand: () => boolean }).execCommand = () => {
      selected = (document.querySelector('textarea[readonly]') as HTMLTextAreaElement)?.value ?? '';
      return true;
    };
    await copyText('fallback path');
    assert.equal(selected, 'fallback path');
    assert.equal(document.querySelector('textarea[readonly]'), null, 'the scratch textarea is removed');
  });

  test('throws something a user can act on when both routes fail', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    await assert.rejects(() => copyText('nope'), /copy the command from the run instead/);
  });
});
