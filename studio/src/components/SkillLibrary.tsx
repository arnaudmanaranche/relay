import { useState } from 'react';
import type { SkillEntry } from '../types';
import { SkillCard } from './SkillCard';
import { MarketplaceImport } from './MarketplaceImport';

interface Props {
  skills: SkillEntry[];
  attachedPaths: string[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Throws on refusal; the caller reports why. */
  onCreate: (name: string, description: string) => Promise<void>;
  onReload: () => Promise<void>;
}

export function SkillLibrary({ skills, attachedPaths, selectedPath, onSelect, onCreate, onReload }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreate(name, description);
      setName('');
      setDescription('');
      setShowForm(false);
    } catch {
      // The caller toasts the reason (a name collision, most often). Keeping
      // the form open with the text in it is the useful part: it used to
      // close as though the skill had been created.
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="skill-library-header">
        <h2>Skill library</h2>
        <button className="btn" onClick={() => setShowForm(v => !v)}>
          New skill
        </button>
      </div>

      {showForm && (
        <div className="skill-form">
          <input
            type="text"
            placeholder="Name (e.g. api-error-handling)"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Short description"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <button className="btn primary" onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      )}

      <div className="skill-cards">
        {skills.map(skill => (
          <SkillCard
            key={skill.path}
            skill={skill}
            attached={attachedPaths.includes(skill.path)}
            selected={skill.path === selectedPath}
            onSelect={() => onSelect(skill.path)}
          />
        ))}
      </div>

      <MarketplaceImport onImported={onReload} />
    </div>
  );
}
