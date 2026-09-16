// Everything that reads or writes run state: the dashboard config file, the
// status.mjs shell-out, the detached spawns. Ported from the native macOS app
// this replaced, minus its byte-array boundary encoding — that was a demand of
// its Zig runtime's cast validator, and this runs as plain Node behind a JSON
// API, so strings stay strings.
//
// The config still lives at ~/.config/relay-dashboard.json: renaming it would
// silently drop the repo list of anyone who had the old app set up.
import { execFileSync, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function configPath(): string {
  return join(homedir(), '.config', 'relay-dashboard.json');
}

interface ConfigFile {
  repos?: string[];
  statusScript?: string;
  theme?: string;
}

function readConfigFile(): ConfigFile {
  if (!existsSync(configPath())) return {};
  return JSON.parse(readFileSync(configPath(), 'utf-8')) as ConfigFile;
}

// Atomic install (tmp + rename), same as every writer in the native app.
function writeConfigFile(next: ConfigFile): void {
  const path = configPath();
  const tmp = `${path}.tmp`;
  mkdirSync(join(homedir(), '.config'), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, path);
}

export function loadDashboardConfig(): { repos: string[]; statusScript: string; theme: string } {
  const table = readConfigFile();
  const listedRepos = Array.isArray(table.repos) ? table.repos : [];
  const repos = listedRepos
    .filter(entry => entry.length > 0)
    .map(entry => (entry.startsWith('~') ? join(homedir(), entry.slice(1)) : entry));

  let script = typeof table.statusScript === 'string' ? table.statusScript : '';
  if (!script) {
    const relative = join('skills', 'pipeline', 'scripts', 'status.mjs');
    for (const root of repos) {
      const candidate = join(root, relative);
      if (existsSync(candidate)) {
        script = candidate;
        break;
      }
    }
  }
  const theme = table.theme === 'light' || table.theme === 'dark' ? table.theme : 'system';
  return { repos, statusScript: script, theme };
}

export function saveRepos(repos: string[]): void {
  const table = readConfigFile();
  const seen = new Set<string>();
  const clean: string[] = [];
  for (let entry of repos) {
    entry = entry.trim();
    if (!entry) continue;
    entry = entry.startsWith('~') ? join(homedir(), entry.slice(1)) : entry;
    if (seen.has(entry)) continue;
    seen.add(entry);
    clean.push(entry);
  }
  writeConfigFile({ ...table, repos: clean });
}

export function saveTheme(theme: string): void {
  const table = readConfigFile();
  writeConfigFile({ ...table, theme });
}

// argv[0] is resolved to an absolute path (repoRoot + the script's
// repoRoot-relative path status.mjs reports) so retryRun/startRun can spawn
// it regardless of this server's own cwd.
function resolveResumeArgs(repoRoot: string, raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  return [join(repoRoot, raw[0]), ...raw.slice(1)];
}

// The pipeline directory is named differently depending on how the module was
// installed (`skills/pipeline/` in a checkout, `skills/relay-pipeline/` after
// a plugin install), so the path cannot be assumed. status.mjs already has to
// solve this to print a resume command; rather than keep a second copy of the
// rule here, its findRunPipeline is imported from whichever copy of the script
// this install is configured to use.
async function runPipelinePath(repoRoot: string): Promise<string> {
  const { statusScript } = loadDashboardConfig();
  if (!statusScript) throw new Error('No status.mjs resolved — add a Relay repo in Settings.');
  const mod = (await import(pathToFileURL(statusScript).href)) as {
    findRunPipeline?: (root: string) => string | null;
  };
  // An older copy of status.mjs predates the export. Its own resume commands
  // are wrong too, but guessing here would only turn a clear error into a
  // confusing one.
  if (typeof mod.findRunPipeline !== 'function') {
    throw new Error(
      `${statusScript} is from an older Relay than this Studio. Re-run /relay:setup in that project to update it.`
    );
  }
  const relative = mod.findRunPipeline(repoRoot);
  if (!relative) {
    throw new Error(`No run-pipeline.sh found under ${repoRoot}/skills/ — has /relay:setup run there?`);
  }
  return join(repoRoot, relative);
}

// Runs status.mjs and returns its JSON verbatim, except each active run
// gains `repoRoot` (for later retry/stop/artifact calls) and its
// `resumeArgs` resolved to an absolute argv[0].
export function fetchStatus(): unknown {
  const { repos, statusScript } = loadDashboardConfig();
  if (!statusScript || repos.length === 0) {
    throw new Error('No Relay repos configured yet — add one in Dashboard settings.');
  }
  const out = execFileSync('node', [statusScript, '--json', ...repos], {
    encoding: 'utf-8',
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = JSON.parse(out) as { repos?: Array<Record<string, unknown>> };
  for (const repo of parsed.repos ?? []) {
    const root = typeof repo.root === 'string' ? repo.root : '';
    const active = Array.isArray(repo.active) ? (repo.active as Array<Record<string, unknown>>) : [];
    for (const run of active) {
      run.repoRoot = root;
      if (Array.isArray(run.resumeArgs)) {
        run.resumeArgs = resolveResumeArgs(root, run.resumeArgs as string[]);
      }
    }
  }
  return parsed;
}

// Shared by retryRun and startRun: spawns argv[0] (already absolute)
// detached, stdout/stderr appended to a log file the caller polls. Never
// awaited — the next status poll picks up the run via the lock file
// run-pipeline.sh writes on its own.
function spawnDetachedLogged(repoRoot: string, args: string[], logTag: string): { logPath: string; pid: number } {
  const script = args[0];
  if (!existsSync(script)) throw new Error(`${script} does not exist.`);
  const logDir = join(tmpdir(), 'relay-dashboard');
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${logTag}-${Date.now()}.log`);
  const logFd = openSync(logPath, 'a');
  let pid = 0;
  try {
    const child = spawn('bash', [script, ...args.slice(1)], {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    pid = child.pid ?? 0;
  } finally {
    closeSync(logFd);
  }
  return { logPath, pid };
}

export function retryRun(repoRoot: string, resumeArgs: string[]): { logPath: string; pid: number } {
  if (!repoRoot || resumeArgs.length === 0) throw new Error('This run has no resume command.');
  const slug = resumeArgs[1] ?? 'run';
  return spawnDetachedLogged(repoRoot, resumeArgs, `retry-${slug}`);
}

export async function startRun(
  repoRoot: string,
  slug: string,
  issueText: string
): Promise<{ logPath: string; pid: number }> {
  slug = slug.trim();
  issueText = issueText.trim();
  if (!repoRoot || !slug) throw new Error('A repo and a slug are required.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error('Slug must be lowercase letters, digits, and hyphens only (e.g. dark-mode).');
  }
  const script = await runPipelinePath(repoRoot);
  const scratchDir = join(tmpdir(), 'relay-dashboard');
  mkdirSync(scratchDir, { recursive: true });
  const issuePath = join(scratchDir, `issue-${slug}-${Date.now()}.md`);
  writeFileSync(issuePath, `${issueText}\n`);
  const args = [script, slug, issuePath, `--project-root=${repoRoot}`];
  return spawnDetachedLogged(repoRoot, args, `start-${slug}`);
}

// SIGTERM to the process group first, then the bare pid — ESRCH (already
// dead) is tolerated, not an error.
export function stopRun(pid: number): void {
  if (!pid || pid <= 0) throw new Error('No running process to stop.');
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGTERM');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
    }
  }
}

export function readLog(path: string): string {
  if (!path || !existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

// The most recent log this tool wrote for a slug, whenever it was written.
//
// Without this, a run's output was only visible if you happened to be the one
// who started it in this session: the log path came back from retry/start and
// was lost on reload. So a run that had already failed showed the generic
// "likely a crash or interrupted run" and nothing else, while the reason was
// sitting in a file the whole time — in the case that prompted this, a
// "Permission denied" line naming the exact file the role was refused.
export function findLastLog(slug: string): { path: string; content: string; writtenAtMs: number } | null {
  if (!slug) return null;
  const dir = join(tmpdir(), 'relay-dashboard');
  if (!existsSync(dir)) return null;
  // `retry-<slug>-<ms>.log` / `start-<slug>-<ms>.log`. Matched by prefix
  // rather than parsed, since a slug contains hyphens itself.
  const prefixes = [`retry-${slug}-`, `start-${slug}-`];
  let best: { path: string; writtenAtMs: number } | null = null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.log') || !prefixes.some(p => name.startsWith(p))) continue;
    const path = join(dir, name);
    let writtenAtMs: number;
    try {
      writtenAtMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (!best || writtenAtMs > best.writtenAtMs) best = { path, writtenAtMs };
  }
  if (!best) return null;
  return { ...best, content: readFileSync(best.path, 'utf-8') };
}

export function revealInFinder(path: string): void {
  if (!path || !existsSync(path)) throw new Error(`${path || '(empty path)'} does not exist.`);
  execFileSync('open', ['-R', path], { timeout: 10_000 });
}

export function openInEditor(path: string): void {
  if (!path || !existsSync(path)) {
    throw new Error(
      `${path || '(empty path)'} does not exist any more — the worktree was probably removed after the run landed.`
    );
  }
  try {
    execFileSync('code', [path], { timeout: 10_000 });
    return;
  } catch {
    // fall through to the macOS launcher below
  }
  execFileSync('open', ['-a', 'Visual Studio Code', path], { timeout: 10_000 });
}

// 0 = technical-plan.md, 1 = pm-questions.md, 2 = pm-dev-thread.md.
const ARTIFACT_FILES = ['technical-plan.md', 'pm-questions.md', 'pm-dev-thread.md'];

export function readArtifact(artifactsDir: string, fileIndex: number): { content: string; found: boolean } {
  const fileName = ARTIFACT_FILES[fileIndex] ?? ARTIFACT_FILES[0];
  const path = artifactsDir ? join(artifactsDir, fileName) : '';
  if (!path || !existsSync(path)) return { content: '', found: false };
  return { content: readFileSync(path, 'utf-8'), found: true };
}

// Fixed role sequence — mirrors VERDICT_ROLES in status.mjs / run-pipeline.sh's
// actual call order.
const TIMELINE_ROLES = [
  { key: 'pm', label: 'PM' },
  { key: 'dev-review', label: 'Dev Review' },
  { key: 'pm-respond', label: 'PM Respond' },
  { key: 'architect', label: 'Architect' },
  { key: 'dev', label: 'Dev' },
  { key: 'review', label: 'Review' },
  { key: 'qa', label: 'QA' },
  { key: 'retro', label: 'Retro' },
];

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function agoText(mtimeMs: number): string {
  const deltaMs = Date.now() - mtimeMs;
  if (!Number.isFinite(deltaMs) || deltaMs < 60_000) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

export function readTimeline(artifactsDir: string): { rows: TimelineRow[]; totalCostText: string; totalTokens: number } {
  if (!artifactsDir || !existsSync(artifactsDir)) {
    return { rows: [], totalCostText: '', totalTokens: 0 };
  }
  const usage = readJsonFile(join(artifactsDir, '.agent-token-usage.json')) ?? {};
  const calls = Array.isArray(usage.calls) ? (usage.calls as Record<string, unknown>[]) : [];
  const totalCostUsd = typeof usage.totalCostUsd === 'number' ? usage.totalCostUsd : 0;
  const totalTokens = typeof usage.totalTokens === 'number' ? usage.totalTokens : 0;

  const rows: TimelineRow[] = TIMELINE_ROLES.map((role, seq) => {
    const path = join(artifactsDir, `.agent-status-${role.key}.json`);
    const raw = readJsonFile(path);
    if (raw === null) {
      return { seq, role: role.label, reached: false, verdict: '', model: '', costText: '', tokens: 0, completedAgo: '—' };
    }
    let roleCostUsd = 0;
    let roleTokens = 0;
    for (const call of calls) {
      if (call.role !== role.key) continue;
      roleCostUsd += typeof call.costUsd === 'number' ? call.costUsd : 0;
      roleTokens += typeof call.tokens === 'number' ? call.tokens : 0;
    }
    return {
      seq,
      role: role.label,
      reached: true,
      verdict: typeof raw.verdict === 'string' ? raw.verdict : '',
      model: typeof raw.model === 'string' ? raw.model : '',
      costText: `$${roleCostUsd.toFixed(2)}`,
      tokens: roleTokens,
      completedAgo: agoText(statSync(path).mtimeMs),
    };
  });
  return { rows, totalCostText: `$${totalCostUsd.toFixed(2)}`, totalTokens };
}

// PM questions require the exact `## Your answers` heading run-pipeline.sh
// checks for before resuming PM — refuses a second answer. Dev-review
// threads have no such gate; they're read semantically by the next agent
// turn, so this always just appends.
export async function submitAnswer(
  artifactsDir: string,
  answerText: string,
  isDevReview: boolean,
  repoRoot: string,
  slug: string
): Promise<{ resumeArgs: string[] }> {
  answerText = answerText.trim();
  const fileName = isDevReview ? 'pm-dev-thread.md' : 'pm-questions.md';
  const path = artifactsDir ? join(artifactsDir, fileName) : '';
  if (!path || !existsSync(path)) throw new Error(`${path || '(empty artifacts dir)'}: ${fileName} not found.`);
  if (!answerText) throw new Error('Answer cannot be empty.');
  const existing = readFileSync(path, 'utf-8');
  if (isDevReview) {
    writeFileSync(path, `${existing.replace(/\s+$/, '')}\n\n## Human response\n\n${answerText}\n\n**Status:** Resolved\n`);
  } else {
    if (/^## Your answers/m.test(existing)) throw new Error('This question has already been answered.');
    writeFileSync(path, `${existing.replace(/\s+$/, '')}\n\n## Your answers\n\n${answerText}\n`);
  }
  return { resumeArgs: [await runPipelinePath(repoRoot), slug, `--project-root=${repoRoot}`] };
}
