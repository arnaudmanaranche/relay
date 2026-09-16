import { useState } from 'react';
import { startRun } from './api';

interface Props {
  repos: { root: string; name: string }[];
  onClose: () => void;
  onStarted: () => void;
}

export function NewRunSheet({ repos, onClose, onStarted }: Props) {
  const [repoRoot, setRepoRoot] = useState(repos[0]?.root ?? '');
  const [slug, setSlug] = useState('');
  const [issueText, setIssueText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await startRun(repoRoot, slug, issueText);
      onStarted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="run-detail-overlay" onClick={onClose}>
      <div className="run-detail-panel" onClick={e => e.stopPropagation()}>
        <div className="run-detail-header">
          <h2>Nouvelle feature</h2>
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
        </div>
        <div className="new-run-form">
          <div>
            <h3>Dépôt</h3>
            <div className="repo-picker">
              {repos.map(repo => (
                <button
                  key={repo.root}
                  className={repo.root === repoRoot ? 'btn selected' : 'btn'}
                  onClick={() => setRepoRoot(repo.root)}
                >
                  {repo.name}
                </button>
              ))}
            </div>
          </div>
          <input
            type="text"
            placeholder="Slug (ex. dark-mode)"
            value={slug}
            onChange={e => setSlug(e.target.value)}
          />
          <textarea
            placeholder="Décris la feature (ce sera l'issue passée au PM)…"
            value={issueText}
            onChange={e => setIssueText(e.target.value)}
          />
          {error && <p className="marketplace-error">{error}</p>}
          <button
            className="btn primary"
            disabled={submitting || !repoRoot || !slug.trim() || !issueText.trim()}
            onClick={handleSubmit}
          >
            {submitting ? 'Démarrage…' : 'Démarrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
