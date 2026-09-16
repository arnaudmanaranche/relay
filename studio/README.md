# Relay Studio

Local editor for the pipeline, run with `npm run studio` **from the root of a
project that has already run `/relay:setup`**. Three tabs:

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

`npm run studio` proxies to `npm --prefix studio run dev`, which makes npm cd
into `studio/` before spawning Vite — so `process.cwd()` would be `studio/`,
not where you typed the command. npm sets `INIT_CWD` to the real invocation
directory regardless of `--prefix`, and that is what `server/api.ts` uses as
the project root. Every path the API touches is resolved against it and
checked for containment, the same way `agent-runner.ts` does.

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

## Limits worth knowing

- Only `extraSkills` is editable in `.relay/agents.json`. `model`, `effort`,
  `maxTokens` and `typeSkills` still need the file opened by hand.
- No file watching and no write conflict detection: if the pipeline rewrites a
  file while you have it open, the last save wins silently.
- Run output is read back from a log file, not a live terminal, so a run that
  stops to ask something on stdin cannot be answered from here.
- macOS only for *Révéler* (`open -R`) and *Ouvrir dans l'éditeur* (`code`).

## Development

```bash
npm run dev         # from studio/, but see "How it finds your project"
npm run typecheck
```

`server/api.ts` holds every filesystem and network side effect, the same way
`relay-dashboard/src/services/relay.ts` did — one file to audit for anything
that touches disk.
