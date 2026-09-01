# Project Memory

This file is read by every agent on every feature run. It documents lessons, conventions, and architectural decisions that recur across features. Entries are kept short and organized by fixed categories (not one section per feature).

**Tag format:** Each new learning includes `(feature-slug)` for traceability. If an entry becomes outdated, replace it rather than appending a contradiction.

---

## Pitfalls

- **Do NOT fabricate defaults in "no signal found" detectors.** If a detector reads a config and finds nothing, it should return an empty value (`''` or `[]`), NOT a hardcoded default (e.g., `eslint` when eslint isn't a dependency). This repo's own setup notes document workarounds for this bug. (detector-tests)
- **Characterization testing without source-read access is fragile.** Do not ask Dev to write assertions about function behavior without giving Dev access to the actual source code. The 30% failure rate in detector-tests stemmed entirely from Dev guessing signatures instead of reading them. (detector-tests)
- **Do not assume "in-memory fixtures vs. filesystem fixtures" without verifying function signatures.** A function's name might suggest it reads files, but its actual parameter list could be different. Example: `detectE2E` and `detectLocales` were initially assumed to take `package.json` objects, but they actually take a directory path and use real filesystem calls. Verify before writing fixtures. (detector-tests)

---

## Conventions confirmed

- **Test framework:** `node:test` exclusively (no Jest, Vitest, Mocha, or external framework). Import grouping/assertion functions only from `node:test` and `node:assert` (or `node:assert/strict`). (detector-tests)
- **Assertions:** Prefer `node:assert/strict` for exactness. Use `assert.strictEqual()` for equality checks, not loose equality or truthy checks. Characterization tests must assert exact observed values, not guessed or "ideal" values. (detector-tests)
- **Temp directory pattern:** `mkdtempSync(path.join(os.tmpdir(), '<unique-prefix>-'))` with cleanup in an `after()` hook via `rmSync(dir, { recursive: true, force: true })`. Each test file gets its own unique prefix to avoid collisions when tests run concurrently. (detector-tests)
- **1:1 file mapping:** One test file per source module (e.g., `test/detectors/project.test.mjs` for `skills/setup/scripts/detectors/project.mjs`). Mirrors the existing pattern in this repo (e.g., `test/agent-runner.test.ts` ↔ `skills/pipeline/scripts/agent-runner.ts`). (detector-tests)
- **No mocking library:** This repo has no mocking/stubbing dependency (e.g., no sinon, jest.mock). Achieve test isolation via real temp directories and fixture files/objects, not mocks. (detector-tests)
- **ESM style in `.mjs` files:** Use `import`/`export` syntax exclusively in `.mjs` files (no `require`). `.ts` files may use `import` or `require` depending on tsconfig, but `.mjs` is ES modules only. (detector-tests)
- **"No signal found" is a contract:** Functions that return empty values on missing signals should have explicit tests asserting those empty values (`''` or `[]`). These tests document the contract and catch regressions if a detector ever starts fabricating defaults. (detector-tests)
- **Test file organization under subdirectories:** When adding multiple related test files (e.g., 11 detector tests), place them under a subdirectory (e.g., `test/detectors/`) to keep the root `test/` folder focused. Update the test command's glob to discover nested files (e.g., add `test/detectors/**/*.test.mjs` to `scripts.test`). (detector-tests)

---

## Architecture decisions

- **Detectors as pure functions:** All detector modules export small, pure functions that inspect a `package.json` object or a directory tree and return a single value (string, array, or object representing a detected configuration value). No I/O side effects, no persistent state. (detector-tests)
- **Two detector input patterns:** Some detectors are dependency-based (take a parsed `package.json` object as input), others are filesystem-based (take a directory path and read config files). Tests use corresponding fixture types: in-memory objects vs. real temp directories. (detector-tests)
- **fs-helpers.mjs as a shared primitive:** All filesystem-based detectors depend on `fs-helpers.mjs`'s `exists()`, `readJson()`, `readText()`, `ls()`, `findFiles()`, `isDirectory()`. Getting this module's contract right (behavior on missing/malformed input) is critical; other detectors' tests ripple from it. Write `fs-helpers.test.mjs` first to establish ground truth. (detector-tests)
- **No lint/format tooling configured for this repo:** This is a Node.js CLI/skills repository with no end-user-facing app code, so ESLint/Prettier/Biome are not dependencies. `commands.lint`, `commands.formatCheck`, `commands.formatWrite` are intentionally empty strings. Do not invent a linter. (detector-tests)
- **Test command delegates to package.json:** `.relay/config.json`'s `commands.test` is typically a short delegation (e.g., `"npm test"`) that reads the actual test script from `package.json`. If widening the test glob, update `package.json`'s `scripts.test` first; no need to change `.relay/config.json` unless the delegation itself changes. (detector-tests)

---

## Integration notes

- **Detector output feeds into `.relay/config.json` generation:** The `detect-stack.mjs` script runs all 11 detectors and aggregates their outputs into a project's initial `.relay/config.json`. If a detector returns an empty string or array ("no signal found"), that field in `.relay/config.json` is either omitted or set to a placeholder. (detector-tests)
- **Three known detector bugs with documented workarounds:** (detector-tests)
  1. `detectAppId` fabricates a mobile bundle id for non-mobile projects → this repo's `.relay/config.json` set `appId: ''` manually.
  2. `detectLintCmd`/`detectFormatCmd`/`detectFormatWriteCmd` default to eslint/prettier even when not installed → this repo's `.relay/config.json` set `commands.lint: ''`, `commands.formatCheck: ''`, `commands.formatWrite: ''` manually.
  3. `detectSourceDirs` falls back to `['src']` even when `src/` doesn't exist → this repo's `.relay/config.json` set `sourceDirs: ['skills', 'test']` manually.
  - These bugs are documented and already fixed on the main branch. Tests now lock in the correct behavior to prevent regressions.
- **GitHub repo name mismatch:** The project rebranded to "Relay" internally, but the GitHub repo (`arnaudmanaranche/ai-feature-pipeline`) hasn't been renamed/transferred yet. `detectGithubRepo` correctly reads the actual git remote and returns the real, currently-valid repo name. Don't invent a rename. (detector-tests)
