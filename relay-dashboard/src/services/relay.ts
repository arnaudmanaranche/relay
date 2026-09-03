// relay service — ordinary TypeScript behind the effect boundary.
//
// Operations:
//   loadConfig()    reads ~/.config/relay-dashboard.json and resolves the
//                   status.mjs path.
//   loadTheme()     reads the chosen appearance out of the same file,
//                   separately, so it survives an unusable repo list.
//   fetchStatus()   spawns `node <statusScript> --json <roots...>` and maps
//                   the JSON into the shared boundary records. All parsing
//                   and process work lives here so src/core.ts stays in the
//                   deterministic subset (no JSON/regex/child_process there).
//   retryRun()      spawns a run's resumeArgs (argv, never a shell string —
//                   see shared.ts) detached, stdout/stderr to a log file
//                   next to the worktree, and returns immediately. The
//                   pipeline is a multi-minute LLM-driven process; the next
//                   poll of fetchStatus() picks up its state via the lock
//                   file it writes, same as any run started from a terminal.
//   openInEditor()  opens a path in VS Code: the `code` CLI if it's on
//                   PATH, else macOS `open -a "Visual Studio Code"`.
//
// The child carrier runs with an environment allowlist (HOME, PATH, …) and
// stdout reserved for framed transport — this file must never console.log.
//
// scriptc notes: `as` casts over parsed JSON are validating runtime checks,
// so every JSON interface declares CONCRETE field types; `unknown`-typed
// fields would make each later read a blocked dynamic operation.

import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ActiveRun,
  AppConfig,
  CompletedFeature,
  OpenInEditorRequest,
  OpenResult,
  ReadArtifactRequest,
  ReadArtifactResult,
  ReadLogRequest,
  ReadLogResult,
  ReadTimelineRequest,
  ReadTimelineResult,
  RepoSummary,
  RetryResult,
  RetryRunRequest,
  RunState,
  SaveReposRequest,
  SaveResult,
  SaveThemeRequest,
  StartRunRequest,
  StartRunResult,
  StatusRequest,
  StatusSnapshot,
  StopRunRequest,
  StopRunResult,
  SubmitAnswerRequest,
  SubmitAnswerResult,
  ThemeSettings,
  TimelineRow,
} from "../shared.ts";

function bytes(value: string): Uint8Array {
  return Buffer.from(value, "utf-8");
}

function decodeBytes(value: Uint8Array): string {
  return Buffer.from(value).toString("utf-8");
}

// Producer tags (hyphenated, status.mjs contract) -> boundary members.
function parseState(name: string): RunState {
  if (name === "running") return "running";
  if (name === "design-gate") return "designGate";
  if (name === "blocked-pm-questions") return "blockedPmQuestions";
  if (name === "blocked-dev-review") return "blockedDevReview";
  if (name === "failed-typecheck") return "failedTypecheck";
  if (name === "failed-review") return "failedReview";
  if (name === "failed-qa") return "failedQa";
  if (name === "halted") return "halted";
  if (name === "crashed") return "crashed";
  if (name === "done") return "done";
  return "halted";
}

// Chip text for the row's state <badge> — a NAME, not a sentence: it sits
// in a fixed-height pill, so anything longer than two words belongs in
// STATE_NOTES (the caption) or in the producer's own `detail` guidance.
const STATE_BADGES: Record<RunState, string> = {
  running: "running",
  designGate: "design gate",
  blockedPmQuestions: "PM questions",
  blockedDevReview: "clarifications",
  failedTypecheck: "typecheck FAIL",
  failedReview: "review FAIL",
  failedQa: "QA FAIL",
  halted: "halted",
  crashed: "crashed",
  done: "done",
};

