// relay service — ordinary TypeScript behind the effect boundary.
//
// Operations:
//   loadConfig()    reads ~/.config/relay-menubar.json and resolves the
//                   status.mjs path.
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
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ActiveRun,
  AppConfig,
  OpenInEditorRequest,
  OpenResult,
  RepoSummary,
  RetryResult,
  RetryRunRequest,
  RunState,
  SaveReposRequest,
  SaveResult,
  StatusRequest,
  StatusSnapshot,
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
  if (name === "blocked-dev-review") return "blockedDevReview";
  if (name === "failed-typecheck") return "failedTypecheck";
  if (name === "failed-review") return "failedReview";
  if (name === "failed-qa") return "failedQa";
  if (name === "halted") return "halted";
  if (name === "crashed") return "crashed";
  return "halted";
}

const STATE_LABELS: Record<RunState, string> = {
  running: "running",
  designGate: "awaiting design approval",
  blockedDevReview: "blocked on clarifications",
  failedTypecheck: "quality gates failing",
  failedReview: "review FAIL",
  failedQa: "QA FAIL — pushed, no PR",
  halted: "halted",
  crashed: "crashed",
};

// The core subset cannot concatenate bytes or format numbers, so the
// display caption is composed HERE where ordinary TS is available:
// "<state> · <role> · $<cost> · <model>", skipping missing parts.
function composeCaption(raw: RunEntry, state: RunState): string {
  const parts: string[] = [
    raw.staleApproval === true
      ? "plan changed since approval"
      : STATE_LABELS[state],
  ];
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
}

interface StatusFile {
  repos?: RepoEntry[];
}

function configPath(): string {
  // The child carrier only receives an allowlisted environment (path,
  // user/home/temp, locale, certs, proxy) — custom overrides never reach
  // this process, so the config location is fixed by convention.
  return join(homedir(), ".config", "relay-menubar.json");
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
    const relative = join("skills", "relay-pipeline", "scripts", "status.mjs");
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
      message: `No skills/relay-pipeline/scripts/status.mjs found for the repos in ${configPath()}`,
    };
  }

  let rootBytes: Uint8Array[] = [];
  for (const root of roots) {
    rootBytes = rootBytes.concat([bytes(root)]);
  }
  return { statusScript: bytes(script), roots: rootBytes };
}

// Persist an edited repo list. Reads the existing file so unknown keys
// survive, normalizes entries the same way loadConfig reads them (trim,
// ~ expansion, dedupe, drop empties), and installs atomically (tmp+rename).
export function saveRepos(request: SaveReposRequest): SaveResult {
  const path = configPath();
  let table: ConfigFile = {};
  if (existsSync(path)) {
    table = JSON.parse(readFileSync(path, "utf-8")) as ConfigFile;
  }

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
  const next = { ...table, repos };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, path);
  return { saved: true };
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
  return {
    slug: bytes(slug),
    repoName: bytes(repoName),
    state,
    caption: bytes(composeCaption(raw, state)),
    guidance: bytes(guidance),
    staleApproval: raw.staleApproval === true,
    resumeHint: bytes(resumeHint),
    resumeArgs: resumeArgs.map((arg) => bytes(arg)),
    repoRoot: bytes(repoRoot),
    worktree: bytes(worktree),
    artifactsDir: bytes(artifactsDir),
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
    const completedCount = Array.isArray(repo.completed) ? repo.completed.length : 0;
    const errorText = typeof repo.error === "string" ? repo.error : "";
    let mapped: ActiveRun[] = [];
    if (errorText.length === 0) {
      for (const run of activeRaw) {
        mapped = mapped.concat([mapRun(name, rootRaw, run)]);
      }
    }
    repos.push({
      name: bytes(name),
      root: bytes(rootRaw),
      active: mapped,
      completedCount,
      errorText: bytes(errorText),
    });
  }
  return { repos };
}

// Fires the same command a human would paste from resumeHint, but as argv
// (see shared.ts) so nothing here goes through a shell. Detached + logged
// to a file rather than awaited: the pipeline is a multi-minute, LLM-driven
// process, and the app already polls status.mjs every 5s, which will show
// it as `running` via the lock file run-pipeline.sh writes on its own.
export function retryRun(request: RetryRunRequest): RetryResult {
  const repoRoot = decodeBytes(request.repoRoot);
  const args = request.resumeArgs.map((arg) => decodeBytes(arg));
  if (!repoRoot || args.length === 0) {
    throw { kind: "not_resumable", message: "This run has no resume command." };
  }
  const script = join(repoRoot, args[0]);
  if (!existsSync(script)) {
    throw { kind: "script_missing", message: `${script} does not exist.` };
  }

  const slug = args[1] ?? "run";
  const logDir = join(tmpdir(), "relay-menubar");
  mkdirSync(logDir, { recursive: true });
  const logFd = openSync(join(logDir, `retry-${slug}-${Date.now()}.log`), "a");
  try {
    const child = spawn("bash", [script, ...args.slice(1)], {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
  } catch (e) {
    throw { kind: "spawn_failed", message: `retry spawn failed: ${(e as Error).message}` };
  } finally {
    closeSync(logFd);
  }
  return { started: true };
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
