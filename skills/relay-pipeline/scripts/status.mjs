#!/usr/bin/env node
// relay status — read-only dashboard over the pipeline's existing state files.
//
// The pipeline already writes everything needed to answer "what is Relay
// doing right now, and what is it waiting on?" — this script just reads those
// signals and aggregates them. It never writes, never calls an LLM, never
// touches the worktrees. A GUI (menu-bar extra, dashboard) should consume the
// --json output rather than reimplementing any of this.
//
// Signals consumed (all written by run-pipeline.sh / agent-runner.ts):
//   <parent-of-root>/.relay-worktrees/<repo>-<slug>/     preserved worktree = run in flight or halted
//   <parent-of-root>/.relay-worktrees/.locks/<slug>/pid  live pid = running; dead pid = crashed/stale
//   <worktree>/.ai/artifacts/features/<slug>/
//     .agent-status.json            last completed role (role, verdict, model)
//     .agent-status-<role>.json     per-role verdicts (review FAIL, qa FAIL, dev-review questions…)
//     .agent-token-usage.json       cumulative { totalTokens, totalCostUsd, calls[] }
//     technical-plan.md             present once the Architect has finished
//     .architect-approved           first line = sha256 of the approved plan (design gate)
//     .agent-typecheck-feedback.md  exists only while quality gates are failing
//   <root>/.ai/artifacts/features/<slug>/retrospective.md   merged/completed features
//
// Usage:
//   node status.mjs                       # current repo, human-readable table
//   node status.mjs --json                # machine-readable (feed a menu bar/dashboard with this)
//   node status.mjs ~/proj-a ~/proj-b     # several Relay repos in one invocation
//
// States (run.state): running | blocked-pm-questions | design-gate |
// blocked-dev-review | failed-typecheck | failed-review | failed-qa |
// halted | crashed

import { readFileSync, readdirSync, existsSync, realpathSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { pathToFileURL } from 'url';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Roles whose per-run status files carry decision-relevant verdicts.
const VERDICT_ROLES = ['pm', 'dev-review', 'pm-respond', 'architect', 'dev', 'review', 'qa', 'retro'];

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function readFileSafe(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

// Same digest run-pipeline.sh's plan_hash() records into .architect-approved
// (shasum -a 256 / sha256sum), so approval-staleness checks agree exactly.
export function planHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but is owned by someone else — alive.
    return e.code === 'EPERM';
  }
}

export function parseArgs(argv) {
  let json = false;
  const roots = [];
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('--project-root=')) roots.push(arg.slice('--project-root='.length));
    else if (!arg.startsWith('--')) roots.push(arg);
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return { json, roots: roots.length ? roots.map(r => resolve(r)) : [resolve(process.cwd())] };
}

// Pure classifier: map the state files' contents to one run state. All IO
// happens in the caller so tests can exercise every branch without fixtures.
//
// Order matters and mirrors run-pipeline.sh's control flow:
//   1. PM still on "questions-for-human" → clarification halt, the
//      earliest possible pipeline stage (before Architect ever runs).
//   2. plan present + no matching .architect-approved → design gate pause
//      (exit 0). Hash mismatch means the plan changed after approval —
//      re-approval required, surfaced as staleApproval.
//   3. dev-review still on "questions" after MAX_LOOPS → clarification halt.
//   4. typecheck feedback file exists → quality gates failing (it's deleted
//      on success, so its presence IS the failure signal).
//   5. review FAIL after retry → halted before QA.
//   6. qa FAIL → branch pushed but no PR.
//   7. anything else with a preserved worktree → generic halt (crashed,
//      killed terminal, unknown).
export function classifyRun({
  hasPlan,
  approvedHash = null,
  currentPlanHash = null,
  verdicts = {},
  lastRole = null,
  hasTypecheckFeedback = false,
}) {
  if (verdicts.pm === 'questions-for-human') {
    return { state: 'blocked-pm-questions', role: 'pm', detail: 'PM has clarifying questions before it can write a confident brief — answer them in pm-questions.md, then re-run.' };
  }
  if (hasPlan && !approvedHash) {
    return { state: 'design-gate', role: lastRole || 'architect', resumeFlag: '--approve-design' };
  }
  if (hasPlan && approvedHash !== currentPlanHash) {
    return { state: 'design-gate', role: lastRole || 'architect', resumeFlag: '--approve-design', staleApproval: true };
  }
  if (verdicts['dev-review'] === 'questions') {
    return { state: 'blocked-dev-review', role: 'dev-review', detail: 'Unresolved clarification threads after max loops — answer them in pm-dev-thread.md, then re-run.' };
  }
  if (hasTypecheckFeedback) {
    return { state: 'failed-typecheck', role: lastRole || 'dev', detail: 'Quality gates failing — see .agent-typecheck-feedback.md. Re-run to retry Dev.' };
  }
  if (verdicts.review === 'FAIL') {
    return { state: 'failed-review', role: 'review', resumeFlag: '', detail: 'Review FAIL after retry — pipeline halted before QA/PR. See review-report.md.' };
  }
  if (verdicts.qa === 'FAIL') {
    return { state: 'failed-qa', role: 'qa', detail: 'QA FAIL — branch pushed but no PR created. Fix issues, then open a PR manually or re-run.' };
  }
  return { state: 'halted', role: lastRole, detail: 'Worktree preserved but no live lock and no specific gate marker — likely a crash or interrupted run. Re-run to resume.' };
}

