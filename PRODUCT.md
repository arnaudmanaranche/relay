# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Solo builders** — and teams of two or three — who ship real software with an AI coding agent (Claude Code, Codex, OpenCode, Cline) and have nobody else to catch what the agent got wrong. They are the PM, the reviewer, and the QA on their own project. They want the quality control of a real engineering team applied to their "vibe coding" without hiring one. Primary entry points: running `/relay:new` inside an existing repo, and later checking `relay-dashboard` or `status.mjs` to see what's running, gated, or failed across repos.

Explicitly **not** the target: people who want one-shot "build my app" autonomy, throwaway prototypes, or teams that already have humans doing PR review and QA.

## Product Purpose

Relay is a structured, multi-agent pipeline for AI-assisted feature development. It runs feature work through seven roles — PM, Dev Review, Architect, Dev, Review, QA, Retro — each producing a real artifact and handing off through a deterministic gate, from a written brief to an open PR. Success means a feature ships with a written brief, a reviewed technical plan (with a diagram), a code review checked against that plan, a QA verdict backed by real E2E results, and a retro that feeds project memory forward — the same discipline a disciplined team applies, enforced automatically.

## Positioning

Relay is **the process layer, not another agent**. It runs on top of whichever coding agent the user already picked and does not compete with it.

The wedge, verified against the September 2026 landscape: multi-role agent frameworks (BMad-Method, MetaGPT, CrewAI) assign roles as **personas a model is asked to play**; Relay's roles are **checkpoints enforced in shell and TypeScript** — write permissions in `agent-runner.ts`, schema-checked tool-call output, and retry/halt/handoff decided by `run-pipeline.sh`. The model never decides its own control flow. Spec-driven toolkits (GitHub Spec Kit, AWS Kiro, OpenSpec) gate the front end (spec before code); Relay keeps gating *after* the spec, through an approved plan, a review against that plan, and a QA verdict from real E2E output. AI code review (CodeRabbit, Greptile, Ellipsis) reviews the diff once the PR exists; Relay reviews it against a plan approved before the code existed and can halt before a PR opens.

Two further differentiators found to be uncommon in the landscape: a **human approval gate mid-pipeline** bound to the plan's content hash, and being genuinely **cross-agent** (Claude Code plugin *and* plain Markdown skills for Codex/OpenCode/Cline) rather than single-ecosystem.

Current vocabulary that resonates in this space: "deterministic gates / guardrails" versus prompted self-checks, and "state machine" framing for agent workflows. "Spec-driven development" is the closest established category name, but it centers on what gets written, not on enforcement.

**Naming risk (flagged, undecided):** "Relay" is crowded in exactly this space — `brooksjordan/agent-relay` is a conceptually near-identical OSS project (state-machine pipeline, quality gates, adversarial review), plus `jcast90/relay`, `relay-ai`, `relay-codex`, and `relaygh.dev`. Not yet addressed.

## Operating Context

- Installed as a Claude Code plugin (`/plugin install relay@relay`) or, for other agents (Codex/OpenCode/Cline), as plain Markdown skills + scripts any tool that reads a SKILL.md and runs shell commands can drive.
- Each feature runs inside an isolated git worktree; the Architect stage pauses for a mandatory human design-gate approval before code is written.
- `relay-dashboard`: a native, read-only macOS app (Dock icon, one dashboard window) that polls `status.mjs` across configured repos every 5s and surfaces runs needing attention (design gate waiting, review/QA FAIL, crash, halt), grouped per repo.
- CI/E2E is framework-agnostic (Maestro, Playwright, Cypress, whatever the project already runs) — QA reads real results and reports `BLOCKED_ENV` rather than inventing a pass.
- Config lives in `.relay/config.json` / `.relay/agents.json`, generated once by `relay-setup`; project memory (`.relay/project-memory.md`) carries pitfalls/conventions/decisions across features and is periodically compacted.
- Dev is the only role that writes source; large features batch automatically (default 6 impacted files/call) to avoid truncation at the model's real output ceiling.

## Capabilities and Constraints

- Seven fixed roles, each a single forced tool call (`submit_changes`) validated against a per-role JSON Schema — no free-form prose parsed after the fact.
- Nine independent, code-enforced guardrails (permissions, schema validation, gates, halts/retries, cost caps, etc.) — this is a specific, countable claim already used in the current docs and should be preserved or re-verified against source, not invented.
- Two backend families: `openai-compatible` (OpenRouter, OpenAI, Azure OpenAI, Groq, Together, Fireworks, local Ollama) and `claude-cli` (subscription only, no API key).
- Known open gaps (tracked in `TODO.md`, not fixed reactively): no design-fidelity check against Figma/Storybook yet; iOS App Store Connect integration partially done (build upload shipped, metadata/screenshot sync and submission tracking still open).
- Eval harness (`npm run eval`) scores pipeline output against golden rubric cases and powers a provenance-keyed A/B loop for improving the pipeline's own prompts over time — the product is explicitly always under active development, not a finished v1.

## Brand Commitments

- Name: **Relay**. Tagline used in current materials: "Seven roles. One PR. Zero unreviewed diffs." / "A structured, multi-agent pipeline for AI-assisted feature development."
- The user has explicitly framed Relay as opinionated and not for everyone — a specific, deliberate way of managing agentic dev, currently mid-flight with incoming features, not a settled/finished product. The new site should read as confident and specific, not broadly welcoming to every workflow.
- Requested aesthetic reference: a light-themed, flat-isometric stacked-block illustration style (per-agent/role "blocks," ascending staircase composition, muted sage/near-black/slate-blue block coloring, small monospace labels) — see the pinned reference image discussed with the user. This is a binding visual constraint for how the seven roles are presented, recorded here because the user volunteered it; DESIGN.md expands it into a full system.

## Evidence on Hand

Real content only, pulled from this repo: `README.md`, `docs/index.html` (existing interactive walkthrough: role descriptions, gate types, example artifact excerpts per stage, config reference, backend comparison), `TODO.md` (roadmap), `.claude-plugin/marketplace.json` (plugin metadata), `relay-dashboard/README.md` (dashboard app behavior). No customer names, testimonials, benchmarks, or pricing exist anywhere in the project — none should be fabricated for the new site.

## Product Principles

1. Discipline is enforced in code, never requested of the model — every claim on the site about a "gate" or "guardrail" must be traceable to real enforcement logic already described in the repo.
2. Model-agnostic and stack-agnostic by design; the site should not read as tied to one vendor.
3. Relay is deliberately opinionated and unfinished-by-design (roadmap-driven, eval-improved) — the site can say so plainly rather than projecting false completeness.
4. The ecosystem is one product with three faces (skill/plugin, CLI pipeline, dashboard app), not three separate products — the site should present them as one coherent system.

## Accessibility & Inclusion

No product-specific requirement established beyond standard web accessibility (the current `docs/index.html` already implements `prefers-reduced-motion` handling and ARIA roles for its interactive rail — preserve at least that bar).