// What the old one-line STATE_LABELS said BEYOND the badge name — kept as
// the caption's first segment so splitting the label into a chip loses no
// operator-relevant fact (that the QA failure still pushed a branch, that a
// done run leaves a worktree behind). Empty where the badge says it all.
const STATE_NOTES: Record<RunState, string> = {
  running: "",
  designGate: "awaiting design approval",
  blockedPmQuestions: "blocked on PM clarifying questions",
  blockedDevReview: "blocked on clarifications",
  failedTypecheck: "quality gates failing",
  failedReview: "",
  failedQa: "pushed, no PR",
  halted: "",
  crashed: "",
  done: "check PR / clean up worktree",
};

function usdText(n: number): string {
  return `$${n.toFixed(2)}`;
}

// The state itself now rides in the row's badge (STATE_BADGES), so a
// stale design approval is the one state fact still worth spelling out in
// the caption: the badge says "design gate" either way, and only the note
// distinguishes "never approved" from "approved, then the plan changed".
function stateNote(raw: RunEntry, state: RunState): string {
  if (state === "designGate" && raw.staleApproval === true) {
    return "plan changed since approval";
  }
  return STATE_NOTES[state];
}

// The core subset cannot concatenate bytes or format numbers, so the
// display caption is composed HERE where ordinary TS is available:
// "<note> · <role> · $<cost> · <model>", skipping missing parts.
function composeCaption(raw: RunEntry, state: RunState): string {
  const parts: string[] = [];
  const note = stateNote(raw, state);
  if (note.length > 0) parts.push(note);
  if (typeof raw.lastRole === "string" && raw.lastRole.length > 0) {
    parts.push(raw.lastRole);
  }
  if (typeof raw.costUsd === "number" && isFinite(raw.costUsd) && raw.costUsd >= 0) {
    parts.push(`$${raw.costUsd.toFixed(2)}`);
  }
  if (typeof raw.runModel === "string" && raw.runModel.length > 0) {
    parts.push(raw.runModel);
  }
  return parts.join(" · ");
}

interface ConfigFile {
  repos?: string[];
  statusScript?: string;
  theme?: string;
}

interface RunEntry {
  slug?: string;
  state?: string;
  lastRole?: string;
  costUsd?: number;
  runModel?: string;
  detail?: string;
  staleApproval?: boolean;
  resumeHint?: string;
  resumeArgs?: string[];
  worktree?: string;
  artifactsDir?: string;
  livePid?: number;
}

interface CompletedEntry {
  slug?: string;
  branch?: string;
}

interface RepoEntry {
  name?: string;
  root?: string;
  active?: RunEntry[];
  completed?: CompletedEntry[];
  error?: string;
  // status.mjs always includes this key (never omits it), with
  // maxCostUsdPerFeature explicitly null when unset — a legitimate
  // nullable value, not the omitted-vs-null optional-field mismatch
  // behind the costUsd/lastRole workaround elsewhere in this file.
  budget?: { maxCostUsdPerFeature?: number | null };
}

interface StatusFile {
  repos?: RepoEntry[];
}

function configPath(): string {
  // The child carrier only receives an allowlisted environment (path,
  // user/home/temp, locale, certs, proxy) — custom overrides never reach
  // this process, so the config location is fixed by convention.
  return join(homedir(), ".config", "relay-dashboard.json");
}

export function loadConfig(): AppConfig {
  let table: ConfigFile = {};
  if (existsSync(configPath())) {
    try {
      table = JSON.parse(readFileSync(configPath(), "utf-8")) as ConfigFile;
    } catch (e) {
      throw { kind: "config_invalid", message: `${configPath()}: ${(e as Error).message}` };
    }
  }

  const listedRepos = Array.isArray(table.repos) ? table.repos : [];
  const roots: string[] = [];
  for (const entry of listedRepos) {
    if (entry.length === 0) continue;
    roots.push(entry.startsWith("~") ? join(homedir(), entry.slice(1)) : entry);
  }

  // One status.mjs copy drives every root (it only reads files under the
  // roots it is given). Prefer an explicit override, else the standard
  // location inside the first configured root that has one.
  let script = typeof table.statusScript === "string" ? table.statusScript : "";
  if (!script) {
    const relative = join("skills", "pipeline", "scripts", "status.mjs");
    for (const root of roots) {
      const candidate = join(root, relative);
      if (existsSync(candidate)) {
        script = candidate;
        break;
      }
    }
  }
  if (!script || !existsSync(script)) {
    throw {
      kind: "no_status_script",
      message: `No skills/pipeline/scripts/status.mjs found for the repos in ${configPath()}`,
    };
  }

  let rootBytes: Uint8Array[] = [];
  for (const root of roots) {
    rootBytes = rootBytes.concat([bytes(root)]);
  }
  return { statusScript: bytes(script), roots: rootBytes };
}

