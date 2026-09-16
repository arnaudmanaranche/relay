import { useState } from 'react';
import type { MarketplaceSkillEntry } from '../types';
import { fetchMarketplaceSkills, importMarketplaceSkill } from '../api';
import { useToast } from '../toast';

interface Props {
  onImported: () => Promise<void>;
}

export function MarketplaceImport({ onImported }: Props) {
  const toast = useToast();
  const [repo, setRepo] = useState('');
  const [results, setResults] = useState<MarketplaceSkillEntry[] | null>(null);
  const [importingPath, setImportingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    if (!repo.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await fetchMarketplaceSkills(repo.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(entry: MarketplaceSkillEntry) {
    setImportingPath(entry.path);
    setError(null);
    try {
      const imported = await importMarketplaceSkill(repo.trim(), entry.path);
      await onImported();
      toast.show('success', `Imported ${entry.name} to ${imported.path}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.show('error', message);
    } finally {
      setImportingPath(null);
    }
  }

  return (
    <div className="marketplace">
      <h2>Import from GitHub</h2>
      <p className="marketplace-hint">
        Search a public repo that follows the <code>.claude-plugin/marketplace.json</code> convention (e.g.
        <code> arnaudmanaranche/relay</code>). There is no live Claude marketplace to query &mdash; this reads
        that repo&rsquo;s own manifest.
      </p>
      <div className="marketplace-search">
        <input
          type="text"
          placeholder="owner/repo"
          value={repo}
          onChange={e => setRepo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button className="btn" onClick={handleSearch} disabled={loading || !repo.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error && <p className="marketplace-error">{error}</p>}
      {results && (
        <div className="marketplace-results">
          {results.length === 0 && <p className="empty-hint">No skill found in that repo.</p>}
          {results.map(entry => (
            <div className="marketplace-result" key={entry.path}>
              <span className="marketplace-result-text">
                <span className="skill-id">{entry.name}</span>
                <span className="skill-description">{entry.path}</span>
              </span>
              <button
                className="btn"
                onClick={() => handleImport(entry)}
                disabled={importingPath === entry.path}
              >
                {importingPath === entry.path ? 'Importing…' : 'Import'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
