# Relay

**A gated pipeline for the features your coding agent writes. Model-agnostic, stack-agnostic.**

Built for solo builders who ship with an agent and have no team to catch what it got wrong. Seven roles — brief, plan, build, review, QA, retro — each producing a real artifact, with every handoff gated by a check enforced in code rather than asked for in a prompt.

Relay is not another coding agent. It's the process around the one you already use.

[Full documentation](docs/index.html): how a run works stage by stage, the safety model, where Relay sits among agent tooling, and the configuration reference.

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

**Prerequisites:** Node.js 18+ and an AI coding tool (Claude Code, Codex, OpenCode, Cline).

<details>
<summary><b>Claude Code</b></summary>

```bash
/plugin marketplace add arnaudmanaranche/relay
/plugin install relay@relay
```

Then run setup:

```bash
/relay:setup
```

Or interactively: "Run the Relay setup skill."

</details>

<details>
<summary><b>Codex / OpenCode / Cline / other agents</b></summary>

Skills are plain Markdown with accompanying scripts. Any agent that can read a `SKILL.md` and run shell commands can drive the pipeline. Clone this repo (or copy `skills/`) into the target project, then point your agent at `skills/setup/SKILL.md` first, then `skills/pipeline/SKILL.md`.

</details>

`setup` auto-detects your stack and generates `.relay/config.json` and `.relay/agents.json`, plus governance files, registries, and a `.relay/.gitignore` under `.relay/`.

## Quick start

Start a feature:

```bash
/relay:new "Add dark mode toggle"
```

Or interactively: "Run the Relay pipeline to scope a new feature."

This runs the 7-role workflow (PM → Dev Review → Architect → Dev → Review → QA → Retro) end to end inside an isolated git worktree, from brief to PR. The Architect stage pauses for a human design-gate review before code is written; resume with:

```bash
/relay:resume --slug my-feature --approve-design
```

## Launch

Check what Relay is doing right now: running/halted/crashed runs, design-gate approvals waiting on you, failed gates, cost, completed features, across one or many repos.

```bash
node skills/pipeline/scripts/status.mjs                  # human-readable
node skills/pipeline/scripts/status.mjs --json           # machine-readable, for dashboards/menu bars
```

Babysit a PR after it's open (polls CI, reruns flaky jobs, optionally auto-approves once Review/QA/diff-size gates all pass):

```bash
bash skills/pipeline/scripts/babysit-pr.sh <branch> --max-reruns=3 --auto-stamp
```

[relay-menubar](relay-menubar/README.md) is a macOS menu-bar app that polls `status.mjs` every 5s across your repos, flags runs needing attention (design gate, review/QA FAIL, crash, halt), and lets you reveal the worktree or copy a resume command. Read-only.

For configuration (models, effort, backends, batching, review panel size, E2E wiring), the safety model, and everything else, see the [full documentation](docs/index.html).

---

## Why Relay?

On a team, five people touch a feature before it merges: someone writes down what it should do, someone plans it, someone builds it, someone reviews the diff against that plan, someone verifies it works. Building solo with an agent, all five collapse into one prompt and one diff you skim at midnight.

Relay puts the five back. A written brief, a technical plan with a diagram that **you** approve before code exists, a code review against that plan, a QA verdict from real E2E results, and a retro that feeds the next feature. Every gate exists because skipping it is exactly where an unsupervised agent goes wrong.

It is deliberately not for everyone: it costs more time and tokens per feature, and it stops and waits for a human at the design gate on purpose. If you're prototyping something disposable, prompt your agent directly.

---

## Development

This repo itself has dev-only tooling (`package.json`, `test/`, not published, not installed by consumers) to unit-test the pipeline's scripts:

```bash
npm install
npm test
npm run eval    # score pipeline output quality against golden rubric cases
```

`.github/workflows/test.yml` runs both on every push and PR to `main`. The eval harness also powers a provenance-keyed A/B loop for improving the pipeline's own prompts.

## Versioning

This module follows semver. Changelog is maintained in GitHub Releases.

## License

MIT
