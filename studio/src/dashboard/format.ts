import type { ActiveRun, RunState } from './types';

// The badge and caption wording, carried over from the native app this replaced.
export const STATE_BADGES: Record<RunState, string> = {
  running: 'running',
  'design-gate': 'design gate',
  'blocked-pm-questions': 'PM questions',
  'blocked-dev-review': 'clarifications',
  'failed-typecheck': 'typecheck FAIL',
  'failed-review': 'review FAIL',
  'failed-qa': 'QA FAIL',
  halted: 'halted',
  crashed: 'crashed',
  done: 'done',
};

const STATE_NOTES: Record<RunState, string> = {
  running: '',
  'design-gate': 'awaiting design approval',
  'blocked-pm-questions': 'blocked on PM clarifying questions',
  'blocked-dev-review': 'blocked on clarifications',
  'failed-typecheck': 'quality gates failing',
  'failed-review': '',
  'failed-qa': 'pushed, no PR',
  halted: '',
  crashed: '',
  done: 'check PR / clean up worktree',
};

export function composeCaption(run: ActiveRun): string {
  const parts: string[] = [];
  const note =
    run.state === 'design-gate' && run.staleApproval ? 'plan changed since approval' : STATE_NOTES[run.state];
  if (note) parts.push(note);
  if (run.lastRole) parts.push(run.lastRole);
  if (typeof run.costUsd === 'number' && isFinite(run.costUsd)) parts.push(`$${run.costUsd.toFixed(2)}`);
  if (run.model) parts.push(run.model);
  return parts.join(' · ');
}

// Sort order the native app uses within a repo: failed states first, then
// gated/blocked, then running.
const STATE_ORDER: RunState[] = [
  'failed-typecheck',
  'failed-review',
  'failed-qa',
  'crashed',
  'halted',
  'design-gate',
  'blocked-pm-questions',
  'blocked-dev-review',
  'running',
  'done',
];

export function sortRuns(runs: ActiveRun[]): ActiveRun[] {
  return [...runs].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
}

export function needsAttention(state: RunState): boolean {
  return state !== 'running' && state !== 'done';
}