// The chosen appearance, read on its own so a config whose repo list has
// no resolvable status.mjs (loadConfig throws there) still opens in the
// theme the user picked. An unknown/absent value is "system".
export function loadTheme(): ThemeSettings {
  let table: ConfigFile = {};
  if (existsSync(configPath())) {
    try {
      table = JSON.parse(readFileSync(configPath(), "utf-8")) as ConfigFile;
    } catch {
      // A malformed file is loadConfig's error to report — not a reason to
      // fail booting the window in the wrong appearance.
      return { theme: "system" };
    }
  }
  if (table.theme === "light") return { theme: "light" };
  if (table.theme === "dark") return { theme: "dark" };
  return { theme: "system" };
}

// Persist the chosen appearance. Written immediately on pick (the theme
// is not part of the settings window's Save/Cancel draft), through the
// same read-modify-write + atomic install saveRepos uses, so neither
// write drops the other's key.
export function saveTheme(request: SaveThemeRequest): SaveResult {
  const table = readConfigFile();
  writeConfigFile({ ...table, theme: request.theme });
  return { saved: true };
}

// Persist an edited repo list. Reads the existing file so unknown keys
// survive, normalizes entries the same way loadConfig reads them (trim,
// ~ expansion, dedupe, drop empties), and installs atomically (tmp+rename).
export function saveRepos(request: SaveReposRequest): SaveResult {
  const table = readConfigFile();

  const seen = new Set<string>();
  const repos: string[] = [];
  for (const raw of request.repos) {
    let entry = decodeBytes(raw).trim();
    if (entry.length === 0) continue;
    entry = entry.startsWith("~") ? join(homedir(), entry.slice(1)) : entry;
    if (seen.has(entry)) continue;
    seen.add(entry);
    repos.push(entry);
  }

  // The spread preserves every key the typed cast does not name.
  writeConfigFile({ ...table, repos });
  return { saved: true };
}

function readConfigFile(): ConfigFile {
  if (!existsSync(configPath())) return {};
  return JSON.parse(readFileSync(configPath(), "utf-8")) as ConfigFile;
}

// Atomic install (tmp + rename) so a half-written config never replaces a
// working one — every writer of ~/.config/relay-dashboard.json goes
// through here.
function writeConfigFile(next: ConfigFile): void {
  const path = configPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, path);
}

// argv[0] is resolved to an ABSOLUTE path here (repoRoot + the script's
// repoRoot-relative path status.mjs reports) rather than left relative:
// Cmd.ptySpawn (core.ts's run-detail window) has no cwd option, so a
// relative argv[0] would resolve against the app's own process cwd, not
// the repo. Absolute works for both consumers — ptySpawn (no cwd to set)
// and retryRun (still passes cwd: repoRoot, which is a no-op with an
// already-absolute argv[0]).
function resolvedResumeArgs(repoRoot: string, raw: readonly string[]): string[] {
  if (raw.length === 0) return [];
  return [join(repoRoot, raw[0]), ...raw.slice(1)];
}

