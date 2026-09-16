// FileEditor is where Studio can lose your work: it loads a file, you type in
// it, and it writes the whole thing back. Every test here is about a way that
// could go wrong rather than about how it looks.
import { closeDom } from './setup-dom.ts';
import { test, describe, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileEditor } from '../src/components/FileEditor.tsx';
import type { LoadedFile } from '../src/api.ts';

afterEach(cleanup);
after(closeDom);

const file = (content: string, version = 1000): LoadedFile => ({ content, version });

describe('FileEditor', () => {
  test('Save stays disabled until something is typed', async () => {
    render(
      <FileEditor title="dev" subtitle="prompts/dev.md" load={async () => file('hello')} onSave={async () => 1001} />
    );
    const save = await screen.findByRole('button', { name: 'Save' });
    assert.equal((save as HTMLButtonElement).disabled, true);

    await userEvent.type(screen.getByRole('textbox'), '!');
    assert.equal((save as HTMLButtonElement).disabled, false);
  });

  test('a failed load shows the message and leaves the editor empty', async () => {
    // The bug this replaced: an inline fetch swallowed the 404, handed back an
    // empty editor, and a Save then wrote that emptiness over the file.
    render(
      <FileEditor
        title="ghost"
        subtitle=".relay/skills/ghost.md"
        load={async () => {
          throw new Error('File not found');
        }}
        onSave={async () => 1}
      />
    );
    await screen.findByText('File not found');
    assert.equal((screen.getByRole('textbox') as HTMLTextAreaElement).value, '');
  });

  test('a load failure leaves Save unreachable', async () => {
    render(
      <FileEditor
        title="ghost"
        subtitle=".relay/skills/ghost.md"
        load={async () => {
          throw new Error('File not found');
        }}
        onSave={async () => 1}
      />
    );
    await screen.findByText('File not found');
    assert.equal((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled, true);
  });

  test('the version from load is handed back on save', async () => {
    const seen: number[] = [];
    render(
      <FileEditor
        title="dev"
        subtitle="prompts/dev.md"
        load={async () => file('hello', 4242)}
        onSave={async (_content, version) => {
          seen.push(version);
          return 4243;
        }}
      />
    );
    await screen.findByRole('button', { name: 'Save' });
    await userEvent.type(screen.getByRole('textbox'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => assert.deepEqual(seen, [4242]));
  });

  test('a conflict offers a reload instead of resolving itself', async () => {
    // Silently reloading would throw away what was typed, so the choice is the
    // user's; the point of the test is that Save does NOT quietly succeed.
    let version = 1000;
    render(
      <FileEditor
        title="memory"
        subtitle=".relay/project-memory.md"
        load={async () => file(version === 1000 ? 'mine' : 'theirs', version)}
        onSave={async () => {
          version = 2000;
          throw new Error('This file changed on disk since you opened it. Reload to see the new version.');
        }}
      />
    );
    await screen.findByRole('button', { name: 'Save' });
    await userEvent.type(screen.getByRole('textbox'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const reload = await screen.findByRole('button', { name: /Reload/ });
    assert.match(screen.getByText(/changed on disk/).textContent!, /Reload/);
    // The edit is still there until the user decides.
    assert.equal((screen.getByRole('textbox') as HTMLTextAreaElement).value, 'mine!');

    await userEvent.click(reload);
    await waitFor(() =>
      assert.equal((screen.getByRole('textbox') as HTMLTextAreaElement).value, 'theirs')
    );
  });

  test('an ordinary save failure is an error, not a conflict', async () => {
    render(
      <FileEditor
        title="dev"
        subtitle="prompts/dev.md"
        load={async () => file('hello')}
        onSave={async () => {
          throw new Error('Path escapes project root');
        }}
      />
    );
    await screen.findByRole('button', { name: 'Save' });
    await userEvent.type(screen.getByRole('textbox'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Path escapes project root');
    assert.equal(screen.queryByRole('button', { name: /Reload/ }), null);
  });

  test('without onSave the file is read-only and shows the caller’s action', async () => {
    render(
      <FileEditor
        title="code-style"
        subtitle="A template shipped with Relay"
        load={async () => file('# Code style')}
        readOnlyAction={<button>Copy into project</button>}
      />
    );
    await screen.findByRole('button', { name: 'Copy into project' });
    assert.equal(screen.queryByRole('button', { name: 'Save' }), null);
    assert.equal((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly, true);
  });

  test('frontmatter stays in the editor', async () => {
    // The preview drops it; see markdown.test.ts for that half, which is pure
    // and does not need a DOM.
    render(
      <FileEditor
        title="ui"
        subtitle=".relay/skills/ui.md"
        load={async () => file('---\nid: ui\ndescription: UI rules\n---\n\n# Real heading\n')}
        onSave={async () => 1}
      />
    );
    await screen.findByRole('button', { name: 'Save' });
    assert.match((screen.getByRole('textbox') as HTMLTextAreaElement).value, /id: ui/);
  });

  test('switching file reloads rather than showing the previous one', async () => {
    const { rerender } = render(
      <FileEditor title="a" subtitle="a.md" load={async () => file('content of a')} onSave={async () => 1} />
    );
    await waitFor(() =>
      assert.equal((screen.getByRole('textbox') as HTMLTextAreaElement).value, 'content of a')
    );
    rerender(
      <FileEditor title="b" subtitle="b.md" load={async () => file('content of b')} onSave={async () => 1} />
    );
    await waitFor(() =>
      assert.equal((screen.getByRole('textbox') as HTMLTextAreaElement).value, 'content of b')
    );
  });
});
