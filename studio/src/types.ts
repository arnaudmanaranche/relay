export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

export interface RoleSummary {
  name: string;
  description: string;
  skill: string;
  model: string;
  maxTokens: number;
  /** Absent means "the backend's default" — a legal registry state. */
  effort?: string;
  extraSkills: string[];
  /** Dev only: matched against the impacted-files list. */
  typeSkills?: Record<string, string>;
}

export interface RolePatch {
  model?: string;
  maxTokens?: number;
  effort?: string | null;
  extraSkills?: string[];
  typeSkills?: Record<string, string> | null;
}

export interface SkillEntry {
  path: string;
  id: string;
  description: string;
  source: 'project' | 'starter';
}

export interface MarketplaceSkillEntry {
  path: string; // repo-relative path, e.g. skills/pipeline/prompts/foo.md
  name: string;
}