function mapRun(repoName: string, repoRoot: string, raw: RunEntry): ActiveRun {
  const stateName = typeof raw.state === "string" ? raw.state : "";
  const state = parseState(stateName);
  const slug = typeof raw.slug === "string" ? raw.slug : "";
  const guidance = typeof raw.detail === "string" ? raw.detail : "";
  const resumeHint = typeof raw.resumeHint === "string" ? raw.resumeHint : "";
  const resumeArgs = Array.isArray(raw.resumeArgs) ? raw.resumeArgs : [];
  const worktree = typeof raw.worktree === "string" ? raw.worktree : "";
  const artifactsDir = typeof raw.artifactsDir === "string" ? raw.artifactsDir : "";
  const pid = typeof raw.livePid === "number" ? raw.livePid : 0;
  return {
    slug: bytes(slug),
    repoName: bytes(repoName),
    state,
    stateLabel: bytes(STATE_BADGES[state]),
    caption: bytes(composeCaption(raw, state)),
    guidance: bytes(guidance),
    staleApproval: raw.staleApproval === true,
    resumeHint: bytes(resumeHint),
    resumeArgs: resolvedResumeArgs(repoRoot, resumeArgs).map((arg) => bytes(arg)),
    repoRoot: bytes(repoRoot),
    worktree: bytes(worktree),
    artifactsDir: bytes(artifactsDir),
    pid,
  };
}

