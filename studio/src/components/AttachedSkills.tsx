import { useEffect, useRef, useState } from 'react';
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
  // The rejection state clears itself on a timer. Held in a ref and cancelled
  // on unmount: switching role while a rejection is showing otherwise fires
  // setState on a component that is gone.
  const clearTimer = useRef<number>();
  const skillByPath = new Map(skills.map(s => [s.path, s]));

  useEffect(() => () => window.clearTimeout(clearTimer.current), []);

  function reject(message: string, holdMs: number) {
    setDropState('rejected');
    setDropMessage(message);
    window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setDropState('idle'), holdMs);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const path = e.dataTransfer.getData('text/relay-skill-path');
    if (!path) return;
    // Templates are not files in this project, so the pipeline could never
    // read one. SkillCard already refuses to drag them; this is the backstop.
    if (path.startsWith('starter:')) {
      reject('Copy this template into the project first, then attach the copy.', 2000);
      return;
    }
    if (role.extraSkills.includes(path)) {
      reject(`“${skillByPath.get(path)?.id ?? path}” is already attached to this role.`, 1200);
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
