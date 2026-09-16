import { useState } from 'react';
import { startRun } from './api';
import { useToast } from '../toast';

interface Props {
  repos: { root: string; name: string }[];
  onClose: () => void;
  onStarted: () => void;
}

export function NewRunSheet({ repos, onClose, onStarted }: Props) {
  const toast = useToast();
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
      // A started run takes a while to show up in the poll, so without this
      // the sheet just closes and nothing appears to have happened.
      toast.show('success', `${slug} started — it will appear once the first role reports.`);
      onStarted();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.show('error', message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="run-detail-overlay" onClick={onClose}>
      <div className="run-detail-panel" onClick={e => e.stopPropagation()}>
        <div className="run-detail-header">
          <h2>New feature</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="new-run-form">
          <div>
            <h3>Repository</h3>
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
            placeholder="Slug (e.g. dark-mode)"
            value={slug}
            onChange={e => setSlug(e.target.value)}
          />
          <textarea
            placeholder="Describe the feature — this is the issue the PM reads…"
            value={issueText}
            onChange={e => setIssueText(e.target.value)}
          />
          {error && <p className="marketplace-error">{error}</p>}
          <button
            className="btn primary"
            disabled={submitting || !repoRoot || !slug.trim() || !issueText.trim()}
            onClick={handleSubmit}
          >
            {submitting ? 'Starting…' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}
