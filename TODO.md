# TODO

Known limitations not yet addressed — tracked here rather than fixed reactively.

## Design agent — integrate Figma/Pencil/Storybook into the pipeline

The pipeline currently goes PM → Dev Review → Architect → Dev → Review → QA → Retro with no role that checks
the implementation against an actual design source of truth — Review's "diagram vs diff" check is structural
consistency, not visual/UX fidelity. For any feature with a design file (Figma) or component-driven UI
(Storybook), Dev could easily drift from the intended layout/spacing/tokens with nothing catching it before QA
or a human.

Direction to explore: a design-check step (either folded into an existing role like Review, or a new one)
that pulls design context — e.g. via the Figma MCP server's `get_design_context`/`get_screenshot`, or a
Storybook story/snapshot comparison — and cross-checks it against Dev's actual output (rendered component,
screenshot, or token usage) before sign-off. Would need scoping: which stage it slots into, what "pass" means
when no design file exists for a feature (same fallback pattern as the E2E/QA gate — BLOCKED_ENV vs brief-only
judgment), and whether it's a hard gate or an advisory note in the artifact.

## iOS — integrate App Store Connect CLI (asc) skills

For iOS projects, the pipeline currently stops at PR creation with no path to TestFlight/App Store distribution —
shipping a build still means dropping out of Relay into the App Store Connect web UI or a separate Fastlane setup.
[asc](https://asccli.sh/#skills) is a single-binary, dependency-free CLI wrapping the App Store Connect API, and
ships 23 pre-built AI-agent skills covering release submission, TestFlight distribution, build uploads, code
signing/provisioning, and metadata/screenshot sync across locales.

Direction to explore: a post-QA, iOS-specific stage (or an extension of Retro/a new "Ship" role, gated on
detecting an iOS/Expo project in `.ai/config.json`) that invokes the relevant `asc` skill(s) to upload the build
and kick off TestFlight distribution once QA passes. Needs scoping: which `asc` skills are in scope for a first
pass (build upload + TestFlight only, vs also metadata/screenshots), how Apple credentials/API keys are supplied
without landing in `.ai/config.json` in plaintext, and whether this is a hard pipeline stage or an opt-in script
a human triggers manually after Relay hands off the PR.

## Structural verification of the skill-proposal gate

**Done (2026-08-21):** `run-pipeline.sh` now verifies each skill proposal's Evidence section against
`.ai/project-memory.md` deterministically (`verify-skill-proposals.mjs`): slugs cited as evidence must appear
as `(slug)` tags under Conventions confirmed, and fewer than 3 verifiable prints an advisory WARNING
(non-blocking, same posture as the diagram-vs-diff check) before a human spends time on the proposal.
Exercisable end-to-end in `--dry-run` via `RELAY_MOCK_RETRO_SKILL_PROPOSAL=1` (verifiable evidence) or `weak`
(under-evidenced, triggers the warning).

## Observability — per-run/per-agent visibility

Right now the only visibility into a run is: stdout during the run, `.agent-<role>-response.md` raw logs, and
`.agent-status*.json` files. There's no aggregated view across features of: cost per feature/role, latency per
call, retry rates per stage, model comparison, or prompt/response history in a queryable form.

Evaluate wiring in **Opik (by Comet)** for LLM observability — traces per agent call, cost tracking, and
evaluation/scoring hooks — instead of building bespoke logging further. Would likely hook in at
`callOpenRouter()` in `agent-runner.ts` (wrap the fetch call) and log role/slug/model/tokens/latency/verdict
per call as a trace.

## Provider abstraction — Anthropic/Bedrock-native backends

`agent-runner.ts` now talks to any OpenAI-compatible chat-completions + tool-calling provider via
`llm.baseUrl`/`llm.apiKeyEnv` (OpenAI, Azure OpenAI, Groq, Together, Fireworks, Ollama), plus the
subscription-only `claude-cli` backend (`agent-runner.ts:1516`). Anthropic's native Messages API and Bedrock
use a different request/response shape entirely and would need a real adapter, not just a config change —
scope that separately if/when needed.

## Dev's one-shot "full file content per touched file, in one JSON response" doesn't scale

Found live on a real ~13-file feature (monthly size reminder, little-nook): Dev hit `finish_reason: "length"`
(truncated mid-JSON) at maxTokens=24000, then *again* at maxTokens=64000 — the second attempt spent the full
64000 completion tokens and still didn't finish emitting every full file's content inside one submit_changes
call. This isn't a tuning problem: cranking maxTokens further just runs into (a) the model/provider's actual
max-output ceiling and (b) real cost — the 64000-token attempt alone cost $1.21, and immediately after it the
OpenRouter account didn't have enough credit left for another attempt at that size (402: "requested 64000
tokens, but can only afford 50228").

Current design asks Dev to emit the *complete* content of every touched file (a deliberate anti-hallucination
choice from early on — diffs invite subtly-wrong context). Two mitigations are in place:
- **Batching (2026-07-16):** `agent-runner.ts` splits Dev into sequential batches of `project.devFileBatchSize`
  files (default 6) whenever the technical plan references more impacted files than that. See
  `extractImpactedFiles`, `runDevBatched`, and the `DevBatch` prompt-shaping in `buildUserPrompt`.
- **Truncation retry (2026-08-11):** `callLlmViaOpenAiCompatible` detects `finish_reason: "length"` specifically
  and retries with a hint to prioritize a complete response over covering every file in full, instead of
  burning a generic schema-invalid retry that hits the same ceiling again.

Still open: neither eliminates truncation on a single file that's itself huge, and there's no pre-flight
estimate — a human only learns a feature needs N batches by watching the run, not before triggering it. Worth
a "this will take N batches" log line before the first Dev call.
