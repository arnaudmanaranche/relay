---
name: studio
description: Open Relay Studio, the local editor for this project's role prompts, skills, and pipeline runs. Use for /relay:studio.
---

# Relay Studio — Edit the Pipeline, Watch the Runs

Opens a local web app pointed at the current project: edit what each role is told, attach cross-cutting skills to a role, and watch runs from the same place.

## Usage

```
/relay:studio [--project-root=<path>] [--port=<n>] [--no-open]
```

## What it does

```bash
bash skills/studio/scripts/relay-studio.sh [--project-root=<path>] [--port=<n>]
```

The script finds the Studio app inside the Relay module (a plugin install, a checkout, wherever Relay lives) and starts it with the given project as its working directory. First run installs its dependencies once, next to the app rather than in the project.

**It runs in the foreground until Ctrl-C.** Start it in the background and tell the user the URL rather than blocking the session on it.

Requires `.relay/agents.json`, so `/relay:setup` must have run in that project first; the script says so and stops if it hasn't.

## The three tabs

| Tab | For |
| --- | --- |
| **Rôles** | Each role's prompt, and the skills attached to it. Editing a prompt writes the file `.relay/agents.json` points at, so the next run picks it up with no further step. |
| **Skills** | Project skills under `.relay/skills/`, the templates Relay ships, and import from a public GitHub repo that follows the `.claude-plugin/marketplace.json` convention. |
| **Pipeline** | What is running, what is waiting, what merged. Approve a design gate, answer a blocking question, retry, stop, reveal a worktree. |

Attaching a skill to a role writes `roles.<role>.extraSkills` in `.relay/agents.json`, and `agent-runner.ts` injects that file into every call for that role. Any role can carry one, not just Dev.

## Templates are not project files

The starters Relay ships live in the module, not in your project, so they are read-only in Studio and cannot be dragged onto a role: `extraSkills` is resolved against the **project** root, and a template path there would be an entry the pipeline skips without a word. Copy one into the project first (**Copier dans le projet**), then attach the copy.

## What it does not do

Reach for the file or the terminal for these:

- Only `extraSkills` is editable in `.relay/agents.json`. `model`, `effort`, `maxTokens` and `typeSkills` still need the file opened by hand.
- Run output is read back from a log file, not a live terminal, so a run that stops to ask something on stdin cannot be answered from Studio.
- No file watching: if the pipeline rewrites a file while it is open in Studio, whichever saves last wins.

`studio/README.md` in the module has the rest, including how it locates the project.
