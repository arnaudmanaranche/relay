---
name: resume
description: Run or re-run the full Relay pipeline for a feature that already has a brief or an in-progress run, most commonly to pass the design gate after reviewing the Architect's technical plan. Use for /relay:resume.
---

# Relay Resume — Continue an Existing Feature

Run (or re-run) the full pipeline for a feature that already has a brief or an in-progress run — most commonly to pass the design gate after reviewing the Architect's technical plan.

## Usage

```
/relay:resume --slug <slug> [--approve-design] [--dry-run] [--upload-build] [--amend="<new requirement>"] [--project-root=<path>]
```

## What it does

```bash
bash skills/pipeline/scripts/run-pipeline.sh <slug> [--approve-design] [--project-root=<path>]
```

`--approve-design` skips the design gate — pass it once a human has reviewed the technical plan (see stage 3, Architect, in `skills/pipeline/SKILL.md`). Without it, a paused run reports exactly how to resume. `--amend="<text>"` feeds a new requirement into the next stage instead of starting over.

Once a PR is open, `skills/pipeline/scripts/babysit-pr.sh` polls CI and can auto-approve low-risk PRs — see **Automation** in `skills/pipeline/SKILL.md`.
