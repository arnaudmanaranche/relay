## Setup notes

- `sourceDirs` is `["skills", "test"]`, set manually — `detect-stack.mjs` correctly returned `[]` (no `src`/`app`/`pages` directory exists in this repo; its own fix for that is part of this same dogfooding run). This repo's actual code lives under `skills/*/scripts/` and `test/`.
- `project.githubRepo` is `arnaudmanaranche/ai-feature-pipeline`, matching the real git remote (`.git/config`) as of this setup — the repo itself hasn't been renamed on GitHub yet even though the project rebranded to "Relay" locally. Don't "fix" this to `arnaudmanaranche/relay` without confirming the GitHub repo has actually been renamed/transferred first.
- No lint or format tooling is configured for this repo (`commands.lint`/`commands.formatCheck`/`commands.formatWrite` are all empty) — there's no ESLint/Biome/Prettier dependency. Don't invent one.
