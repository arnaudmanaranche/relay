# Relay

**A structured, multi-agent pipeline for AI-assisted feature development. Model-agnostic, stack-agnostic.**

Each role produces artifacts, gates, and handoffs, so shipping a feature with an AI agent looks like shipping one with a team, not a single unreviewed diff.

[Full documentation](docs/index.html): pipeline stages, role anatomy, safety model, configuration reference, backends, roadmap.

[Design principles & guarantees](https://github.com/arnaudmanaranche/relay/wiki/Design-Principles-and-Guarantees): trust, auditability, bounded growth, measurable self-improvement.

```
  SCOPE           CLARIFY         DESIGN          BUILD           REVIEW          VERIFY          LEARN
 ┌──────┐      ┌──────────┐    ┌──────────┐    ┌──────┐       ┌────────┐     ┌──────┐        ┌───────┐
 │  PM  │ ───▶ │Dev Review│ ─▶ │Architect │ ─▶ │  Dev │ ────▶ │ Review │ ──▶ │  QA  │ ─────▶ │ Retro │
 │Brief │      │   Q&A    │    │   Plan   │    │ Code │       │ Verdict│     │Verify│        │Memory │
 └──────┘      └──────────┘    └──────────┘    └──────┘       └────────┘     └──────┘        └───────┘
```

---

## Install

**Prerequisites:** Node.js 18+, an AI coding tool (Claude Code, Codex, OpenCode, Cline), and a BMad Method installation (`npx bmad-method`).

```bash
npx bmad-method install --custom-source https://github.com/arnaudmanaranche/relay
```

<details>
<summary><b>Claude Code</b></summary>

```bash
/start relay-setup
```

Or interactively: "Run the Relay setup skill."

</details>

<details>
<summary><b>Codex / OpenCode / Cline / other agents</b></summary>

Skills are plain Markdown with accompanying scripts. Any agent that can read a `SKILL.md` and run shell commands can drive the pipeline. Point your agent at `skills/relay-setup/SKILL.md` first, then `skills/relay-pipeline/SKILL.md`.

</details>

`relay-setup` auto-detects your stack and generates `.ai/config.json` and `.ai/agents.json`, plus governance files, registries, and a `.ai/.gitignore` under `.ai/`.

## Quick start

Start a feature:

```bash
/start relay-pipeline new "Add dark mode toggle"
```

Or interactively: "Run the Relay pipeline to scope a new feature."

This runs the 7-role workflow (PM → Dev Review → Architect → Dev → Review → QA → Retro) end to end inside an isolated git worktree, from brief to PR. The Architect stage pauses for a human design-gate review before code is written; resume with:

```bash
bash skills/relay-pipeline/scripts/run-pipeline.sh my-feature --approve-design
```

## Launch

Check what Relay is doing right now: running/halted/crashed runs, design-gate approvals waiting on you, failed gates, cost, completed features, across one or many repos.

```bash
node skills/relay-pipeline/scripts/status.mjs                  # human-readable
node skills/relay-pipeline/scripts/status.mjs --json           # machine-readable, for dashboards/menu bars
```

Babysit a PR after it's open (polls CI, reruns flaky jobs, optionally auto-approves once Review/QA/diff-size gates all pass):

```bash
bash skills/relay-pipeline/scripts/babysit-pr.sh <branch> --max-reruns=3 --auto-stamp
```

[relay-menubar](relay-menubar/README.md) is a macOS menu-bar app that polls `status.mjs` every 5s across your repos, flags runs needing attention (design gate, review/QA FAIL, crash, halt), and lets you reveal the worktree or copy a resume command. Read-only.

For configuration (models, effort, backends, batching, review panel size, E2E wiring), the safety model, and everything else, see the [full documentation](docs/index.html).

---

## Why Relay?

AI coding agents default to the shortest path from prompt to diff, which usually means no scoping, no design review, no QA, and no memory of what was tried before. Relay forces the same discipline a human team applies before merging: a written brief, a reviewed technical plan with a diagram, a code review against that plan, a QA verdict, and a retro that feeds back into the next feature. Every gate exists because skipping it is exactly where an unsupervised agent goes wrong.

---

## Development

This repo itself has dev-only tooling (`package.json`, `test/`, not published, not installed by consumers) to unit-test the pipeline's scripts:

```bash
npm install
npm test
npm run eval    # score pipeline output quality against golden rubric cases
```

`.github/workflows/test.yml` runs both on every push and PR to `main`. The eval harness also powers a provenance-keyed A/B loop for improving the pipeline's own prompts; see the Eval section of the [full documentation](docs/index.html).

## Versioning

This module follows semver. Changelog is maintained in GitHub Releases.

## License

MIT