// Inspect one preserved/live worktree entry (`<repoName>-<slug>`).
export function inspectWorktree({ repoRoot, repoDirName, entry, worktreeRoot, branchPrefix }) {
  const slug = entry.slice(repoDirName.length + 1);
  const worktreeDir = join(worktreeRoot, entry);
  const artDir = join(worktreeDir, '.ai', 'artifacts', 'features', slug);

  let lock = null;
  const rawPid = readFileSafe(join(worktreeRoot, '.locks', slug, 'pid'));
  if (rawPid !== null) {
    const pid = parseInt(rawPid.trim(), 10);
    lock = { pid, alive: pidAlive(pid) };
  }

  const generic = readJsonSafe(join(artDir, '.agent-status.json'));
  const verdicts = {};
  for (const role of VERDICT_ROLES) {
    const s = readJsonSafe(join(artDir, `.agent-status-${role}.json`));
    if (s && typeof s.verdict === 'string') verdicts[role] = s.verdict;
  }

  const usage = readJsonSafe(join(artDir, '.agent-token-usage.json')) || {};
  const costUsd = typeof usage.totalCostUsd === 'number' ? usage.totalCostUsd : null;
  const tokens = typeof usage.totalTokens === 'number' ? usage.totalTokens : null;

  const planContent = readFileSafe(join(artDir, 'technical-plan.md'));
  const approvedHash = (readFileSafe(join(artDir, '.architect-approved')) || '').trim().split('\n')[0] || null;

  const cls = classifyRun({
    hasPlan: planContent !== null,
    approvedHash,
    currentPlanHash: planContent !== null ? planHash(planContent) : null,
    verdicts,
    lastRole: generic ? generic.role : null,
    hasTypecheckFeedback: existsSync(join(artDir, '.agent-typecheck-feedback.md')),
  });

  const run = {
    slug,
    branch: `${branchPrefix}/${slug}`,
    worktree: worktreeDir,
    artifactsDir: artDir,
    lock,
    lastRole: generic ? generic.role : null,
    model: generic ? generic.model ?? null : null,
    costUsd,
    tokens,
    verdicts,
    ...cls,
  };
  // Lock semantics mirror run-pipeline.sh's concurrency lock: the lock dir
  // only exists while the pipeline process is alive (its EXIT trap removes
  // it), so its ABSENCE is the normal post-exit state — every gate pause and
  // halt leaves none behind.
  //   lock + live pid  → running right now
  //   lock + dead pid  → hard crash (SIGKILL/power loss): stale lock
  //   no lock          → exited cleanly; classify by the artifacts alone
  if (lock && lock.alive) {
    run.state = 'running';
    run.resumeFlag = undefined;
    run.detail = undefined;
  } else if (lock && !lock.alive) {
    run.state = 'crashed';
    run.detail = 'Stale lock from a dead process — the run died without cleanup (SIGKILL?). Remove the lock and re-run.';
  }
  // A resume command makes sense for any halted/failed/gated state — not
  // just design-gate. blocked-dev-review and blocked-pm-questions are
  // deliberately excluded: both need a human to answer a file first
  // (pm-dev-thread.md / pm-questions.md), so a bare re-run would just halt
  // the same way again. resumeArgs is the same command as resumeHint
  // (the display string), but as argv — a programmatic consumer (e.g. the
  // menu-bar app's Retry button) must never shell out `resumeHint` as a
  // string, since slug/repoRoot ultimately come from the filesystem.
  if (run.state !== 'running' && run.state !== 'blocked-dev-review' && run.state !== 'blocked-pm-questions') {
    const args = ['skills/relay-pipeline/scripts/run-pipeline.sh', slug];
    if (run.resumeFlag) args.push(run.resumeFlag);
    args.push(`--project-root=${repoRoot}`);
    run.resumeHint = `bash ${args.join(' ')}`;
    run.resumeArgs = args;
  }
  return run;
}

