export type RunState =
  | 'running'
  | 'blocked-pm-questions'
  | 'design-gate'
  | 'blocked-dev-review'
  | 'failed-typecheck'
  | 'failed-review'
  | 'failed-qa'
  | 'halted'
  | 'crashed'
  | 'done';

export interface ActiveRun {
  slug: string;
  branch: string;
  worktree: string;
  artifactsDir: string;
  hasArtifacts: boolean;
  lock: { pid: number; alive: boolean } | null;
  livePid?: number;
  lastRole?: string;
  model: string | null;
  costUsd?: number;
  tokens: number | null;
  verdicts: Record<string, string>;
  state: RunState;
  role: string;
  detail?: string;
  staleApproval?: boolean;
  resumeHint?: string;
  resumeArgs?: string[];
  repoRoot: string;
}

export interface CompletedFeature {
  slug: string;
  branch: string;
  mergedAtMs: number;
  note?: string;
}

export interface RepoStatus {
  root: string;
  name: string;
  githubRepo?: string;
  budget?: { maxCostUsdPerFeature: number | null };
  active?: ActiveRun[];
  completed?: CompletedFeature[];
  error?: string;
}

export interface StatusSnapshot {
  generatedAt: string;
  repos: RepoStatus[];
}

export interface TimelineRow {
  seq: number;
  role: string;
  reached: boolean;
  verdict: string;
  model: string;
  costText: string;
  tokens: number;
  completedAgo: string;
}

export interface DashboardConfig {
  repos: string[];
  statusScript: string;
  theme: string;
}
