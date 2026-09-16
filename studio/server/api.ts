// All filesystem/JSON side effects for Studio live here, isolated from the
// UI — same idea as relay-dashboard/src/services/relay.ts: one place to
// audit for anything that touches disk.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Connect, ViteDevServer } from 'vite';
import * as dashboard from './dashboard';
import {
  applyRolePatch,
  isStarterRef,
  isWithinRoot as isWithin,
  parseFrontmatter,
  starterId,
  STARTER_PREFIX,
  type RoleConfig,
} from './registry';

// Studio is meant to be launched from the root of a project that has already
// run /relay:setup. `npm run studio` (root proxy: `npm --prefix studio run
// dev`) makes npm cd into studio/ before spawning Vite, so process.cwd()
// would resolve to studio/ itself rather than the caller's directory — npm
// sets INIT_CWD to wherever the user actually invoked `npm run` from,
// unaffected by --prefix, so that's the project root to use.
const PROJECT_ROOT = process.env.INIT_CWD ?? process.cwd();
const AGENTS_JSON_PATH = join(PROJECT_ROOT, '.relay/agents.json');
const PROJECT_SKILLS_DIR = join(PROJECT_ROOT, '.relay/skills');
// Resolved relative to this file (studio/server/api.ts), not the project
// root — the starter templates ship inside the relay module itself.
const STARTER_SKILLS_DIR = resolve(
  new URL('.', import.meta.url).pathname,
  '../../skills/pipeline/templates/skills'
);

const isWithinRoot = (candidatePath: string) => isWithin(PROJECT_ROOT, candidatePath);

// Mirrors validateRegistry's required-field check in agent-runner.ts,
// scoped down to what Studio needs to read/patch safely. Kept as its own
// small copy rather than importing the orchestration script directly, so a
// bug or missing env var in that 3000+ line file can't take the editor down
// too.
const REQUIRED_ROLES = [
  'pm',
  'dev-review',
  'pm-respond',
  'architect',
  'dev',
  'review',
  'qa',
  'retro',
  'memory-compact',
];

function readAgentsJson(): { roles: Record<string, RoleConfig> } {
  const raw = readFileSync(AGENTS_JSON_PATH, 'utf-8');
  const data = JSON.parse(raw);
  if (!data.roles || typeof data.roles !== 'object') {
    throw new Error(`Invalid ${AGENTS_JSON_PATH}: missing a "roles" object.`);
  }
  const missing = REQUIRED_ROLES.filter(r => !data.roles[r]);
  if (missing.length > 0) {
    throw new Error(
      `Invalid ${AGENTS_JSON_PATH}: missing required role(s): ${missing.join(', ')}.`
    );
  }
  return data;
}

function writeAgentsJson(data: unknown): void {
  writeFileSync(AGENTS_JSON_PATH, JSON.stringify(data, null, 2) + '\n');
}

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

interface GitHubContentItem {
  name: string;
  path: string;
  type: string;
  download_url: string | null;
}

