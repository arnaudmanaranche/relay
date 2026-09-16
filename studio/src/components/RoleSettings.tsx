import { useEffect, useState } from 'react';
import { EFFORT_LEVELS, type RolePatch, type RoleSummary } from '../types';

interface Props {
  role: RoleSummary;
  onSave: (patch: RolePatch) => Promise<void>;
}

// The registry fields that are worth changing per role. `skill`, `artifact`
// and `description` are structural — agent-runner.ts keys behaviour off the
// role name and expects those to stay put — so they are shown as context
// rather than offered as inputs.
export function RoleSettings({ role, onSave }: Props) {
  const [model, setModel] = useState(role.model);
  const [maxTokens, setMaxTokens] = useState(String(role.maxTokens));
  const [effort, setEffort] = useState(role.effort ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModel(role.model);
    setMaxTokens(String(role.maxTokens));
    setEffort(role.effort ?? '');
    setError(null);
  }, [role.name, role.model, role.maxTokens, role.effort]);

  const dirty =
    model !== role.model || maxTokens !== String(role.maxTokens) || effort !== (role.effort ?? '');

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // `effort` is optional in the registry, so an empty field means "clear
      // it", which the API takes as null rather than a sentinel string.
      await onSave({ model, maxTokens: Number(maxTokens), effort: effort === '' ? null : effort });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="role-settings">
      <h3>Role settings</h3>
      <div className="role-settings-grid">
        <label>
          <span>Model</span>
          <input type="text" value={model} onChange={e => setModel(e.target.value)} spellCheck={false} />
        </label>
        <label>
          <span>Max tokens</span>
          <input
            type="number"
            min={1}
            step={1000}
            value={maxTokens}
            onChange={e => setMaxTokens(e.target.value)}
          />
        </label>
        <label>
          <span>Effort</span>
          <select value={effort} onChange={e => setEffort(e.target.value)}>
            <option value="">(backend default)</option>
            {EFFORT_LEVELS.map(level => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="editor-error">{error}</p>}
      <div className="role-settings-actions">
        <button className="btn primary" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <span className="role-settings-note">
          Written to <code>.relay/agents.json</code>
        </span>
      </div>
    </div>
  );
}
