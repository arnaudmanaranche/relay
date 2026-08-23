# Relay Pipeline — Feature Development Pipeline

A structured multi-agent pipeline for AI-assisted feature development.
PM → Dev Review → Architect → Dev → Review → QA → Retro.

**Model-agnostic, stack-agnostic.** Works with any AI coding tool (Claude Code, Codex, OpenCode, Cline).

## Capabilities

| Command | Description |
|---------|-------------|
| `new <description>` | Start a new feature. Scopes the feature, generates feature-brief.md |
| `run --role <role> --slug <slug>` | Run a single agent role (pm, dev-review, pm-respond, architect, dev, review, qa, retro) |
| `pipeline --slug <slug>` | Run the full pipeline for a feature, end-to-end |

## Workflow stages

Each stage produces an artifact in `.ai/artifacts/features/<slug>/`.

### 1. PM — Product Manager
**Prompt:** `prompts/pm.md`
**Output:** `feature-brief.md` — requirements, acceptance criteria, i18n, analytics, paywall, scope

### 2. Dev Review + PM Respond (clarification loop)
**Prompts:** `prompts/dev-review.md`, inline pm-respond
**Output:** `pm-dev-thread.md` — structured Q&A between dev review and PM
**Gate:** Loops up to 3 times until status is `clear`. Exits with error on `blocked`.

