import { useState } from 'react';
import type { SkillEntry } from '../types';
import { IsoCube } from '../lib/iso';

interface Props {
  skill: SkillEntry;
  attached: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

export function SkillCard({ skill, attached, selected, onSelect }: Props) {
  const [dragging, setDragging] = useState(false);
  const isStarter = skill.source === 'starter';
  // plain = starter template, sage = already attached to the selected role,
  // charcoal = a project skill available but not attached — same legend the
  // pipeline rail uses, repurposed for skill state instead of run state.
  const colorKey = isStarter ? 'plain' : attached ? 'sage' : 'charcoal';

  const classes = ['skill-card'];
  if (dragging) classes.push('dragging');
  else if (attached) classes.push('attached');
  if (selected) classes.push('selected');
  if (isStarter) classes.push('starter');

  return (
    <div
      className={classes.join(' ')}
      // A template lives in the relay module, not in this project, so it
      // cannot be attached to a role: copy it in first, then drag the copy.
      draggable={!isStarter}
      onClick={onSelect}
      onDragStart={e => {
        e.dataTransfer.setData('text/relay-skill-path', skill.path);
        e.dataTransfer.effectAllowed = 'copy';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      <IsoCube colorKey={colorKey} u={11} />
      <span className="skill-card-text">
        <span className="skill-id">{skill.id}</span>
        <span className="skill-description">{skill.description}</span>
      </span>
      <span className="skill-source">{isStarter ? 'template' : 'project'}</span>
    </div>
  );
}
