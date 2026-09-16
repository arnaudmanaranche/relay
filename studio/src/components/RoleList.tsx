import type { RoleSummary } from '../types';
import { IsoCube } from '../lib/iso';

interface Props {
  roles: RoleSummary[];
  selected: string | null;
  onSelect: (name: string) => void;
}

export function RoleList({ roles, selected, onSelect }: Props) {
  return (
    <ul className="role-list">
      {roles.map(role => (
        <li key={role.name}>
          <button
            className={role.name === selected ? 'role-item selected' : 'role-item'}
            onClick={() => onSelect(role.name)}
          >
            <IsoCube colorKey={role.name === selected ? 'charcoal' : 'plain'} u={9} />
            <span className="role-item-text">
              <span className="role-name">{role.name}</span>
              <span className="role-description">{role.description}</span>
            </span>
            {role.extraSkills.length > 0 && (
              <span className="role-skill-count">{role.extraSkills.length}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
