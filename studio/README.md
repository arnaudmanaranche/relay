# Relay Studio

Local editor for the pipeline. From a project that has already run
`/relay:setup`, open it with:

```
/relay:studio
```

From a checkout of Relay itself, `npm run studio` does the same thing. Three tabs:

- **Rôles** — edit each role's prompt (the file `.relay/agents.json` points at),
  and attach cross-cutting skills to it by dragging them from the library.
- **Skills** — write project skills under `.relay/skills/`, copy in the
  templates Relay ships, or import one from a public GitHub repo that follows
  the `.claude-plugin/marketplace.json` convention.
- **Pipeline** — the run monitor: what is running, what is waiting on you,
  what merged. Approve a design gate, answer a blocking question, retry,
  stop, reveal a worktree.

Dev-only, never built for production: `vite.config.ts` mounts the API as a dev
middleware, so there is no `build` script and nothing to deploy.

## How it finds your project

Both entry points end at `npm --prefix <module>/studio run dev`, which makes
npm cd into `studio/` before spawning Vite — so `process.cwd()` would be
`studio/`, not where you typed the command. npm sets `INIT_CWD` to the real
invocation directory regardless of `--prefix`, and that is what
`server/api.ts` uses as the project root. Every path the API touches is
resolved against it and checked for containment, the same way
`agent-runner.ts` does.

## How `/relay:studio` finds Studio

Only `skills/` and `.relay/` are copied into a project by `/relay:setup`;
`studio/` stays in the module, so its dependencies are installed once and
shared. `skills/studio/scripts/relay-studio.sh` locates it in three steps,
first hit wins:

1. `<script>/../../../studio` — right when Relay is a checkout or a plugin
   install, i.e. whenever the script is still sitting in the module.
2. The `installPath` recorded for `relay@…` in
   `~/.claude/plugins/installed_plugins.json` — for when the script was copied
   into a project and step 1 lands on the project root instead.
3. A glob over `~/.claude/plugins/cache/*/relay/*/studio`, in case that
   manifest moves or the install is keyed under another name.

If all three miss, it says where it looked rather than failing obscurely.

## Skills: project vs template

Two kinds show up in the library, and the difference matters:

- **Project** skills are real files under `.relay/skills/`. They are editable,
  and they are what a role's `extraSkills` can point at.
- **Templates** ship inside the Relay module itself, not in your project. They
  are read-only here, and cannot be dragged onto a role: `agent-runner.ts`
  resolves `extraSkills` against *your* project root, so a template path would
  be a dangling entry it skips without a word. Use **Copier dans le projet**
  first, then attach the copy.

The API enforces the same rule: `PATCH /api/roles/:name` rejects a
`starter:` ref, and rejects a path with no file behind it.

## Feedback

Every action reports: a toast, bottom right. Progress and confirmations clear
themselves; **errors stay until dismissed**, because an error that disappears
on a timer is one the user may never have read.

`useToast().track({ pending, done }, action)` is the wrapper worth knowing. It
exists because the alternative kept happening: `retryRun(...).then(poll)` with
no catch, so a resume that failed looked exactly like one that worked. `track`
shows progress, then the result or whatever was thrown, and returns `undefined`
on failure so a caller can skip its follow-up without a catch of its own. With
no labels, a success is silent and only the failure speaks — right for actions
that are their own feedback, like revealing a folder in Finder.

## Limits worth knowing

- No file watching and no write conflict detection: if the pipeline rewrites a
  file while you have it open, the last save wins silently.
- Run output is read back from a log file, not a live terminal. Nothing in the
  pipeline reads stdin (`run-pipeline.sh`'s `read` calls iterate file lists;
  `agent-runner.ts` only checks `isTTY` for a spinner), so there is nothing to
  type at, but output arrives per poll rather than per keystroke.
- macOS only for *Révéler* (`open -R`) and *Ouvrir dans l'éditeur* (`code`).

## Development

```bash
npm run studio                    # from a Relay checkout root, not from studio/
npm --prefix studio test          # the registry rules
npm --prefix studio run typecheck
```

`server/registry.ts` holds the rules that decide whether a write to
`.relay/agents.json` is legal, kept apart from the HTTP layer so they can be
tested without a server or a project on disk. They mirror `validateRegistry`
in `agent-runner.ts`: a value Studio accepts has to be a value the next
pipeline run accepts, or the UI would report a save and then break the run.

`server/api.ts` holds every filesystem and network side effect: one file to
audit for anything that touches disk. `server/dashboard.ts` is the run-state
half of it, and `server/registry.ts` holds the rules with no IO at all.
