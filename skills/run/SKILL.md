# Relay Run — Run a Single Agent Role

Run one role of the Relay pipeline in isolation, without the orchestration `run-pipeline.sh` provides (gates, retries, worktree lifecycle). Useful for debugging a single stage or re-running a role by hand.

## Usage

```
/relay:run --role <role> --slug <slug> [--project-root=<path>]
```

`<role>` is one of: `pm`, `dev-review`, `pm-respond`, `architect`, `dev`, `review`, `qa`, `retro`, `memory-compact`.

## What it does

```bash
node skills/pipeline/scripts/agent-runner.ts --role=<role> --slug=<slug> --project-root=<path>
```

Writes the role's artifact under `.relay/artifacts/features/<slug>/`. See **Workflow stages** in `skills/pipeline/SKILL.md` for what each role produces and its gate.

Most feature work should go through `/relay:new` (start) or `/relay:resume` (continue) instead — those run the full pipeline with gates and retries. Reach for `/relay:run` when you specifically need one role's output without the rest.
