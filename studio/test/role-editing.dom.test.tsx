// The components that write .relay/agents.json. The server refuses a bad
// value, but the UI still has to not send nonsense and has to show the refusal
// rather than looking like it saved.
import { closeDom } from './setup-dom.ts';
import { test, describe, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleSettings } from '../src/components/RoleSettings.tsx';
import { TypeSkills } from '../src/components/TypeSkills.tsx';
import { SkillCard } from '../src/components/SkillCard.tsx';
import { AttachedSkills } from '../src/components/AttachedSkills.tsx';
import type { RolePatch, RoleSummary, SkillEntry } from '../src/types.ts';

afterEach(cleanup);
after(closeDom);

function role(over: Partial<RoleSummary> = {}): RoleSummary {
  return {
    name: 'dev',
    description: 'Developer',
    skill: 'skills/pipeline/prompts/dev.md',
    model: 'claude-sonnet-5',
    maxTokens: 8000,
    effort: 'high',
    extraSkills: [],
    ...over,
  };
}

const projectSkill = (id: string): SkillEntry => ({
  path: `.relay/skills/${id}.md`,
  id,
  description: id,
  source: 'project',
});
const template = (id: string): SkillEntry => ({
  path: `starter:${id}`,
  id,
  description: id,
  source: 'starter',
});