// There is no live "Claude marketplace" to query — .claude-plugin/marketplace.json
// is a static manifest convention read by `claude plugin marketplace add
// <repo>`. This reads that same manifest from a given public GitHub repo on
// demand, so a skill from elsewhere can be pulled into this project's
// .relay/skills/ without leaving Studio.
async function fetchMarketplaceSkillFiles(repo: string) {
  const [owner, name] = repo.split('/');
  const manifestRes = await fetch(
    `https://raw.githubusercontent.com/${owner}/${name}/HEAD/.claude-plugin/marketplace.json`
  );
  if (!manifestRes.ok) {
    throw new Error(`No .claude-plugin/marketplace.json found in ${repo}`);
  }
  const manifest = await manifestRes.json();
  const skillDirs: string[] = (manifest.plugins ?? []).flatMap(
    (p: { skills?: string[] }) => p.skills ?? []
  );

  const entries: { path: string; name: string }[] = [];
  for (const dir of skillDirs) {
    const cleanDir = dir.replace(/^\.\//, '').replace(/\/$/, '');
    const listRes = await fetch(
      `https://api.github.com/repos/${owner}/${name}/contents/${cleanDir}`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!listRes.ok) continue;
    const items: GitHubContentItem[] = await listRes.json();
    for (const item of items) {
      if (item.type !== 'file' || !item.name.endsWith('.md')) continue;
      const label =
        item.name === 'SKILL.md' ? cleanDir.split('/').pop()! : item.name.replace(/\.md$/, '');
      entries.push({ path: item.path, name: label });
    }
  }
  return entries;
}

interface SkillEntry {
  // For a project skill: a real path relative to PROJECT_ROOT, editable and
  // attachable. For a starter: the opaque id `starter:<name>`, which is NOT a
  // path — the templates live inside the relay module, not in the project, so
  // a project-relative path would 404 everywhere except this repo, and
  // attaching one would write a dangling entry into agents.json that
  // agent-runner.ts then skips in silence. Starters are copied into the
  // project before they can be edited or attached.
  path: string;
  id: string;
  description: string;
  source: 'project' | 'starter';
}

// A starter id maps to exactly one file in STARTER_SKILLS_DIR. The id is
// untrusted, so it is matched against the directory listing rather than
// joined onto a path.
function starterFilePath(ref: string): string | null {
  const id = starterId(ref);
  if (!existsSync(STARTER_SKILLS_DIR)) return null;
  const match = readdirSync(STARTER_SKILLS_DIR).find(f => f.endsWith('.md') && f.replace(/\.md$/, '') === id);
  return match ? join(STARTER_SKILLS_DIR, match) : null;
}

function describeSkillFile(dir: string, file: string, source: SkillEntry['source'], ref: string): SkillEntry {
  const { meta } = parseFrontmatter(readFileSync(join(dir, file), 'utf-8'));
  const id = file.replace(/\.md$/, '');
  return {
    path: ref,
    id: meta.id ?? id,
    description: meta.description ?? id,
    source,
  };
}

function listProjectSkills(): SkillEntry[] {
  if (!existsSync(PROJECT_SKILLS_DIR)) return [];
  return readdirSync(PROJECT_SKILLS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => describeSkillFile(PROJECT_SKILLS_DIR, f, 'project', `.relay/skills/${f}`));
}

function listStarterSkills(): SkillEntry[] {
  if (!existsSync(STARTER_SKILLS_DIR)) return [];
  return readdirSync(STARTER_SKILLS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => describeSkillFile(STARTER_SKILLS_DIR, f, 'starter', `${STARTER_PREFIX}${f.replace(/\.md$/, '')}`));
}

function jsonBody(req: Connect.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function relayStudioApi() {
  return {
    name: 'relay-studio-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', async (req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const pathname = url.pathname;

          if (req.method === 'GET' && pathname === '/roles') {
            const { roles } = readAgentsJson();
            return sendJson(res, 200, { roles });
          }

          if (req.method === 'GET' && pathname === '/file') {
            const path = url.searchParams.get('path') ?? '';
            if (isStarterRef(path)) return sendJson(res, 400, { error: 'Use /api/starters for templates' });
            if (!isWithinRoot(path)) return sendJson(res, 403, { error: 'Path escapes project root' });
            const abs = join(PROJECT_ROOT, path);
            if (!existsSync(abs)) return sendJson(res, 404, { error: 'File not found' });
            return sendJson(res, 200, { content: readFileSync(abs, 'utf-8') });
          }

          if (req.method === 'PUT' && pathname === '/file') {
            const { path, content } = await jsonBody(req);
            if (typeof path !== 'string' || typeof content !== 'string') {
              return sendJson(res, 400, { error: 'path and content are required' });
            }
            if (!isWithinRoot(path)) return sendJson(res, 403, { error: 'Path escapes project root' });
            writeFileSync(join(PROJECT_ROOT, path), content);
            return sendJson(res, 200, { ok: true });
          }

          if (req.method === 'GET' && pathname === '/skills') {
            return sendJson(res, 200, { skills: [...listProjectSkills(), ...listStarterSkills()] });
          }

          // Read-only preview of a template. Separate from /file because a
          // starter is not a file in this project.
          if (req.method === 'GET' && pathname === '/starters') {
            const ref = url.searchParams.get('ref') ?? '';
            if (!isStarterRef(ref)) return sendJson(res, 400, { error: 'ref must look like starter:<id>' });
            const abs = starterFilePath(ref);
            if (!abs) return sendJson(res, 404, { error: `Unknown starter: ${ref}` });
            return sendJson(res, 200, { content: readFileSync(abs, 'utf-8') });
          }

          // Copy a template into the project, which is the only way a starter
          // becomes editable and attachable. The copy is what agents.json
          // ends up referencing.
          if (req.method === 'POST' && pathname === '/skills/from-starter') {
            const { ref } = await jsonBody(req);
            if (typeof ref !== 'string' || !isStarterRef(ref)) {
              return sendJson(res, 400, { error: 'ref must look like starter:<id>' });
            }
            const abs = starterFilePath(ref);
            if (!abs) return sendJson(res, 404, { error: `Unknown starter: ${ref}` });
            const file = `${ref.slice(STARTER_PREFIX.length)}.md`;
            const relPath = `.relay/skills/${file}`;
            const dest = join(PROJECT_ROOT, relPath);
            if (existsSync(dest)) {
              return sendJson(res, 409, { error: `${relPath} already exists — edit that copy instead.` });
            }
            mkdirSync(PROJECT_SKILLS_DIR, { recursive: true });
            writeFileSync(dest, readFileSync(abs, 'utf-8'));
            return sendJson(res, 201, describeSkillFile(PROJECT_SKILLS_DIR, file, 'project', relPath));
          }

          if (req.method === 'POST' && pathname === '/skills') {
            const { name, description } = await jsonBody(req);
            if (typeof name !== 'string' || !name.trim()) {
              return sendJson(res, 400, { error: 'name is required' });
            }
            const slug = name
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');
            if (!slug) return sendJson(res, 400, { error: 'name must contain letters or numbers' });
            const relPath = `.relay/skills/${slug}.md`;
            const abs = join(PROJECT_ROOT, relPath);
            if (existsSync(abs)) return sendJson(res, 409, { error: 'A skill with this name already exists' });
            mkdirSync(PROJECT_SKILLS_DIR, { recursive: true });
            const desc = typeof description === 'string' ? description : '';
            writeFileSync(
              abs,
              `---\nid: ${slug}\ndescription: ${desc}\n---\n\n<!-- Write the standard(s) this skill should enforce. -->\n`
            );
            return sendJson(res, 201, { path: relPath, id: slug, description: desc, source: 'project' });
          }

          if (req.method === 'GET' && pathname === '/marketplace') {
            const repo = url.searchParams.get('repo') ?? '';
            if (!REPO_PATTERN.test(repo)) {
              return sendJson(res, 400, { error: 'repo must look like owner/name' });
            }
            try {
              const skills = await fetchMarketplaceSkillFiles(repo);
              return sendJson(res, 200, { skills });
            } catch (err) {
              return sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
            }
          }

          if (req.method === 'POST' && pathname === '/marketplace/import') {
            const { repo, path } = await jsonBody(req);
            if (typeof repo !== 'string' || !REPO_PATTERN.test(repo)) {
              return sendJson(res, 400, { error: 'repo must look like owner/name' });
            }
            if (typeof path !== 'string' || !path.endsWith('.md')) {
              return sendJson(res, 400, { error: 'path must point at a markdown file' });
            }
            const [owner, name] = repo.split('/');
            const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/HEAD/${path}`);
            if (!rawRes.ok) return sendJson(res, 502, { error: `Failed to fetch ${path} from ${repo}` });
            const content = await rawRes.text();
            const segments = path.split('/');
            const filename = segments.pop()!;
            const slug = (filename === 'SKILL.md' ? segments.pop()! : filename.replace(/\.md$/, ''))
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');
            const relPath = `.relay/skills/${slug}.md`;
            mkdirSync(PROJECT_SKILLS_DIR, { recursive: true });
            writeFileSync(join(PROJECT_ROOT, relPath), content);
            const { meta } = parseFrontmatter(content);
            return sendJson(res, 201, {
              path: relPath,
              id: meta.id ?? slug,
              description: meta.description ?? slug,
              source: 'project',
            });
          }

          const roleMatch = pathname.match(/^\/roles\/([^/]+)$/);
          if (req.method === 'PATCH' && roleMatch) {
            const role = decodeURIComponent(roleMatch[1]);
            const data = readAgentsJson();
            const target = data.roles[role];
            if (!target) return sendJson(res, 404, { error: `Unknown role: ${role}` });
            const refusal = applyRolePatch(role, target, await jsonBody(req), PROJECT_ROOT);
            if (refusal) return sendJson(res, refusal.status, { error: refusal.error });
            writeAgentsJson(data);
            return sendJson(res, 200, { role, config: target });
          }

          if (req.method === 'GET' && pathname === '/dashboard/config') {
            return sendJson(res, 200, dashboard.loadDashboardConfig());
          }

          if (req.method === 'PUT' && pathname === '/dashboard/config') {
            const { repos, theme } = await jsonBody(req);
            if (Array.isArray(repos)) dashboard.saveRepos(repos);
            if (typeof theme === 'string') dashboard.saveTheme(theme);
            return sendJson(res, 200, dashboard.loadDashboardConfig());
          }

          if (req.method === 'GET' && pathname === '/dashboard/status') {
            return sendJson(res, 200, dashboard.fetchStatus());
          }

          if (req.method === 'POST' && pathname === '/dashboard/retry') {
            const { repoRoot, resumeArgs } = await jsonBody(req);
            return sendJson(res, 200, dashboard.retryRun(repoRoot, resumeArgs));
          }

          if (req.method === 'POST' && pathname === '/dashboard/start') {
            const { repoRoot, slug, issueText } = await jsonBody(req);
            return sendJson(res, 200, dashboard.startRun(repoRoot, slug, issueText));
          }

          if (req.method === 'POST' && pathname === '/dashboard/stop') {
            const { pid } = await jsonBody(req);
            dashboard.stopRun(pid);
            return sendJson(res, 200, { stopped: true });
          }

          if (req.method === 'POST' && pathname === '/dashboard/reveal') {
            const { path } = await jsonBody(req);
            dashboard.revealInFinder(path);
            return sendJson(res, 200, { ok: true });
          }

          if (req.method === 'POST' && pathname === '/dashboard/open-editor') {
            const { path } = await jsonBody(req);
            dashboard.openInEditor(path);
            return sendJson(res, 200, { ok: true });
          }

          if (req.method === 'GET' && pathname === '/dashboard/log') {
            const path = url.searchParams.get('path') ?? '';
            return sendJson(res, 200, { content: dashboard.readLog(path) });
          }

          if (req.method === 'GET' && pathname === '/dashboard/artifact') {
            const artifactsDir = url.searchParams.get('artifactsDir') ?? '';
            const fileIndex = Number(url.searchParams.get('fileIndex') ?? '0');
            return sendJson(res, 200, dashboard.readArtifact(artifactsDir, fileIndex));
          }

          if (req.method === 'GET' && pathname === '/dashboard/timeline') {
            const artifactsDir = url.searchParams.get('artifactsDir') ?? '';
            return sendJson(res, 200, dashboard.readTimeline(artifactsDir));
          }

          if (req.method === 'POST' && pathname === '/dashboard/answer') {
            const { artifactsDir, answerText, isDevReview, repoRoot, slug } = await jsonBody(req);
            return sendJson(res, 200, dashboard.submitAnswer(artifactsDir, answerText, Boolean(isDevReview), repoRoot, slug));
          }

          next();
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
