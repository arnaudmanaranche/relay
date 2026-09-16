// The rules that decide whether a write to .relay/agents.json is legal,
// separated from the HTTP layer so they can be tested without a server and
// without a project on disk. api.ts holds the IO; this holds the judgement.
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

// agent-runner.ts's own EFFORT_LEVELS. Writing anything else makes its
// validateRegistry exit(1) on the next run — Studio would break the pipeline
// from the UI.
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export const STARTER_PREFIX = 'starter:';

export function isStarterRef(ref: string): boolean {
  return ref.startsWith(STARTER_PREFIX);
}

export function starterId(ref: string): string {
  return ref.slice(STARTER_PREFIX.length);
}

// Mirrors the containment check in skills/pipeline/scripts/agent-runner.ts
// (isWithinRoot): every path that reaches disk originates from an HTTP request
// body or query string, so it is untrusted input that could contain `../`.
export function isWithinRoot(root: string, candidatePath: string): boolean {
  const target = resolve(root, candidatePath);
  return target === root || target.startsWith(root + sep);
}

// Minimal frontmatter: an optional leading `---\nkey: value\n---` block. No
// external dependency for a shape this small.
export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body: match[2] };
}

export interface RoleConfig {
  skill: string;
  model: string;
  artifact: string;
  description: string;
  maxTokens: number;
  effort?: string;
  typeSkills?: Record<string, string>;
  extraSkills?: string[];
}

export interface Refusal {
  status: number;
  error: string;
}

/** Whether a skill path is something the pipeline could actually read.
 *  extraSkills and typeSkills are both resolved against the PROJECT root by
 *  agent-runner.ts, which skips a missing one without a word — so a bad entry
 *  reads as "attached" in the UI and never reaches a prompt. */
export function skillPathProblem(
  root: string,
  value: string,
  exists: (p: string) => boolean = existsSync
): Refusal | null {
  if (isStarterRef(value)) {
    return {
      status: 400,
      error: `${value} is a template — copy it into the project first, then attach the copy.`,
    };
  }
  if (!isWithinRoot(root, value)) {
    return { status: 403, error: `Skill path escapes project root: ${value}` };
  }
  if (!exists(join(root, value))) {
    return { status: 404, error: `No such skill file: ${value}` };
  }
  return null;
}

export interface RolePatch {
  model?: unknown;
  maxTokens?: unknown;
  effort?: unknown;
  extraSkills?: unknown;
  typeSkills?: unknown;
}

/** Applies a partial registry patch to one role, in place, or refuses it.
 *  Every field is validated the way agent-runner.ts validates the file it
 *  loads, so a value Studio accepts is a value the next run accepts. */
export function applyRolePatch(
  role: string,
  target: RoleConfig,
  patch: RolePatch,
  root: string,
  exists: (p: string) => boolean = existsSync
): Refusal | null {
  if (patch.extraSkills !== undefined) {
    const { extraSkills } = patch;
    if (!Array.isArray(extraSkills) || extraSkills.some(s => typeof s !== 'string')) {
      return { status: 400, error: 'extraSkills must be an array of strings' };
    }
    for (const s of extraSkills as string[]) {
      const problem = skillPathProblem(root, s, exists);
      if (problem) return problem;
    }
    target.extraSkills = extraSkills as string[];
  }

  if (patch.model !== undefined) {
    if (typeof patch.model !== 'string' || !patch.model.trim()) {
      return { status: 400, error: 'model must be a non-empty string' };
    }
    target.model = patch.model.trim();
  }

  if (patch.maxTokens !== undefined) {
    const n = Number(patch.maxTokens);
    if (!Number.isInteger(n) || n <= 0) {
      return { status: 400, error: 'maxTokens must be a positive integer' };
    }
    target.maxTokens = n;
  }

  // Omitting effort is legal in the registry and means "the backend's
  // default", so empty clears the field rather than writing a sentinel the
  // pipeline would then reject.
  if (patch.effort !== undefined) {
    if (patch.effort === null || patch.effort === '') {
      delete target.effort;
    } else if (
      typeof patch.effort !== 'string' ||
      !(EFFORT_LEVELS as readonly string[]).includes(patch.effort)
    ) {
      return { status: 400, error: `effort must be one of ${EFFORT_LEVELS.join(', ')}, or empty` };
    } else {
      target.effort = patch.effort;
    }
  }

  if (patch.typeSkills !== undefined) {
    // Dev only: the match is against the impacted-files list, which only
    // Dev's technical plan provides.
    if (role !== 'dev') {
      return { status: 400, error: 'typeSkills only applies to the dev role' };
    }
    const ts = patch.typeSkills;
    if (ts === null) {
      delete target.typeSkills;
    } else if (typeof ts !== 'object' || Array.isArray(ts)) {
      return { status: 400, error: 'typeSkills must be an object of pattern -> skill path' };
    } else if (Object.keys(ts as object).length === 0) {
      delete target.typeSkills;
    } else {
      for (const [pattern, value] of Object.entries(ts as Record<string, unknown>)) {
        if (!pattern.trim()) return { status: 400, error: 'typeSkills patterns cannot be empty' };
        if (typeof value !== 'string') {
          return { status: 400, error: `typeSkills["${pattern}"] must be a skill path` };
        }
        const problem = skillPathProblem(root, value, exists);
        if (problem) return problem;
      }
      target.typeSkills = ts as Record<string, string>;
    }
  }

  return null;
}