### 3. Architect — Software Architect
**Prompt:** `prompts/architect.md`
**Output:** `technical-plan.md` (including a mandatory Mermaid diagram of the actual flow) + `repository-context.md` — architecture, impacted files, risks, implementation order
**Gate:** Diagram gate — a plan with no ` ```mermaid ` block triggers one automatic retry, then aborts if still missing. Design gate — the pipeline then pauses (exit 0) — no code is written until a human has read the plan and re-runs with `--approve-design`. A resumed run reuses the exact plan the human reviewed (it does not regenerate the non-deterministic Architect output), and the approval is bound to the plan's content hash stored in `.ai/artifacts/features/<slug>/.architect-approved`: if the plan changes afterward, the stored hash no longer matches and re-approval is required.

### 4. Dev — Developer
**Prompt:** `prompts/dev.md`
**Output:** Code changes + `dev-log.md` — implements the feature per the tech plan
**Gate:** Typecheck runs after Dev. One retry allowed with error feedback. Fails pipeline on second failure.

### 5. Review — Code Reviewer
**Prompt:** `prompts/review.md`
**Output:** `review-report.md` — checks implementation against the brief, including whether the git diff's actual control/data flow matches the Architect's diagram
**Gate:** FAIL verdict feeds the review findings back to Dev for one retry pass (typecheck re-runs, then Review runs again). Still FAIL after the retry halts the pipeline before QA and PR creation.

### 6. QA — Quality Assurance
**Prompt:** `prompts/qa.md`
**Output:** `qa-report.md` — validates E2E flows using the project's configured framework
**Gate:** FAIL verdict pushes the branch but skips PR creation.

### 7. Retro — Retrospective
**Prompt:** `prompts/retro.md`
**Output:** `retrospective.md` + merges learnings into `.ai/project-memory.md`'s four fixed categories (Pitfalls, Conventions confirmed, Architecture decisions, Integration notes). If a pattern has recurred essentially unchanged across 3+ features, also submits a skill proposal at `.ai/artifacts/skill-proposals/<name>.md` — a suggestion for a human to review, never applied automatically.
**Gate:** Evidence check — `verify-skill-proposals.mjs` counts how many slugs each proposal cites that actually appear as `(slug)` tags under Conventions confirmed in `.ai/project-memory.md`; fewer than 3 verifiable prints an advisory warning for the human reviewer (non-blocking — the tally is Retro's claim, this just makes it auditable).

### Memory Compact (periodic, not per-feature)
**Prompt:** `prompts/memory-compact.md`
**Trigger:** every `project.memoryCompactEvery` shipped features (default 10; both the counter and the memory file live on feature branches, so this only fires once merged PRs have carried the counter forward)
**Output:** deduplicated, pruned `.ai/project-memory.md`. Restricted at the permission layer to touch only that one file.

## Automation

Each stage can be executed via the agent-runner CLI:

```bash
node scripts/agent-runner.ts --role=<role> --slug=<slug> --project-root=<path>
```

Or run the full pipeline:

```bash
bash scripts/run-pipeline.sh <slug> [issue-body.md] [--dry-run] [--approve-design] [--project-root=<path>]
```

`--approve-design` skips the design gate (see stage 3) — pass it when the technical plan was already reviewed and approved out of band (e.g. a human approved the design-only commit/PR from a prior run). Without it, the pipeline stops after the Architect stage and tells you how to resume.

Once a PR is open, babysit its CI and (optionally) auto-approve low-risk PRs so a human isn't needed just to rerun a flaky job or rubber-stamp a one-line diff:

```bash
bash scripts/babysit-pr.sh <branch> [--max-reruns=2] [--poll-interval=30] [--max-polls=40] [--auto-stamp] [--max-diff-lines=300]
```

Polls `gh pr checks`, reruns failed jobs up to `--max-reruns` times (real infra flakiness, not a code-fix retry), then — only with `--auto-stamp` — approves the PR itself, but only when every signal already comes out of this pipeline's own gates: Review panel verdict `PASS`, QA verdict `PASS`, and the diff under `--max-diff-lines`. Anything short of that gets a comment explaining why, not a silent skip. Not called by `run-pipeline.sh` — CI can take anywhere from seconds to tens of minutes to settle, which has no business blocking the run that opened the PR. Run it by hand, or loop it externally.

### Status — what is Relay doing right now?

```bash
node scripts/status.mjs                 # human-readable table for this repo
node scripts/status.mjs --json          # machine-readable (one line per run state)
node scripts/status.mjs ~/proj-a ~/proj-b   # several Relay repos in one call
```

Read-only aggregation over state the pipeline already writes: live worktrees and their concurrency locks (`running` vs crashed), per-role verdict files, cumulative cost from `.agent-token-usage.json`, the design-gate approval hash (`awaiting design approval`, including the plan-changed-since-approval case), quality-gate feedback presence, and merged features under `.ai/artifacts/features/`. Never writes, never calls an LLM. The `--json` output is a stable contract intended for external consumers (menu-bar extras, dashboards): `{ generatedAt, repos: [{ root, name, budget, active: [{ slug, branch, state, lastRole, costUsd, lock, resumeHint }], completed }] }`. Run states: `running | design-gate | blocked-dev-review | failed-typecheck | failed-review | failed-qa | halted | crashed`.

## Workspace isolation

Every run — including `--dry-run` — executes inside a dedicated git worktree at `<parent-of-project-root>/.relay-worktrees/<project>-<slug>`, never in your active working directory. This makes the run fully reversible: delete the worktree, delete the branch, or both, without touching your own uncommitted work. The worktree is removed automatically once the pipeline reaches a PR; it is left in place (path printed to stdout) whenever the pipeline halts on a blocker, a failed gate, or exhausted retries, so you can inspect or resume from it directly.

## Registries

Reference these registries when scoping or reviewing features:

- `registries/scope-checklist.md` — 7 questions (IN/OUT, entry points, edge cases, etc.)
- `registries/ship-checklist.md` — pre-MR approval checklist
- `registries/analytics-events.md` — analytics signal registry (project-specific, in `.ai/registry/`)
- `registries/paywall-touchpoints.md` — paywall surface registry (project-specific, in `.ai/registry/`)

## Configuration

The module reads project configuration from `.ai/config.json`. Run the `relay-setup` skill to generate it.

Key config fields: `sourceDirs`, `skipDirs`, `sourceExtensions`, `commands`, `stack`, `e2e`.

`project.maxTokensPerFeature` and `project.maxCostUsdPerFeature` are both opt-in circuit breakers on cumulative spend per feature (across every stage and retry, tracked in `.agent-token-usage.json`) — undefined or 0 means unlimited. Track both, not just tokens: `.ai/agents.json` routinely assigns different models per role (e.g. a cheap model for `qa`/`dev-review`, a stronger one for `architect`/`dev`), so two features with the same token total can have very different real cost. Cost tracking is best-effort — it only populates when the backend reports it (`claude-cli` always does; the `openai-compatible` backend only does when the upstream provider returns `usage.cost`, e.g. OpenRouter with `usage.include: true`, sent automatically).

## Version

Current: 1.0.0
