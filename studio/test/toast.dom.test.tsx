// Toasts exist because actions were failing in silence: the Resume button on a
// run row did `retryRun(...).then(poll)` with no catch, so a resume that threw
// looked exactly like one that worked. `track` is the piece that fixes that,
// so most of these are about what it does when the action throws.
import { closeDom } from './setup-dom.ts';
import { test, describe, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast, type ToastApi } from '../src/toast.tsx';

afterEach(cleanup);
after(closeDom);

/** Renders a provider and hands back a driver whose calls are wrapped in
 *  act(): every method here sets state, and React complains (and node:test
 *  bails) when that happens outside act. */
function harness() {
  const box: { api: ToastApi | null } = { api: null };
  function Probe() {
    box.api = useToast();
    return null;
  }
  render(
    <ToastProvider>
      <Probe />
    </ToastProvider>
  );
  return {
    show(kind: Parameters<ToastApi['show']>[0], message: string) {
      let id = 0;
      act(() => {
        id = box.api!.show(kind, message);
      });
      return id;
    },
    dismiss(id: number) {
      act(() => box.api!.dismiss(id));
    },
    track<T>(labels: { pending?: string; done?: string }, run: () => Promise<T>) {
      // Returned un-awaited on purpose: a test needs to assert on the pending
      // toast before the action settles.
      let result!: Promise<T | undefined>;
      act(() => {
        result = box.api!.track(labels, run);
      });
      return result;
    },
  };
}

describe('toasts', () => {
  test('nothing is rendered until something is shown', () => {
    const api = harness();
    assert.equal(document.querySelector('.toaster'), null);
    api.show('info', 'working');
  });

  test('a message appears', async () => {
    const api = harness();
    api.show('success', 'Saved.');
    await screen.findByText('Saved.');
  });

  test('an error is announced as an alert, other kinds as status', async () => {
    const api = harness();
    api.show('error', 'It broke.');
    api.show('success', 'It worked.');
    await waitFor(() => {
      assert.equal(screen.getByText('It broke.').closest('[role]')!.getAttribute('role'), 'alert');
      assert.equal(screen.getByText('It worked.').closest('[role]')!.getAttribute('role'), 'status');
    });
  });

  test('dismiss removes only that one', async () => {
    const api = harness();
    api.show('error', 'first');
    const id = api.show('error', 'second');
    await screen.findByText('second');
    api.dismiss(id);
    await waitFor(() => assert.equal(screen.queryByText('second'), null));
    screen.getByText('first');
  });

  test('the close button dismisses', async () => {
    const api = harness();
    api.show('error', 'close me');
    await screen.findByText('close me');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => assert.equal(screen.queryByText('close me'), null));
  });

  test('errors are not auto-dismissed', async () => {
    // An error that disappears on a timer is an error the user may never read.
    const api = harness();
    api.show('error', 'still here');
    await screen.findByText('still here');
    await new Promise(r => setTimeout(r, 120));
    screen.getByText('still here');
  });
});

describe('track', () => {
  test('shows progress, then the confirmation, and returns the value', async () => {
    const api = harness();
    let release: (v: string) => void = () => {};
    const pending = new Promise<string>(r => (release = r));

    const result = api.track({ pending: 'Resuming…', done: 'Running.' }, () => pending);
    await screen.findByText('Resuming…');

    release('ok');
    assert.equal(await result, 'ok');
    await screen.findByText('Running.');
    // The progress message is replaced, not stacked under the result.
    await waitFor(() => assert.equal(screen.queryByText('Resuming…'), null));
  });

  test('reports what the action threw', async () => {
    const api = harness();
    const result = await api.track({ pending: 'Resuming…', done: 'Running.' }, async () => {
      throw new Error('/path/run-pipeline.sh does not exist.');
    });
    assert.equal(result, undefined, 'a failed action returns undefined, so callers can skip follow-up');
    await screen.findByText('/path/run-pipeline.sh does not exist.');
    assert.equal(screen.queryByText('Running.'), null, 'must not claim success');
    await waitFor(() => assert.equal(screen.queryByText('Resuming…'), null));
  });

  test('a non-Error rejection still produces a message', async () => {
    const api = harness();
    await api.track({}, async () => {
      throw 'plain string';
    });
    await screen.findByText('plain string');
  });

  test('with no labels a success is silent', async () => {
    // Reveal in Finder is its own feedback: the window opens. Only the
    // failure is worth a toast.
    const api = harness();
    await api.track({}, async () => 'done');
    assert.equal(document.querySelector('.toaster'), null);
  });

  test('with no labels a failure still speaks', async () => {
    const api = harness();
    await api.track({}, async () => {
      throw new Error('does not exist.');
    });
    await screen.findByText('does not exist.');
  });

  test('concurrent actions each report', async () => {
    const api = harness();
    await Promise.all([
      api.track({ done: 'one' }, async () => 1),
      api.track({ done: 'two' }, async () => 2),
    ]);
    await screen.findByText('one');
    screen.getByText('two');
  });
});

describe('useToast', () => {
  test('throws outside a provider, rather than silently doing nothing', () => {
    function Orphan() {
      useToast();
      return null;
    }
    assert.throws(() => render(<Orphan />), /ToastProvider/);
  });
});
