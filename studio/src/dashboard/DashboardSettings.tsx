import { useEffect, useState } from 'react';
import { fetchDashboardConfig, saveDashboardConfig } from './api';
import { applyTheme } from '../theme';
import { useToast } from '../toast';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function DashboardSettings({ onClose, onSaved }: Props) {
  const toast = useToast();
  const [draftRepos, setDraftRepos] = useState<string[]>([]);
  const [theme, setTheme] = useState('system');
  const [newRepo, setNewRepo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardConfig().then(cfg => {
      setDraftRepos(cfg.repos);
      setTheme(cfg.theme);
      applyTheme(cfg.theme);
    });
  }, []);

  async function handleThemeChange(next: string) {
    setTheme(next);
    // Applied before the write so the press repaints immediately; the config
    // file is the record of the choice, not the thing that renders it.
    applyTheme(next);
    await saveDashboardConfig({ theme: next });
    onSaved();
  }

  async function handleSaveRepos() {
    setSaving(true);
    setError(null);
    try {
      await saveDashboardConfig({ repos: draftRepos });
      toast.show(
        'success',
        draftRepos.length === 1 ? 'Watching 1 repository.' : `Watching ${draftRepos.length} repositories.`
      );
      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.show('error', message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="run-detail-overlay" onClick={onClose}>
      <div className="run-detail-panel dashboard-settings" onClick={e => e.stopPropagation()}>
        <div className="run-detail-header">
          <h2>Settings</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <section>
          <h3>Appearance</h3>
          <div className="theme-toggle">
            {['system', 'light', 'dark'].map(option => (
              <button
                key={option}
                className={option === theme ? 'btn selected' : 'btn'}
                onClick={() => handleThemeChange(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Watched repositories</h3>
          <ul className="repo-draft-list">
            {draftRepos.map((repo, i) => (
              <li key={i}>
                <span>{repo}</span>
                <button className="btn" onClick={() => setDraftRepos(draftRepos.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="/path/to/a/repo"
              value={newRepo}
              onChange={e => setNewRepo(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn"
              onClick={() => {
                if (newRepo.trim()) {
                  setDraftRepos([...draftRepos, newRepo.trim()]);
                  setNewRepo('');
                }
              }}
            >
              Add
            </button>
          </div>
          {error && <p className="marketplace-error">{error}</p>}
          <button className="btn primary" onClick={handleSaveRepos} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </section>
      </div>
    </div>
  );
}
