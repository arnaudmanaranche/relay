export interface RoleSummary {
  name: string;
  description: string;
  skill: string;
  extraSkills: string[];
  typeSkills?: Record<string, string>;
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
