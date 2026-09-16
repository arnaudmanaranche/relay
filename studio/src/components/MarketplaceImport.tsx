import { useState } from 'react';
import type { MarketplaceSkillEntry } from '../types';
import { fetchMarketplaceSkills, importMarketplaceSkill } from '../api';

interface Props {
  onImported: () => Promise<void>;
}

export function MarketplaceImport({ onImported }: Props) {
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
      await importMarketplaceSkill(repo.trim(), entry.path);
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingPath(null);
    }
  }

  return (
    <div className="marketplace">
      <h2>Importer depuis GitHub</h2>
      <p className="marketplace-hint">
        Cherche un dépôt public qui suit la convention <code>.claude-plugin/marketplace.json</code> (ex.
        <code> arnaudmanaranche/relay</code>). Il n'existe pas de marketplace Claude interrogeable en
        direct — ceci lit le manifeste du dépôt indiqué.
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
          {loading ? 'Recherche…' : 'Chercher'}
        </button>
      </div>
      {error && <p className="marketplace-error">{error}</p>}
      {results && (
        <div className="marketplace-results">
          {results.length === 0 && <p className="empty-hint">Aucune skill trouvée dans ce dépôt.</p>}
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
                {importingPath === entry.path ? 'Import…' : 'Importer'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