export function fetchStatus(request: StatusRequest): StatusSnapshot {
  const script = decodeBytes(request.config.statusScript);
  const roots = request.config.roots.map((root) => decodeBytes(root));
  if (!script || roots.length === 0) {
    throw { kind: "not_configured", message: "No Relay repos configured yet." };
  }

  let out: string;
  try {
    out = execFileSync("node", [script, "--json", ...roots], {
      encoding: "utf-8",
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    throw { kind: "spawn_failed", message: `node ${script} failed: ${(e as Error).message}` };
  }

  let parsed: StatusFile;
  try {
    parsed = JSON.parse(out) as StatusFile;
  } catch (e) {
    throw { kind: "bad_json", message: `status output was not JSON: ${(e as Error).message}` };
  }

  const listed = Array.isArray(parsed.repos) ? parsed.repos : [];
  const repos: RepoSummary[] = [];
  for (const entry of listed) {
    const repo = entry as RepoEntry;
    const nameRaw = typeof repo.name === "string" ? repo.name : "";
    const rootRaw = typeof repo.root === "string" ? repo.root : "";
    const name = nameRaw.length > 0 ? nameRaw : rootRaw;
    const activeRaw = Array.isArray(repo.active) ? repo.active : [];
    const completedRaw = Array.isArray(repo.completed) ? repo.completed : [];
    const completedCount = completedRaw.length;
    const errorText = typeof repo.error === "string" ? repo.error : "";
    let mapped: ActiveRun[] = [];
    if (errorText.length === 0) {
      for (const run of activeRaw) {
        mapped = mapped.concat([mapRun(name, rootRaw, run)]);
      }
    }
    // status.mjs already sorts most-recent-first; the panel only has
    // room for a handful, so cap what crosses the boundary.
    const completed: CompletedFeature[] = completedRaw.slice(0, 5).map((entry) => ({
      slug: bytes(typeof entry.slug === "string" ? entry.slug : ""),
      branch: bytes(typeof entry.branch === "string" ? entry.branch : ""),
    }));
    const maxBudgetUsd = typeof repo.budget?.maxCostUsdPerFeature === "number" ? repo.budget.maxCostUsdPerFeature : 0;
    repos.push({
      name: bytes(name),
      root: bytes(rootRaw),
      active: mapped,
      completedCount,
      completed,
      errorText: bytes(errorText),
      maxBudgetUsd,
      maxBudgetText: bytes(maxBudgetUsd > 0 ? usdText(maxBudgetUsd) : ""),
    });
  }
  return { repos };
}

// Shared by retryRun and startRun: spawns argv[0] (already absolute — see
// resolvedResumeArgs) with the rest as its arguments, detached, stdout/
// stderr appended to a fresh log file the caller's window polls (no
// push channel for this — see the ptySpawn note in shared.ts). Never
// awaited: the pipeline is a multi-minute, LLM-driven process, and the
// app already polls status.mjs every 5s, which will show it as `running`
// via the lock file run-pipeline.sh writes on its own.
function spawnDetachedLogged(
  repoRoot: string,
  args: readonly string[],
  logTag: string,
): { logPath: Uint8Array; pid: number } {
  const script = args[0];
  if (!existsSync(script)) {
    throw { kind: "script_missing", message: `${script} does not exist.` };
  }
  const logDir = join(tmpdir(), "relay-dashboard");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${logTag}-${Date.now()}.log`);
  const logFd = openSync(logPath, "a");
  let pid = 0;
  try {
    // detached: true puts this "bash <script>" child (== run-pipeline.sh's
    // own process — bash is what's interpreting it) in its own process
    // group, which is what makes stopRun's process-group SIGTERM able to
    // reach its descendants (the LLM CLI calls it shells out to) too.
    const child = spawn("bash", [script, ...args.slice(1)], {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    pid = child.pid ?? 0;
  } catch (e) {
    throw { kind: "spawn_failed", message: `spawn failed: ${(e as Error).message}` };
  } finally {
    closeSync(logFd);
  }
  return { logPath: bytes(logPath), pid };
}

// Fires the same command a human would paste from resumeHint, but as argv
// (see shared.ts) so nothing here goes through a shell.
export function retryRun(request: RetryRunRequest): RetryResult {
  const repoRoot = decodeBytes(request.repoRoot);
  const args = request.resumeArgs.map((arg) => decodeBytes(arg));
  if (!repoRoot || args.length === 0) {
    throw { kind: "not_resumable", message: "This run has no resume command." };
  }
  const slug = args[1] ?? "run";
  const { logPath, pid } = spawnDetachedLogged(repoRoot, args, `retry-${slug}`);
  return { started: true, logPath, pid };
}

// Starts a feature that has never run before: writes the issue text to a
// scratch file (run-pipeline.sh just copies whatever path it's given into
// the feature's artifacts, per its `cp "$ISSUE_BODY" ...`) and lets the
// script create the worktree itself — same spawn+log path as retryRun.
export function startRun(request: StartRunRequest): StartRunResult {
  const repoRoot = decodeBytes(request.repoRoot);
  const slug = decodeBytes(request.slug).trim();
  const issueText = decodeBytes(request.issueText).trim();
  if (!repoRoot || !slug) {
    throw { kind: "invalid_request", message: "A repo and a slug are required." };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw {
      kind: "invalid_slug",
      message: "Slug must be lowercase letters, digits, and hyphens only (e.g. dark-mode).",
    };
  }
  const scratchDir = join(tmpdir(), "relay-dashboard");
  mkdirSync(scratchDir, { recursive: true });
  const issuePath = join(scratchDir, `issue-${slug}-${Date.now()}.md`);
  writeFileSync(issuePath, `${issueText}\n`);
  const script = join(repoRoot, "skills/pipeline/scripts/run-pipeline.sh");
  const args = [script, slug, issuePath, `--project-root=${repoRoot}`];
  const { logPath, pid } = spawnDetachedLogged(repoRoot, args, `start-${slug}`);
  return { started: true, logPath, pid };
}

// SIGTERM to the process group first (reaches the CLI calls run-pipeline.sh
// shelled out to, not just the bash process itself — see
// spawnDetachedLogged's detached: true note), then the bare pid too in
// case it wasn't its own group leader (a run started directly in an
// interactive terminal, say). ESRCH (already dead) is not a failure —
// stopping an already-stopped run is a no-op, not an error.
export function stopRun(request: StopRunRequest): StopRunResult {
  const pid = request.pid;
  if (!pid || pid <= 0) {
    throw { kind: "no_pid", message: "No running process to stop." };
  }
  let signaled = false;
  try {
    process.kill(-pid, "SIGTERM");
    signaled = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") {
      throw { kind: "stop_failed", message: `Could not stop pid ${pid}: ${(e as Error).message}` };
    }
  }
  try {
    process.kill(pid, "SIGTERM");
    signaled = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH" && !signaled) {
      throw { kind: "stop_failed", message: `Could not stop pid ${pid}: ${(e as Error).message}` };
    }
  }
  return { stopped: true };
}

// Polled by the run-detail window while a retryRun-started process is
// live (no push channel for this — see the ptySpawn note in shared.ts).
// Reads the whole file each time: these are single-retry session logs,
// never large enough to make re-reading from the top wasteful.
export function readLog(request: ReadLogRequest): ReadLogResult {
  const path = decodeBytes(request.path);
  if (!path || !existsSync(path)) return { content: bytes("") };
  return { content: bytes(readFileSync(path, "utf-8")) };
}

// `code` (the VS Code CLI shim) if it's on PATH, else macOS `open -a`,
// which resolves the app by display name regardless of CLI shim install.
export function openInEditor(request: OpenInEditorRequest): OpenResult {
  const path = decodeBytes(request.path);
  if (!path || !existsSync(path)) {
    throw { kind: "path_missing", message: `${path || "(empty path)"} does not exist.` };
  }
  try {
    execFileSync("code", [path], { timeout: 10_000 });
    return { opened: true };
  } catch {
    // fall through to the macOS launcher below
  }
  try {
    execFileSync("open", ["-a", "Visual Studio Code", path], { timeout: 10_000 });
    return { opened: true };
  } catch (e) {
    throw { kind: "open_failed", message: `Could not open ${path} in VS Code: ${(e as Error).message}` };
  }
}

// 0 = technical-plan.md, 1 = pm-questions.md, 2 = pm-dev-thread.md (see
// shared.ts's ReadArtifactRequest.fileIndex doc).
const ARTIFACT_FILES = ["technical-plan.md", "pm-questions.md", "pm-dev-thread.md"];

export function readArtifact(request: ReadArtifactRequest): ReadArtifactResult {
  const artifactsDir = decodeBytes(request.artifactsDir);
  const fileName = ARTIFACT_FILES[request.fileIndex] ?? ARTIFACT_FILES[0];
  const path = artifactsDir ? join(artifactsDir, fileName) : "";
  if (!path || !existsSync(path)) {
    return { content: bytes(""), found: false };
  }
  return { content: bytes(readFileSync(path, "utf-8")), found: true };
}

// The pipeline's fixed role sequence — each writes its own
// .agent-status-<role>.json (verdict/model), independent of whether it
// has anything in .agent-token-usage.json's calls[] (a role can run
// without reporting cost, e.g. a backend that doesn't surface it).
const TIMELINE_ROLES: readonly { key: string; label: string }[] = [
  { key: "pm", label: "PM" },
  { key: "architect", label: "Architect" },
  { key: "dev", label: "Dev" },
  { key: "dev-review", label: "Dev Review" },
  { key: "pm-respond", label: "PM Respond" },
  { key: "review", label: "Review" },
  { key: "qa", label: "QA" },
  { key: "retro", label: "Retro" },
];

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function agoText(mtimeMs: number): string {
  const deltaMs = Date.now() - mtimeMs;
  if (!Number.isFinite(deltaMs) || deltaMs < 60_000) return "just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function readTimeline(request: ReadTimelineRequest): ReadTimelineResult {
  const artifactsDir = decodeBytes(request.artifactsDir);
  if (!artifactsDir || !existsSync(artifactsDir)) {
    return { rows: [], totalCostText: bytes(""), totalTokens: 0 };
  }

  const usage = readJsonFile(join(artifactsDir, ".agent-token-usage.json")) ?? {};
  const calls = Array.isArray(usage.calls) ? (usage.calls as Record<string, unknown>[]) : [];
  const totalCostUsd = typeof usage.totalCostUsd === "number" ? usage.totalCostUsd : 0;
  const totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : 0;

  const rows: TimelineRow[] = TIMELINE_ROLES.map((role, seq) => {
    const path = join(artifactsDir, `.agent-status-${role.key}.json`);
    const raw = readJsonFile(path);
    if (raw === null) {
      return {
        seq,
        role: bytes(role.label),
        reached: false,
        notReached: true,
        verdict: bytes(""),
        model: bytes(""),
        costText: bytes(""),
        tokens: 0,
        completedAgo: bytes("—"),
      };
    }
    let roleCostUsd = 0;
    let roleTokens = 0;
    for (const call of calls) {
      if (call.role !== role.key) continue;
      roleCostUsd += typeof call.costUsd === "number" ? call.costUsd : 0;
      roleTokens += typeof call.tokens === "number" ? call.tokens : 0;
    }
    return {
      seq,
      role: bytes(role.label),
      reached: true,
      notReached: false,
      verdict: bytes(typeof raw.verdict === "string" ? raw.verdict : ""),
      model: bytes(typeof raw.model === "string" ? raw.model : ""),
      costText: bytes(usdText(roleCostUsd)),
      tokens: roleTokens,
      completedAgo: bytes(agoText(statSync(path).mtimeMs)),
    };
  });

  return { rows, totalCostText: bytes(usdText(totalCostUsd)), totalTokens };
}

// PM questions (pm-questions.md) get appended under the exact
// `## Your answers` heading run-pipeline.sh checks for before it will
// resume PM (see run-pipeline.sh's PM_QUESTIONS_PATH guard) — refuses a
// second answer rather than silently appending a duplicate heading the
// script wouldn't parse as one section. Dev-review threads
// (pm-dev-thread.md) have no such script-level gate — they're read
// semantically by the next pm-respond/dev-review agent turn, which
// (per dev-review.md) treats a thread as answered once it has a
// "**Human response**" section marked "**Resolved**" — so this always
// just appends; there's no fixed heading to collide with.
export function submitAnswer(request: SubmitAnswerRequest): SubmitAnswerResult {
  const artifactsDir = decodeBytes(request.artifactsDir);
  const answerText = decodeBytes(request.answerText).trim();
  const fileName = request.isDevReview ? "pm-dev-thread.md" : "pm-questions.md";
  const path = artifactsDir ? join(artifactsDir, fileName) : "";
  if (!path || !existsSync(path)) {
    throw { kind: "file_missing", message: `${path || "(empty artifacts dir)"}: ${fileName} not found.` };
  }
  if (!answerText) {
    throw { kind: "empty_answer", message: "Answer cannot be empty." };
  }
  const existing = readFileSync(path, "utf-8");
  if (request.isDevReview) {
    writeFileSync(
      path,
      `${existing.replace(/\s+$/, "")}\n\n## Human response\n\n${answerText}\n\n**Status:** Resolved\n`,
    );
  } else {
    if (/^## Your answers/m.test(existing)) {
      throw { kind: "already_answered", message: "This question has already been answered." };
    }
    writeFileSync(path, `${existing.replace(/\s+$/, "")}\n\n## Your answers\n\n${answerText}\n`);
  }

  const repoRoot = decodeBytes(request.repoRoot);
  const slug = decodeBytes(request.slug);
  // Absolute argv[0] — same reason as resolvedResumeArgs above: this run
  // has no cwd/lock file to inherit from a live terminal session.
  const args = [
    join(repoRoot, "skills/pipeline/scripts/run-pipeline.sh"),
    slug,
    `--project-root=${repoRoot}`,
  ];
  return { submitted: true, resumeArgs: args.map((arg) => bytes(arg)) };
}
