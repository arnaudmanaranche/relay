import { useEffect, useState } from 'react';
import {
  copyStarterIntoProject,
  createSkill,
  fetchFile,
  fetchRoles,
  fetchSkills,
  fetchStarter,
  isStarterRef,
  patchRole,
  saveFile,
  setRoleSkills,
} from './api';
import type { RolePatch, RoleSummary, SkillEntry } from './types';
import { RoleList } from './components/RoleList';
import { FileEditor } from './components/FileEditor';
import { AttachedSkills } from './components/AttachedSkills';
import { SkillLibrary } from './components/SkillLibrary';
import { RoleSettings } from './components/RoleSettings';
import { TypeSkills } from './components/TypeSkills';
import { LogoMark } from './lib/iso';
import { Dashboard } from './dashboard/Dashboard';
import { fetchDashboardConfig } from './dashboard/api';
import { applyTheme } from './theme';

type Selection = { kind: 'role'; name: string } | { kind: 'skill'; path: string } | null;
type Tab = 'roles' | 'skills' | 'pipeline';

export function App() {
  const [tab, setTab] = useState<Tab>('roles');
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function reload() {
    try {
      const [r, s] = await Promise.all([fetchRoles(), fetchSkills()]);
      setRoles(r);
      setSkills(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    reload();
    // The appearance choice is stored with the dashboard config, but it
    // styles the whole of Studio, so it is applied here rather than only
    // while the settings sheet is open.
    fetchDashboardConfig()
      .then(cfg => applyTheme(cfg.theme))
      .catch(() => applyTheme('system'));
  }, []);

  const selectedRole = selection?.kind === 'role' ? roles.find(r => r.name === selection.name) ?? null : null;
  const selectedSkill = selection?.kind === 'skill' ? skills.find(s => s.path === selection.path) ?? null : null;

  async function updateRoleSkills(role: RoleSummary, extraSkills: string[]) {
    await setRoleSkills(role.name, extraSkills);
    await reload();
  }

  async function updateRole(role: RoleSummary, patch: RolePatch) {
    await patchRole(role.name, patch);
    await reload();
  }

  // A template is read-only and lives outside the project; copying it in is
  // what makes it editable and attachable, and the copy is what the pipeline
  // will actually read.
  async function useTemplate(skill: SkillEntry) {
    setCopying(true);
    setCopyError(null);
    try {
      const copy = await copyStarterIntoProject(skill.path);
      await reload();
      setSelection({ kind: 'skill', path: copy.path });
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopying(false);
    }
  }

  function skillEditor(skill: SkillEntry) {
    if (isStarterRef(skill.path)) {
      return (
        <FileEditor
          key={skill.path}
          title={skill.id}
          subtitle="A template shipped with Relay, read-only. Copy it into the project to edit it and attach it to a role."
          load={() => fetchStarter(skill.path)}
          readOnlyAction={
            <button className="btn primary" disabled={copying} onClick={() => useTemplate(skill)}>
              {copying ? 'Copying…' : 'Copy into project'}
            </button>
          }
        />
      );
    }
    return (
      <FileEditor
        key={skill.path}
        title={skill.id}
        subtitle={skill.path}
        load={() => fetchFile(skill.path)}
        onSave={(content, version) => saveFile(skill.path, content, version)}
      />
    );
  }

  const library = (
    <SkillLibrary
      skills={skills}
      attachedPaths={selectedRole?.extraSkills ?? []}
      selectedPath={selectedSkill?.path ?? null}
      onSelect={path => {
        setCopyError(null);
        setSelection({ kind: 'skill', path });
      }}
      onReload={reload}
      onCreate={async (name, description) => {
        await createSkill(name, description);
        await reload();
      }}
    />
  );

  if (error) {
    return (
      <div className="error-banner">
        <p>{error}</p>
        <p>
          Studio has to be started from the root of a project where <code>/relay:setup</code> has already
          run &mdash; it expects a <code>.relay/agents.json</code> there.
        </p>
      </div>
    );
  }

  return (
    <div className="studio-shell">
      <header className="studio-tabs">
        <span className="brand">
          <LogoMark u={7} />
          Relay Studio
        </span>
        <nav>
          <button className={tab === 'roles' ? 'tab active' : 'tab'} onClick={() => setTab('roles')}>
            Roles
          </button>
          <button className={tab === 'skills' ? 'tab active' : 'tab'} onClick={() => setTab('skills')}>
            Skills
          </button>
          <button className={tab === 'pipeline' ? 'tab active' : 'tab'} onClick={() => setTab('pipeline')}>
            Pipeline
          </button>
        </nav>
      </header>

      {tab === 'pipeline' ? (
        <Dashboard />
      ) : tab === 'skills' ? (
        <div className="studio-layout studio-layout-2col">
          <main className="studio-column studio-main">
            {copyError && <p className="editor-error">{copyError}</p>}
            {selectedSkill ? skillEditor(selectedSkill) : <p className="empty-hint">Pick a skill to edit.</p>}
          </main>
          <aside className="studio-column">{library}</aside>
        </div>
      ) : (
        <div className="studio-layout">
          <aside className="studio-column">
            <RoleList
              roles={roles}
              selected={selectedRole?.name ?? null}
              onSelect={name => setSelection({ kind: 'role', name })}
            />
          </aside>

          <main className="studio-column studio-main">
            {copyError && <p className="editor-error">{copyError}</p>}
            {selectedRole ? (
              <FileEditor
                key={`role:${selectedRole.name}`}
                title={selectedRole.name}
                subtitle={selectedRole.skill}
                load={() => fetchFile(selectedRole.skill)}
                onSave={(content, version) => saveFile(selectedRole.skill, content, version)}
              >
                <AttachedSkills
                  role={selectedRole}
                  skills={skills}
                  onDetachSkill={path =>
                    updateRoleSkills(selectedRole, selectedRole.extraSkills.filter(p => p !== path))
                  }
                  onDropSkill={path => {
                    if (selectedRole.extraSkills.includes(path)) return;
                    updateRoleSkills(selectedRole, [...selectedRole.extraSkills, path]);
                  }}
                />
                {selectedRole.name === 'dev' && (
                  <TypeSkills
                    role={selectedRole}
                    skills={skills}
                    onChange={next => updateRole(selectedRole, { typeSkills: next })}
                  />
                )}
                <RoleSettings role={selectedRole} onSave={patch => updateRole(selectedRole, patch)} />
              </FileEditor>
            ) : selectedSkill ? (
              skillEditor(selectedSkill)
            ) : (
              <p className="empty-hint">Pick a role or a skill to edit.</p>
            )}
          </main>

          <aside className="studio-column">{library}</aside>
        </div>
      )}
    </div>
  );
}
