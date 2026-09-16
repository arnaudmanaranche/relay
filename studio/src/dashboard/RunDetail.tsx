import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ActiveRun, TimelineRow } from './types';
import {
  fetchArtifact,
  fetchLog,
  fetchTimeline,
  openInEditor,
  retryRun,
  revealInFinder,
  stopRun,
  submitAnswer,
} from './api';
import { STATE_BADGES } from './format';
import { useToast } from '../toast';

interface Props {
  run: ActiveRun;
  onClose: () => void;
  onChanged: () => void;
}

export function RunDetail({ run, onClose, onChanged }: Props) {
  const toast = useToast();
  const [timeline, setTimeline] = useState<{ rows: TimelineRow[]; totalCostText: string; totalTokens: number } | null>(
    null
  );
  const [artifact, setArtifact] = useState<string>('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetchTimeline(run.artifactsDir).then(setTimeline);
    const fileIndex = run.state === 'design-gate' ? 0 : run.state === 'blocked-pm-questions' ? 1 : run.state === 'blocked-dev-review' ? 2 : null;
    if (fileIndex !== null) {
      fetchArtifact(run.artifactsDir, fileIndex).then(res => setArtifact(res.content));
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [run.artifactsDir, run.state]);

  useEffect(() => {
    if (!logPath) return;
    const poll = () => fetchLog(logPath).then(res => setLog(res.content));
    poll();
    pollRef.current = window.setInterval(poll, 1200);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [logPath]);

  async function run_(fn: () => Promise<void>, labels: { pending?: string; done?: string } = {}) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (labels.done) toast.show('success', labels.done);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Both: the panel scrolls, so the button that failed is often off
      // screen by the time the answer comes back, and a toast is the only
      // place the message is certain to be seen.
      setError(message);
      toast.show('error', message);
    } finally {
      setBusy(false);
    }
  }

  const canRetry = run.resumeArgs && run.resumeArgs.length > 0;
  const pid = run.livePid ?? run.lock?.pid ?? 0;

  return (
    <div className="run-detail-overlay" onClick={onClose}>
      <div className="run-detail-panel run-detail" onClick={e => e.stopPropagation()}>
        <div className="run-detail-header">
          <h2>{run.slug}</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <section>
          <h3>State</h3>
          <p>
            <span className={`run-badge state-${run.state}`}>{STATE_BADGES[run.state]}</span>
          </p>
          {run.detail && <p className="run-detail-text">{run.detail}</p>}
          {error && <p className="marketplace-error">{error}</p>}
        </section>

        {timeline && timeline.rows.length > 0 && (
          <section>
            <h3>Timeline</h3>
            <table className="timeline-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Verdict</th>
                  <th>Model</th>
                  <th>Cost</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {timeline.rows.map(row => (
                  <tr key={row.seq} style={{ opacity: row.reached ? 1 : 0.4 }}>
                    <td>{row.role}</td>
                    <td>{row.verdict || '—'}</td>
                    <td>{row.model || '—'}</td>
                    <td>{row.costText || '—'}</td>
                    <td>{row.completedAgo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="timeline-total">
              Total: {timeline.totalCostText} · {timeline.totalTokens} tokens
            </p>
          </section>
        )}

        {run.state === 'design-gate' && (
          <section>
            <h3>Technical plan</h3>
            <div className="artifact-view">
              {artifact ? <ReactMarkdown>{artifact}</ReactMarkdown> : <p>Loading…</p>}
            </div>
            <div style={{ marginTop: '0.8rem' }}>
              <button
                className="btn primary"
                disabled={busy || !canRetry}
                onClick={() =>
                  run_(async () => {
                    const { logPath } = await retryRun(run.repoRoot, run.resumeArgs!);
                    setLogPath(logPath);
                    onChanged();
                  }, { done: `Design approved — ${run.slug} is running.` })
                }
              >
                Approve
              </button>
            </div>
          </section>
        )}

        {(run.state === 'blocked-pm-questions' || run.state === 'blocked-dev-review') && (
          <section className="answer-box">
            <h3>Blocking question</h3>
            <div className="artifact-view">
              {artifact ? <ReactMarkdown>{artifact}</ReactMarkdown> : <p>Loading…</p>}
            </div>
            <textarea
              placeholder="Your answer…"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              style={{ marginTop: '0.8rem' }}
            />
            <button
              className="btn primary"
              disabled={busy || !answer.trim()}
              onClick={() =>
                run_(async () => {
                  const { resumeArgs } = await submitAnswer(
                    run.artifactsDir,
                    answer,
                    run.state === 'blocked-dev-review',
                    run.repoRoot,
                    run.slug
                  );
                  const { logPath } = await retryRun(run.repoRoot, resumeArgs);
                  setLogPath(logPath);
                  setAnswer('');
                  onChanged();
                }, { done: `Answer saved — ${run.slug} is running.` })
              }
            >
              Answer and resume
            </button>
          </section>
        )}

        {['failed-typecheck', 'failed-review', 'failed-qa', 'halted', 'crashed'].includes(run.state) && canRetry && (
          <section>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                run_(async () => {
                  const { logPath } = await retryRun(run.repoRoot, run.resumeArgs!);
                  setLogPath(logPath);
                  onChanged();
                }, { done: `${run.slug} is running.` })
              }
            >
              Retry
            </button>
          </section>
        )}

        {pid > 0 && (
          <section>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                run_(async () => {
                  await stopRun(pid);
                  onChanged();
                }, { done: `Sent SIGTERM to ${run.slug}.` })
              }
            >
              Stop (pid {pid})
            </button>
          </section>
        )}

        {log && (
          <section>
            <h3>Log</h3>
            <div className="log-view">{log}</div>
          </section>
        )}

        <section>
          <h3>Worktree</h3>
          <p className="run-detail-text">{run.worktree}</p>
          <div className="run-actions">
            <button className="btn" onClick={() => run_(() => revealInFinder(run.worktree))}>
              Reveal in Finder
            </button>
            <button className="btn" onClick={() => run_(() => openInEditor(run.worktree))}>
              Open in editor
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
