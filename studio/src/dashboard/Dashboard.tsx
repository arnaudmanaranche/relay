import { useEffect, useState } from 'react';
import type { ActiveRun, StatusSnapshot } from './types';
import { fetchDashboardStatus, retryRun, revealInFinder } from './api';
import { STATE_BADGES, composeCaption, needsAttention, sortRuns } from './format';
import { RunDetail } from './RunDetail';
import { NewRunSheet } from './NewRunSheet';
import { DashboardSettings } from './DashboardSettings';

const POLL_MS = 5000;

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<ActiveRun | null>(null);
  const [showNewRun, setShowNewRun] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  async function poll() {
    try {
      setSnapshot(await fetchDashboardStatus());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const repos = snapshot?.repos.filter(r => !r.error) ?? [];
  const allActive = repos.flatMap(r => r.active ?? []);
  const running = allActive.filter(r => r.state === 'running').length;
  const attention = allActive.filter(r => needsAttention(r.state)).length;
  const merged = repos.reduce((sum, r) => sum + (r.completed?.length ?? 0), 0);

  return (
    <div className="dashboard">
      <div className="dashboard-toolbar">
        <button className="btn" onClick={() => setShowSettings(true)}>
          Réglages
        </button>
        <button className="btn primary" onClick={() => setShowNewRun(true)} disabled={repos.length === 0}>
          Nouvelle feature
        </button>
      </div>

      {error && <div className="repo-error-banner">{error}</div>}

      {!error && (
        <div className="stat-strip">
          <div className="stat-tile">
            <span className="stat-value">{running}</span>
            <span className="stat-label">en cours</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{attention}</span>
            <span className="stat-label">besoin d'attention</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{merged}</span>
            <span className="stat-label">mergées</span>
          </div>
        </div>
      )}

      {snapshot?.repos.map(repo => (
        <div className="repo-section" key={repo.root}>
          <div className="repo-section-head">
            <span className="repo-name">{repo.name}</span>
            <span className="repo-merged-count">{repo.completed?.length ?? 0} mergées</span>
          </div>

          {repo.error ? (
            <div className="repo-error-banner">{repo.error}</div>
          ) : (
            <>
              <div className="run-list">
                {sortRuns(repo.active ?? []).map(run => (
                  <div className="run-row" key={run.slug} onClick={() => setOpenRun(run)}>
                    <div className="run-row-text">
                      <span className="run-slug">{run.slug}</span>
                      <span className="run-caption">{composeCaption(run)}</span>
                    </div>
                    <span className={`run-badge state-${run.state}`}>{STATE_BADGES[run.state]}</span>
                    <div className="run-actions" onClick={e => e.stopPropagation()}>
                      {run.resumeHint && (
                        <button
                          className="btn"
                          title={run.resumeHint}
                          onClick={() => navigator.clipboard.writeText(run.resumeHint!)}
                        >
                          Copier
                        </button>
                      )}
                      {run.resumeArgs && run.resumeArgs.length > 0 && (
                        <button className="btn" onClick={() => retryRun(run.repoRoot, run.resumeArgs!).then(poll)}>
                          Reprendre
                        </button>
                      )}
                      <button className="btn" onClick={() => revealInFinder(run.worktree)}>
                        Révéler
                      </button>
                    </div>
                  </div>
                ))}
                {(repo.active ?? []).length === 0 && <p className="empty-hint">Aucun run actif.</p>}
              </div>

              {(repo.completed?.length ?? 0) > 0 && (
                <>
                  <span className="merged-list-label">Récemment mergé</span>
                  <ul className="merged-list">
                    {repo.completed!.slice(0, 5).map(c => (
                      <li key={c.slug}>{c.slug}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      ))}

      {snapshot && repos.length === 0 && !error && (
        <p className="empty-hint">Aucun dépôt configuré — ouvre Réglages pour en ajouter un.</p>
      )}

      {openRun && <RunDetail run={openRun} onClose={() => setOpenRun(null)} onChanged={poll} />}
      {showNewRun && (
        <NewRunSheet repos={repos} onClose={() => setShowNewRun(false)} onStarted={poll} />
      )}
      {showSettings && <DashboardSettings onClose={() => setShowSettings(false)} onSaved={poll} />}
    </div>
  );
}