export function collectRepo(rootArg) {
  const root = resolve(rootArg);
  const repoDirName = basename(root);
  if (!existsSync(join(root, '.ai'))) {
    return { root, name: repoDirName, error: 'no .ai/ directory — not a Relay repo' };
  }
  const config = readJsonSafe(join(root, '.ai', 'config.json')) || {};
  const project = config.project || {};
  const branchPrefix = project.branchPrefix || 'feat';
  const worktreeRoot = join(dirname(root), '.relay-worktrees');

  const active = [];
  if (existsSync(worktreeRoot)) {
    for (const entry of readdirSync(worktreeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.locks') continue;
      // Worktrees are named `<repoBasename>-<slug>`; ignore other repos'
      // worktrees sharing the same parent dir.
      if (!entry.name.startsWith(`${repoDirName}-`)) continue;
      try {
        active.push(inspectWorktree({ repoRoot: root, repoDirName, entry: entry.name, worktreeRoot, branchPrefix }));
      } catch (e) {
        active.push({ slug: entry.name.slice(repoDirName.length + 1), state: 'halted', detail: `unreadable (${e.message})`, worktree: join(worktreeRoot, entry.name) });
      }
    }
  }

  // Completed features live in the main checkout only after their PR merges
  // (artifacts are committed to the feature branch). Debug/status/cost files
  // are gitignored, so cost is only known for runs with a surviving worktree.
  const completed = [];
  const featuresDir = join(root, '.ai', 'artifacts', 'features');
  const activeSlugs = new Set(active.map(a => a.slug));
  if (existsSync(featuresDir)) {
    for (const entry of readdirSync(featuresDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (!existsSync(join(featuresDir, entry.name, 'retrospective.md'))) continue;
      const feature = { slug: entry.name, branch: `${branchPrefix}/${entry.name}` };
      if (activeSlugs.has(entry.name)) feature.note = 'also has a worktree — re-running a previously shipped slug?';
      completed.push(feature);
    }
  }

  return {
    root,
    name: project.name || repoDirName,
    githubRepo: project.githubRepo || null,
    budget: { maxCostUsdPerFeature: project.maxCostUsdPerFeature ?? null },
    active,
    completed,
  };
}

const STATE_GLYPHS = {
  running: '▶',
  'blocked-pm-questions': '?',
  'design-gate': '⏸',
  'blocked-dev-review': '?',
  'failed-typecheck': '✗',
  'failed-review': '✗',
  'failed-qa': '✗',
  halted: '! ',
  crashed: '☠',
};

const STATE_LABELS = {
  running: 'running',
  'blocked-pm-questions': 'blocked on PM clarifying questions',
  'design-gate': 'awaiting design approval',
  'blocked-dev-review': 'blocked on clarifications',
  'failed-typecheck': 'quality gates failing',
  'failed-review': 'review FAIL (pre-QA)',
  'failed-qa': 'QA FAIL (pushed, no PR)',
  halted: 'halted',
  crashed: 'crashed',
};

function usd(n) {
  return n === null || n === undefined ? '—' : `$${n.toFixed(2)}`;
}

export function renderHuman(repos) {
  const lines = [];
  for (const repo of repos) {
    lines.push('');
    lines.push(`${repo.name} — ${repo.root}${repo.githubRepo ? `  (${repo.githubRepo})` : ''}`);
    if (repo.error) {
      lines.push(`  ${repo.error}`);
      continue;
    }
    const budgetNote =
      repo.budget.maxCostUsdPerFeature != null ? ` · budget $${repo.budget.maxCostUsdPerFeature.toFixed(2)}/feature` : '';
    if (repo.active.length === 0 && repo.completed.length === 0) {
      lines.push(`  idle — no runs, no completed features${budgetNote}`);
      continue;
    }
    if (repo.active.length > 0) {
      lines.push(`  ACTIVE${budgetNote}`);
      for (const run of repo.active) {
        const glyph = STATE_GLYPHS[run.state] || ' ';
        const label = STATE_LABELS[run.state] || run.state;
        const stage = run.lastRole ? ` · last: ${run.lastRole}` : '';
        const cost = run.costUsd !== null ? ` · ${usd(run.costUsd)}` : '';
        const stale = run.staleApproval ? ' (plan changed since approval)' : '';
        lines.push(`  ${glyph} ${run.slug.padEnd(24)} ${label}${stale}${stage}${cost}`);
        if (run.detail) lines.push(`      ${run.detail}`);
        if (run.resumeHint) lines.push(`      resume: ${run.resumeHint}`);
        else if (run.state === 'running') lines.push(`      worktree: ${run.worktree} (pid ${run.lock.pid})`);
      }
    } else if (repo.completed.length > 0) {
      lines.push(`  no active runs${budgetNote}`);
    }
    if (repo.completed.length > 0) {
      lines.push(`  COMPLETED (${repo.completed.length})`);
      for (const f of repo.completed) {
        lines.push(`  ✓ ${f.slug.padEnd(24)} ${f.branch}${f.note ? `  (${f.note})` : ''}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function collect(roots) {
  return roots.map(collectRepo);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`status.mjs: ${e.message}`);
    console.error('Usage: node status.mjs [--json] [--project-root=<path>] [repo-path...]');
    process.exit(2);
  }
  const repos = collect(args.roots);
  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), repos }, null, 2));
  } else {
    console.log(renderHuman(repos).trimEnd());
  }
}

// Same isMain guard as agent-runner.ts: argv[1] must be realpath'd before
// comparing — on macOS an ancestor symlink (/tmp -> /private/tmp) makes the
// raw strings differ and main() would silently never run.
function isMain() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  main();
}
