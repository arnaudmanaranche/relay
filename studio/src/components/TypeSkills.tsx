import { useState } from 'react';
import type { RoleSummary, SkillEntry } from '../types';

interface Props {
  role: RoleSummary;
  skills: SkillEntry[];
  onChange: (next: Record<string, string>) => Promise<void>;
}

// Dev only. Unlike extraSkills, which every role injects unconditionally, a
// typeSkills entry only fires when a touched file matches its pattern — which
// is why it exists for the one role that has an impacted-files list.
export function TypeSkills({ role, skills, onChange }: Props) {
  const entries = Object.entries(role.typeSkills ?? {});
  const projectSkills = skills.filter(s => s.source === 'project');
  const [pattern, setPattern] = useState('');
  const [path, setPath] = useState(projectSkills[0]?.path ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      await onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="type-skills">
      <h3>Skills par type de fichier</h3>
      <p className="empty-hint">
        Injectée seulement quand un fichier touché correspond au motif. Propre au rôle Dev.
      </p>

      {entries.length > 0 && (
        <ul className="type-skills-list">
          {entries.map(([p, value]) => (
            <li key={p}>
              <code>{p}</code>
              <span className="type-skills-arrow">→</span>
              <span className="type-skills-path">{value}</span>
              <button
                className="btn"
                disabled={busy}
                onClick={() => apply(Object.fromEntries(entries.filter(([k]) => k !== p)))}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}

      {projectSkills.length === 0 ? (
        <p className="empty-hint">
          Aucune skill de projet à associer — crées-en une, ou copie un modèle dans le projet.
        </p>
      ) : (
        <div className="type-skills-add">
          <input
            type="text"
            placeholder="*.tsx"
            value={pattern}
            spellCheck={false}
            onChange={e => setPattern(e.target.value)}
          />
          <select value={path} onChange={e => setPath(e.target.value)}>
            {projectSkills.map(s => (
              <option key={s.path} value={s.path}>
                {s.id}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={busy || !pattern.trim() || !path}
            onClick={async () => {
              await apply({ ...Object.fromEntries(entries), [pattern.trim()]: path });
              setPattern('');
            }}
          >
            Associer
          </button>
        </div>
      )}
      {error && <p className="editor-error">{error}</p>}
    </div>
  );
}
