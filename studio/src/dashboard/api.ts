import type { DashboardConfig, StatusSnapshot, TimelineRow } from './types';

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request to ${input} failed`);
  return body;
}

export const fetchDashboardConfig = () => request<DashboardConfig>('/api/dashboard/config');

export const saveDashboardConfig = (patch: { repos?: string[]; theme?: string }) =>
  request<DashboardConfig>('/api/dashboard/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

export const fetchDashboardStatus = () => request<StatusSnapshot>('/api/dashboard/status');

export const retryRun = (repoRoot: string, resumeArgs: string[]) =>
  request<{ logPath: string; pid: number }>('/api/dashboard/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoRoot, resumeArgs }),
  });

export const startRun = (repoRoot: string, slug: string, issueText: string) =>
  request<{ logPath: string; pid: number }>('/api/dashboard/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoRoot, slug, issueText }),
  });

export const stopRun = (pid: number) =>
  request<void>('/api/dashboard/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid }),
  });

export const revealInFinder = (path: string) =>
  request<void>('/api/dashboard/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

export const openInEditor = (path: string) =>
  request<void>('/api/dashboard/open-editor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

export const fetchLog = (path: string) =>
  request<{ content: string }>(`/api/dashboard/log?path=${encodeURIComponent(path)}`);

export const fetchArtifact = (artifactsDir: string, fileIndex: number) =>
  request<{ content: string; found: boolean }>(
    `/api/dashboard/artifact?artifactsDir=${encodeURIComponent(artifactsDir)}&fileIndex=${fileIndex}`
  );

export const fetchTimeline = (artifactsDir: string) =>
  request<{ rows: TimelineRow[]; totalCostText: string; totalTokens: number }>(
    `/api/dashboard/timeline?artifactsDir=${encodeURIComponent(artifactsDir)}`
  );

export const submitAnswer = (
  artifactsDir: string,
  answerText: string,
  isDevReview: boolean,
  repoRoot: string,
  slug: string
) =>
  request<{ resumeArgs: string[] }>('/api/dashboard/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artifactsDir, answerText, isDevReview, repoRoot, slug }),
  });
