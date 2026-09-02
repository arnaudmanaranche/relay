// Unit tests for the read-only status aggregator (status.mjs).
// Run with: npm test
//
// status.mjs must never misreport a run's state — a dashboard app
// will act on it (e.g. surface "--approve-design"). These tests pin every
// branch of the classifier against synthetic fixtures built in a temp dir,
// using shapes copied verbatim from what run-pipeline.sh / agent-runner.ts
// actually write.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import {
  parseArgs,
  pidAlive,
  planHash,
  classifyRun,
  inspectWorktree,
  collectRepo,
  renderHuman,
} from '../skills/pipeline/scripts/status.mjs';

// --- helpers -------------------------------------------------------------

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'relay-status-test-'));
  return {
    base,
    path: (...parts) => join(base, ...parts),
    write(relPath, content) {
      const abs = join(base, relPath);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      return abs;
    },
    cleanup() {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

function statusJson(role, verdict) {
  return { role, slug: 'dark-mode', verdict: verdict ?? 'proceed', files: 1, artifacts: 0, model: 'm', promptSha: 'abc' };
}

describe('parseArgs', () => {
  test('defaults to cwd, human output', () => {
    const { json, roots } = parseArgs([]);
    assert.equal(json, false);
    assert.deepEqual(roots, [resolve(process.cwd())]);
  });

  test('--json sets machine output', () => {
    assert.equal(parseArgs(['--json']).json, true);
  });

  test('--project-root= and positional paths are both accepted and resolved', () => {
    const { roots } = parseArgs(['/tmp/a', '--project-root=/tmp/b']);
    assert.deepEqual(roots, [resolve('/tmp/a'), resolve('/tmp/b')]);
  });

  test('unknown flags throw instead of being silently ignored', () => {
    assert.throws(() => parseArgs(['--jso']), /Unknown flag/);
  });
});

describe('pidAlive', () => {
  test('own pid is alive, garbage/dead pids are not', () => {
    assert.equal(pidAlive(process.pid), true);
    assert.equal(pidAlive(99999999), false); // beyond any plausible max pid
    assert.equal(pidAlive(-1), false);
    assert.equal(pidAlive(0), false);
    assert.equal(pidAlive(NaN), false);
  });
});

describe('planHash', () => {
  // Must agree byte-for-byte with run-pipeline.sh's plan_hash()
  // (shasum -a 256 / sha256sum) or approval-staleness detection diverges.
  test('is sha256 hex of the content', () => {
    assert.equal(planHash('# plan'), createHash('sha256').update('# plan').digest('hex'));
  });
});

describe('classifyRun — mirrors run-pipeline.sh control flow', () => {
  const PLAN_HASH = planHash('technical plan');

  test('plan present, no approval marker → design gate', () => {
    const r = classifyRun({ hasPlan: true, verdicts: {}, lastRole: 'architect' });
    assert.equal(r.state, 'design-gate');
    assert.equal(r.resumeFlag, '--approve-design');
  });

  test('design gate defaults role to architect when no status file yet', () => {
    assert.equal(classifyRun({ hasPlan: true }).role, 'architect');
  });

  test('plan changed after approval → design gate again, flagged stale', () => {
    const r = classifyRun({ hasPlan: true, approvedHash: 'stale', currentPlanHash: PLAN_HASH, lastRole: 'architect' });
    assert.equal(r.state, 'design-gate');
    assert.equal(r.staleApproval, true);
  });

  test('approval hash matches → NOT the design gate, falls through', () => {
    const r = classifyRun({
      hasPlan: true,
      approvedHash: PLAN_HASH,
      currentPlanHash: PLAN_HASH,
      verdicts: {},
      lastRole: 'dev',
    });
    assert.notEqual(r.state, 'design-gate');
  });

  test('PM questions-for-human → blocked, before Architect ever ran', () => {
    const r = classifyRun({ hasPlan: false, verdicts: { pm: 'questions-for-human' }, lastRole: 'pm' });
    assert.equal(r.state, 'blocked-pm-questions');
    assert.equal(r.role, 'pm');
    assert.ok(r.detail);
  });

  test('precedence: PM questions-for-human beats a design gate leftover from a stale worktree', () => {
    const r = classifyRun({ hasPlan: true, verdicts: { pm: 'questions-for-human' }, lastRole: 'pm' });
    assert.equal(r.state, 'blocked-pm-questions');
  });

  test('unresolved dev-review questions → blocked', () => {
    const r = classifyRun({ hasPlan: false, verdicts: { 'dev-review': 'questions' }, lastRole: 'pm-respond' });
    assert.equal(r.state, 'blocked-dev-review');
    assert.equal(r.role, 'dev-review');
  });

  test('typecheck feedback file present → quality gates failing', () => {
    const r = classifyRun({ hasPlan: false, verdicts: {}, lastRole: 'dev', hasTypecheckFeedback: true });
    assert.equal(r.state, 'failed-typecheck');
    assert.equal(r.role, 'dev');
  });

  test('review FAIL → failed-review; QA FAIL → failed-qa', () => {
    assert.equal(classifyRun({ hasPlan: true, approvedHash: 'h', currentPlanHash: 'h', verdicts: { review: 'FAIL' }, lastRole: 'review' }).state, 'failed-review');
    assert.equal(classifyRun({ hasPlan: true, approvedHash: 'h', currentPlanHash: 'h', verdicts: { qa: 'FAIL' }, lastRole: 'qa' }).state, 'failed-qa');
  });

  test('nothing specific → generic halt', () => {
    const r = classifyRun({ hasPlan: false, verdicts: { pm: 'proceed' }, lastRole: 'pm' });
    assert.equal(r.state, 'halted');
    assert.ok(r.detail);
  });

  test('precedence: pending design gate beats later-stage verdict leftovers', () => {
    // A stale worktree can carry both an unapproved plan and an old review
    // FAIL from a previous attempt on the same slug — the gate comes first.
    const r = classifyRun({ hasPlan: true, verdicts: { review: 'FAIL' }, lastRole: 'review' });
    assert.equal(r.state, 'design-gate');
  });
});

describe('inspectWorktree — reads the files the pipeline writes', () => {
  test('live lock pid → running, cost and last role surfaced', () => {
    const fx = fixture();
    try {
      const art = '.relay-worktrees/myrepo-dark-mode/.relay/artifacts/features/dark-mode';
      fx.write(`${art}/.agent-status.json`, statusJson('dev'));
      fx.write(`${art}/.agent-token-usage.json`, { totalTokens: 42000, totalCostUsd: 2.41, calls: [] });
      fx.write(`.relay-worktrees/.locks/dark-mode/pid`, String(process.pid)); // provably alive

      const run = inspectWorktree({
        repoRoot: '/somewhere/myrepo',
        repoDirName: 'myrepo',
        entry: 'myrepo-dark-mode',
        worktreeRoot: fx.path('.relay-worktrees'),
        branchPrefix: 'feat',
      });
      assert.equal(run.slug, 'dark-mode');
      assert.equal(run.branch, 'feat/dark-mode');
      assert.equal(run.state, 'running');
      assert.equal(run.lastRole, 'dev');
      assert.equal(run.costUsd, 2.41);
      assert.equal(run.tokens, 42000);
      assert.equal(run.lock.alive, true);
    } finally {
      fx.cleanup();
    }
  });

  test('preserved worktree with unapproved plan → design gate + concrete resume hint', () => {
    const fx = fixture();
    try {
      const art = '.relay-worktrees/myrepo-auth/.relay/artifacts/features/auth';
      fx.write(`${art}/technical-plan.md`, '# plan');
      const run = inspectWorktree({
        repoRoot: '/somewhere/myrepo',
        repoDirName: 'myrepo',
        entry: 'myrepo-auth',
        worktreeRoot: fx.path('.relay-worktrees'),
        branchPrefix: 'feat',
      });
      assert.equal(run.state, 'design-gate');
      assert.match(run.resumeHint, /--approve-design --project-root=\/somewhere\/myrepo$/);
      assert.deepEqual(run.resumeArgs, [
        'skills/pipeline/scripts/run-pipeline.sh',
        'auth',
        '--approve-design',
        '--project-root=/somewhere/myrepo',
      ]);
    } finally {
      fx.cleanup();
    }
  });

  test('dead lock pid + no markers → crashed (stale lock)', () => {
    const fx = fixture();
    try {
      fx.write('.relay-worktrees/.locks/ghost/pid', String(99999999));
      const run = inspectWorktree({
        repoRoot: '/somewhere/myrepo',
        repoDirName: 'myrepo',
        entry: 'myrepo-ghost',
        worktreeRoot: fx.path('.relay-worktrees'),
        branchPrefix: 'feat',
      });
      assert.equal(run.state, 'crashed');
      assert.equal(run.lock.alive, false);
      assert.deepEqual(run.resumeArgs, [
        'skills/pipeline/scripts/run-pipeline.sh',
        'ghost',
        '--project-root=/somewhere/myrepo',
      ]);
    } finally {
      fx.cleanup();
    }
  });

  test('NO lock (clean exit via trap) + no markers → generic halt, not crashed', () => {
    const fx = fixture();
    try {
      const run = inspectWorktree({
        repoRoot: '/somewhere/myrepo',
        repoDirName: 'myrepo',
        entry: 'myrepo-quiet',
        worktreeRoot: fx.path('.relay-worktrees'),
        branchPrefix: 'feat',
      });
      assert.equal(run.lock, null);
      assert.equal(run.state, 'halted');
      assert.deepEqual(run.resumeArgs, [
        'skills/pipeline/scripts/run-pipeline.sh',
        'quiet',
        '--project-root=/somewhere/myrepo',
      ]);
    } finally {
      fx.cleanup();
    }
  });

  test('blocked-dev-review never gets a resumeArgs — needs a human answer first', () => {
    const fx = fixture();
    try {
      const art = '.relay-worktrees/myrepo-thread/.relay/artifacts/features/thread';
      fx.write(`${art}/.agent-status-dev-review.json`, JSON.stringify({ verdict: 'questions' }));
      const run = inspectWorktree({
        repoRoot: '/somewhere/myrepo',
        repoDirName: 'myrepo',
        entry: 'myrepo-thread',
        worktreeRoot: fx.path('.relay-worktrees'),
        branchPrefix: 'feat',
      });
      assert.equal(run.state, 'blocked-dev-review');
      assert.equal(run.resumeArgs, undefined);
      assert.equal(run.resumeHint, undefined);
    } finally {
      fx.cleanup();
    }
  });

  test('blocked-pm-questions never gets a resumeArgs — needs a human answer first', () => {
    const fx = fixture();
    try {
      const art = '.relay-worktrees/myrepo-newthing/.relay/artifacts/features/newthing';
      fx.write(`${art}/.agent-status-pm.json`, JSON.stringify({ verdict: 'questions-for-human' }));
      const run = inspectWorktree({
        repoRoot: '/somewhere/myrepo',
        repoDirName: 'myrepo',
        entry: 'myrepo-newthing',
        worktreeRoot: fx.path('.relay-worktrees'),
        branchPrefix: 'feat',
      });
      assert.equal(run.state, 'blocked-pm-questions');
      assert.equal(run.resumeArgs, undefined);
      assert.equal(run.resumeHint, undefined);
    } finally {
      fx.cleanup();
    }
  });
});

describe('collectRepo — whole-repo aggregation over a synthetic Relay repo', () => {
  function buildRepo(fx) {
    fx.write('myrepo/.relay/config.json', {
      project: {
        name: 'My Repo',
        githubRepo: 'me/myrepo',
        branchPrefix: 'feat',
        maxCostUsdPerFeature: 15,
      },
    });
    // Completed feature: merged artifacts in the main checkout.
    fx.write('myrepo/.relay/artifacts/features/shipped-thing/retrospective.md', '# retro');
    fx.write('myrepo/.relay/artifacts/features/shipped-thing/feature-brief.md', '# brief');
    // Active run: preserved worktree + live lock.
    const art = '.relay-worktrees/myrepo-dark-mode/.relay/artifacts/features/dark-mode';
    fx.write(`${art}/.agent-status.json`, statusJson('dev'));
    fx.write(`${art}/.agent-token-usage.json`, { totalTokens: 1000, totalCostUsd: 1.25, calls: [] });
    fx.write('.relay-worktrees/.locks/dark-mode/pid', String(process.pid));
    // Another repo's worktree sharing the parent dir — must be ignored.
    fx.write('.relay-worktrees/other-repo-x/.relay/artifacts/features/x/.agent-status.json', statusJson('qa'));
  }

  test('config, completed features, and only this repo\'s active runs', () => {
    const fx = fixture();
    try {
      buildRepo(fx);
      const repo = collectRepo(fx.path('myrepo'));
      assert.equal(repo.name, 'My Repo');
      assert.equal(repo.githubRepo, 'me/myrepo');
      assert.deepEqual(repo.budget, { maxCostUsdPerFeature: 15 });

      assert.equal(repo.active.length, 1);
      assert.equal(repo.active[0].slug, 'dark-mode');
      assert.equal(repo.active[0].state, 'running');

      assert.equal(repo.completed.length, 1);
      assert.equal(repo.completed[0].slug, 'shipped-thing');
      assert.equal(repo.completed[0].branch, 'feat/shipped-thing');
    } finally {
      fx.cleanup();
    }
  });

  test('non-Relay directory reports a clean error instead of throwing', () => {
    const fx = fixture();
    try {
      mkdirSync(fx.path('plain-dir'), { recursive: true });
      const repo = collectRepo(fx.path('plain-dir'));
      assert.equal(repo.error, 'no .relay/ directory — not a Relay repo');
    } finally {
      fx.cleanup();
    }
  });
});

describe('renderHuman — stable, greppable summary lines', () => {
  test('running + completed + budget line all appear', () => {
    const out = renderHuman([
      {
        root: '/somewhere/myrepo',
        name: 'My Repo',
        githubRepo: 'me/myrepo',
        budget: { maxCostUsdPerFeature: 15 },
        active: [
          {
            slug: 'dark-mode',
            branch: 'feat/dark-mode',
            worktree: '/wt',
            state: 'running',
            lastRole: 'dev',
            costUsd: 2.41,
            lock: { pid: 123, alive: true },
          },
        ],
        completed: [{ slug: 'shipped-thing', branch: 'feat/shipped-thing' }],
      },
    ]);
    assert.match(out, /My Repo — \/somewhere\/myrepo/);
    assert.match(out, /budget \$15\.00\/feature/);
    assert.match(out, /▶ dark-mode\s+running · last: dev · \$2\.41/);
    assert.match(out, /COMPLETED \(1\)/);
    assert.match(out, /✓ shipped-thing\s+feat\/shipped-thing/);
  });

  test('design gate prints its resume hint', () => {
    const out = renderHuman([
      {
        root: '/r',
        name: 'R',
        githubRepo: null,
        budget: { maxCostUsdPerFeature: null },
        active: [
          { slug: 'auth', state: 'design-gate', lastRole: 'architect', costUsd: null, resumeHint: 'bash skills/pipeline/scripts/run-pipeline.sh auth --approve-design --project-root=/r' },
        ],
        completed: [],
      },
    ]);
    assert.match(out, /awaiting design approval/);
    assert.match(out, /resume: bash skills\/pipeline\/scripts\/run-pipeline\.sh auth --approve-design/);
  });

  test('non-Relay repo renders its error line', () => {
    const out = renderHuman([{ root: '/x', name: 'x', error: 'no .relay/ directory — not a Relay repo' }]);
    assert.match(out, /no \.relay\/ directory/);
  });
});
