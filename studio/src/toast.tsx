import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  show: (kind: ToastKind, message: string) => number;
  dismiss: (id: number) => void;
  /** Runs an action and reports it: `pending` while it is in flight, then
   *  `done`, or whatever it threw. Returns undefined if it threw, so a caller
   *  can skip its follow-up without a catch of its own.
   *
   *  This exists because the alternative kept happening: `retryRun(...)
   *  .then(poll)` with no catch, so a failing resume looked exactly like a
   *  successful one. */
  track: <T>(labels: { pending?: string; done?: string }, run: () => Promise<T>) => Promise<T | undefined>;
}

const ToastContext = createContext<ToastApi | null>(null);

// Errors stay until dismissed: an error that vanishes on a timer is an error
// the user may never have read. Progress and confirmations clear themselves.
const AUTO_DISMISS_MS: Record<ToastKind, number | null> = {
  info: 6000,
  success: 4000,
  error: null,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  useEffect(
    () => () => {
      for (const handle of timers.current.values()) window.clearTimeout(handle);
      timers.current.clear();
    },
    []
  );

  const dismiss = useCallback((id: number) => {
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timers.current.delete(id);
    }
    setToasts(current => current.filter(t => t.id !== id));
  }, []);

  const show = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts(current => [...current, { id, kind, message }]);
      const after = AUTO_DISMISS_MS[kind];
      if (after !== null) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), after)
        );
      }
      return id;
    },
    [dismiss]
  );

  const track = useCallback<ToastApi['track']>(
    async (labels, run) => {
      const pendingId = labels.pending ? show('info', labels.pending) : null;
      try {
        const result = await run();
        if (pendingId !== null) dismiss(pendingId);
        if (labels.done) show('success', labels.done);
        return result;
      } catch (err) {
        if (pendingId !== null) dismiss(pendingId);
        show('error', err instanceof Error ? err.message : String(err));
        return undefined;
      }
    },
    [show, dismiss]
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss, track }), [show, dismiss, track]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a ToastProvider');
  return api;
}

function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          // An error is announced at once; progress and confirmations wait
          // their turn rather than interrupting whatever is being read.
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
