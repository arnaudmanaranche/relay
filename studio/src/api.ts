import type { MarketplaceSkillEntry, RolePatch, RoleSummary, SkillEntry } from './types';

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request to ${input} failed`);
  return body;
}

export async function fetchRoles(): Promise<RoleSummary[]> {
  const { roles } = await request<{
    roles: Record<
      string,
      {
        description: string;
        skill: string;
        model: string;
        maxTokens: number;
        effort?: string;
        extraSkills?: string[];
        typeSkills?: Record<string, string>;
      }
    >;
  }>('/api/roles');
  return Object.entries(roles).map(([name, cfg]) => ({
    name,
    description: cfg.description,
    skill: cfg.skill,
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    effort: cfg.effort,
    extraSkills: cfg.extraSkills ?? [],
    typeSkills: cfg.typeSkills,
  }));
}

export async function fetchFile(path: string): Promise<string> {
  const { content } = await request<{ content: string }>(
    `/api/file?path=${encodeURIComponent(path)}`
  );
  return content;
}

export async function saveFile(path: string, content: string): Promise<void> {
  await request('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
}

export async function fetchStarter(ref: string): Promise<string> {
  const { content } = await request<{ content: string }>(
    `/api/starters?ref=${encodeURIComponent(ref)}`
  );
  return content;
}

export async function copyStarterIntoProject(ref: string): Promise<SkillEntry> {
  return request<SkillEntry>('/api/skills/from-starter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref }),
  });
}

export function isStarterRef(ref: string): boolean {
  return ref.startsWith('starter:');
}

export async function fetchSkills(): Promise<SkillEntry[]> {
  const { skills } = await request<{ skills: SkillEntry[] }>('/api/skills');
  return skills;
}

export async function createSkill(
  name: string,
  description: string
): Promise<SkillEntry> {
  return request<SkillEntry>('/api/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
}

// One endpoint for every registry field Studio can change; the server
// validates each one the same way agent-runner.ts does, so a bad value is
// refused here instead of exit(1)-ing the next run.
export async function patchRole(role: string, patch: RolePatch): Promise<void> {
  await request(`/api/roles/${encodeURIComponent(role)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function setRoleSkills(role: string, extraSkills: string[]): Promise<void> {
  await patchRole(role, { extraSkills });
}

export async function fetchMarketplaceSkills(
  repo: string
): Promise<MarketplaceSkillEntry[]> {
  const { skills } = await request<{ skills: MarketplaceSkillEntry[] }>(
    `/api/marketplace?repo=${encodeURIComponent(repo)}`
  );
  return skills;
}

export async function importMarketplaceSkill(
  repo: string,
  path: string
): Promise<SkillEntry> {
  return request<SkillEntry>('/api/marketplace/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo, path }),
  });
}