describe('RoleSettings', () => {
  test('Save is disabled until a field changes', async () => {
    render(<RoleSettings role={role()} onSave={async () => {}} />);
    const save = screen.getByRole('button', { name: /Save settings/ });
    assert.equal((save as HTMLButtonElement).disabled, true);

    await userEvent.clear(screen.getByDisplayValue('claude-sonnet-5'));
    assert.equal((save as HTMLButtonElement).disabled, false);
  });

  test('sends model, maxTokens and effort together', async () => {
    const sent: RolePatch[] = [];
    render(<RoleSettings role={role()} onSave={async p => void sent.push(p)} />);
    const model = screen.getByDisplayValue('claude-sonnet-5');
    await userEvent.clear(model);
    await userEvent.type(model, 'claude-opus-5');
    await userEvent.click(screen.getByRole('button', { name: /Save settings/ }));
    await waitFor(() =>
      assert.deepEqual(sent, [{ model: 'claude-opus-5', maxTokens: 8000, effort: 'high' }])
    );
  });

  test('an empty effort is sent as null, to clear the key', async () => {
    // Omitting effort is legal and means "the backend's default"; sending ''
    // would be a value the pipeline rejects on the next run.
    const sent: RolePatch[] = [];
    render(<RoleSettings role={role()} onSave={async p => void sent.push(p)} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), '');
    await userEvent.click(screen.getByRole('button', { name: /Save settings/ }));
    await waitFor(() => assert.equal(sent[0]?.effort, null));
  });

  test('offers exactly the levels the pipeline accepts', () => {
    render(<RoleSettings role={role()} onSave={async () => {}} />);
    const values = [...screen.getByRole('combobox').querySelectorAll('option')].map(o => o.value);
    assert.deepEqual(values, ['', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  test('a role with no effort starts on the backend default', () => {
    render(<RoleSettings role={role({ effort: undefined })} onSave={async () => {}} />);
    assert.equal((screen.getByRole('combobox') as HTMLSelectElement).value, '');
  });

  test('a refusal is shown and the field keeps what was typed', async () => {
    render(
      <RoleSettings
        role={role()}
        onSave={async () => {
          throw new Error('maxTokens must be a positive integer');
        }}
      />
    );
    const tokens = screen.getByDisplayValue('8000');
    await userEvent.clear(tokens);
    await userEvent.type(tokens, '0');
    await userEvent.click(screen.getByRole('button', { name: /Save settings/ }));
    await screen.findByText('maxTokens must be a positive integer');
    assert.equal((tokens as HTMLInputElement).value, '0');
  });

  test('switching role resets the fields to that role', async () => {
    const { rerender } = render(<RoleSettings role={role()} onSave={async () => {}} />);
    await userEvent.clear(screen.getByDisplayValue('claude-sonnet-5'));
    rerender(<RoleSettings role={role({ name: 'qa', model: 'claude-haiku-4-5-20251001' })} onSave={async () => {}} />);
    await waitFor(() => screen.getByDisplayValue('claude-haiku-4-5-20251001'));
  });
});

describe('TypeSkills', () => {
  test('says so when there is nothing to map', () => {
    // Only project skills can be mapped: a template is not a file in this
    // project, so the pipeline could never read it.
    render(<TypeSkills role={role()} skills={[template('ui-standards')]} onChange={async () => {}} />);
    assert.match(screen.getByText(/No project skill to map/).textContent!, /create one/);
    assert.equal(screen.queryByRole('button', { name: 'Map' }), null);
  });

  test('offers only project skills', () => {
    render(
      <TypeSkills
        role={role()}
        skills={[projectSkill('ui'), template('ui-standards')]}
        onChange={async () => {}}
      />
    );
    const options = [...screen.getByRole('combobox').querySelectorAll('option')].map(o => o.value);
    assert.deepEqual(options, ['.relay/skills/ui.md']);
  });

  test('adds a mapping without dropping the existing ones', async () => {
    const sent: Record<string, string>[] = [];
    render(
      <TypeSkills
        role={role({ typeSkills: { '*.css': '.relay/skills/css.md' } })}
        skills={[projectSkill('ui'), projectSkill('css')]}
        onChange={async next => void sent.push(next)}
      />
    );
    await userEvent.type(screen.getByPlaceholderText('*.tsx'), '*.tsx');
    await userEvent.selectOptions(screen.getByRole('combobox'), '.relay/skills/ui.md');
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    await waitFor(() =>
      assert.deepEqual(sent, [{ '*.css': '.relay/skills/css.md', '*.tsx': '.relay/skills/ui.md' }])
    );
  });

  test('Map stays disabled without a pattern', async () => {
    render(<TypeSkills role={role()} skills={[projectSkill('ui')]} onChange={async () => {}} />);
    assert.equal((screen.getByRole('button', { name: 'Map' }) as HTMLButtonElement).disabled, true);
    await userEvent.type(screen.getByPlaceholderText('*.tsx'), '  ');
    assert.equal((screen.getByRole('button', { name: 'Map' }) as HTMLButtonElement).disabled, true);
  });

  test('removing the only mapping sends an empty object, which clears the key', async () => {
    const sent: Record<string, string>[] = [];
    render(
      <TypeSkills
        role={role({ typeSkills: { '*.tsx': '.relay/skills/ui.md' } })}
        skills={[projectSkill('ui')]}
        onChange={async next => void sent.push(next)}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => assert.deepEqual(sent, [{}]));
  });

  test('a refusal is surfaced', async () => {
    render(
      <TypeSkills
        role={role({ typeSkills: { '*.tsx': '.relay/skills/ui.md' } })}
        skills={[projectSkill('ui')]}
        onChange={async () => {
          throw new Error('typeSkills only applies to the dev role');
        }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByText('typeSkills only applies to the dev role');
  });
});

describe('SkillCard', () => {
  test('a project skill is draggable', () => {
    const { container } = render(
      <SkillCard skill={projectSkill('ui')} attached={false} onSelect={() => {}} />
    );
    assert.equal(container.querySelector('.skill-card')!.getAttribute('draggable'), 'true');
  });

  test('a template is not draggable, because it cannot be attached', () => {
    const { container } = render(
      <SkillCard skill={template('ui-standards')} attached={false} onSelect={() => {}} />
    );
    assert.equal(container.querySelector('.skill-card')!.getAttribute('draggable'), 'false');
  });

  test('the source is labelled', () => {
    render(<SkillCard skill={template('ui-standards')} attached={false} />);
    screen.getByText('template');
    cleanup();
    render(<SkillCard skill={projectSkill('ui')} attached={false} />);
    screen.getByText('project');
  });
});

describe('AttachedSkills', () => {
  // fireEvent builds the event in jsdom's realm; a `new Event` from Node's
  // own global is rejected by jsdom's dispatchEvent.
  function drop(node: Element, path: string) {
    fireEvent.drop(node, {
      dataTransfer: { getData: (type: string) => (type === 'text/relay-skill-path' ? path : '') },
    });
  }

  test('dropping a project skill attaches it', async () => {
    const dropped: string[] = [];
    const { container } = render(
      <AttachedSkills
        role={role()}
        skills={[projectSkill('ui')]}
        onDetachSkill={() => {}}
        onDropSkill={p => dropped.push(p)}
      />
    );
    drop(container.querySelector('.attached-skills')!, '.relay/skills/ui.md');
    await waitFor(() => assert.deepEqual(dropped, ['.relay/skills/ui.md']));
  });

  test('dropping a template is refused, with a reason', async () => {
    // SkillCard already refuses to drag one; this is the backstop, and the
    // reason matters because the fix is not obvious.
    const dropped: string[] = [];
    const { container } = render(
      <AttachedSkills
        role={role()}
        skills={[template('code-style')]}
        onDetachSkill={() => {}}
        onDropSkill={p => dropped.push(p)}
      />
    );
    drop(container.querySelector('.attached-skills')!, 'starter:code-style');
    await screen.findByText(/Copy this template into the project first/);
    assert.deepEqual(dropped, []);
  });

  test('dropping one that is already attached says so instead of duplicating', async () => {
    const dropped: string[] = [];
    const { container } = render(
      <AttachedSkills
        role={role({ extraSkills: ['.relay/skills/ui.md'] })}
        skills={[projectSkill('ui')]}
        onDetachSkill={() => {}}
        onDropSkill={p => dropped.push(p)}
      />
    );
    drop(container.querySelector('.attached-skills')!, '.relay/skills/ui.md');
    await screen.findByText(/already attached/);
    assert.deepEqual(dropped, []);
  });

  test('an attached skill shows its id, not its path', () => {
    render(
      <AttachedSkills
        role={role({ extraSkills: ['.relay/skills/ui.md'] })}
        skills={[projectSkill('ui')]}
        onDetachSkill={() => {}}
        onDropSkill={() => {}}
      />
    );
    screen.getByText('ui');
  });

  test('a path with no matching skill still renders, as the path', () => {
    // Defensive: agents.json can name a file the library does not list.
    render(
      <AttachedSkills
        role={role({ extraSkills: ['.relay/skills/gone.md'] })}
        skills={[]}
        onDetachSkill={() => {}}
        onDropSkill={() => {}}
      />
    );
    screen.getByText('.relay/skills/gone.md');
  });

  test('Remove detaches that one', async () => {
    const detached: string[] = [];
    render(
      <AttachedSkills
        role={role({ extraSkills: ['.relay/skills/ui.md'] })}
        skills={[projectSkill('ui')]}
        onDetachSkill={p => detached.push(p)}
        onDropSkill={() => {}}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => assert.deepEqual(detached, ['.relay/skills/ui.md']));
  });
});
