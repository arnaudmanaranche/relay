---
name: new
description: Scope a feature from a one-line description and run it through the full Relay pipeline (PM, Dev Review, Architect, Dev, Review, QA, Retro), from brief to PR. Use for /relay:new.
---

# Relay New — Start a New Feature

Scope a feature from a one-line description and run it through the full Relay pipeline (PM → Dev Review → Architect → Dev → Review → QA → Retro), from brief to PR.

## Usage

```
/relay:new <description>
```

Example: `/relay:new "Add dark mode toggle"`

## What it does

1. Derive a kebab-case slug from the description (e.g. "Add dark mode toggle" → `dark-mode-toggle`).
2. Write the description to a temporary issue-body file.
3. Run the full pipeline from that issue body:
   ```bash
   bash skills/pipeline/scripts/run-pipeline.sh <slug> <issue-body-file> [--project-root=<path>]
   ```

This executes inside an isolated git worktree — see **Workspace isolation** in `skills/pipeline/SKILL.md`. The Architect stage pauses (exit 0) for a human design-gate review before any code is written; resume with `/relay:resume --slug <slug> --approve-design` (see `skills/resume/SKILL.md`).

Requires `.relay/config.json`. If it doesn't exist yet, run `/relay:setup` first.

See `skills/pipeline/SKILL.md` for the full workflow-stage reference (what each role produces, its gate, retry behavior).
