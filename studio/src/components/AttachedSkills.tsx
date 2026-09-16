import { useState } from 'react';
import type { RoleSummary, SkillEntry } from '../types';

type DropState = 'idle' | 'over' | 'rejected';

interface Props {
  role: RoleSummary;
  skills: SkillEntry[];
  onDetachSkill: (path: string) => void;
  onDropSkill: (path: string) => void;
}

export function AttachedSkills({ role, skills, onDetachSkill, onDropSkill }: Props) {
  const [dropState, setDropState] = useState<DropState>('idle');
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  const skillByPath = new Map(skills.map(s => [s.path, s]));

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const path = e.dataTransfer.getData('text/relay-skill-path');
    if (!path) return;
    // Templates are not files in this project, so the pipeline could never
    // read one. SkillCard already refuses to drag them; this is the backstop.
    if (path.startsWith('starter:')) {
      setDropState('rejected');
      setDropMessage('Copy this template into the project first, then attach the copy.');
      setTimeout(() => setDropState('idle'), 2000);
      return;
    }
    if (role.extraSkills.includes(path)) {
      setDropState('rejected');
      setDropMessage(`“${skillByPath.get(path)?.id ?? path}” is already attached to this role.`);
      setTimeout(() => setDropState('idle'), 1200);
      return;
    }
    setDropState('idle');
    setDropMessage(null);
    onDropSkill(path);
  }

  return (
    <div
      className={
        dropState === 'idle' ? 'attached-skills' : `attached-skills drag-${dropState === 'over' ? 'over' : 'rejected'}`
      }
      onDragOver={e => {
        e.preventDefault();
        if (dropState !== 'rejected') setDropState('over');
      }}
      onDragLeave={() => dropState === 'over' && setDropState('idle')}
      onDrop={handleDrop}
    >
      <h3>Attached skills</h3>
      {role.extraSkills.length === 0 ? (
        <p className="empty-hint">Drag a skill from the library to attach it to this role.</p>
      ) : (
        <ul>
          {role.extraSkills.map(path => (
            <li key={path}>
              <span>{skillByPath.get(path)?.id ?? path}</span>
              <button className="btn" onClick={() => onDetachSkill(path)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {dropMessage && <p className="drop-message">{dropMessage}</p>}
    </div>
  );
}
