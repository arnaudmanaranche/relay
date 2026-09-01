# Repository Context

## Relevant Files

- `test/agent-runner.test.ts` — the primary structural template for every new test file. Read this FIRST, in full, before writing anything. It defines: how this repo imports from `node:test` and `node:assert/strict`, whether it uses flat `test(...)` calls or `describe`/`test` nesting, how it names test cases, and how it creates/cleans up temp directories (`mkdtempSync` + `os.tmpdir()` + `rmSync`). Every new file under `test/detectors/` must match this shape exactly — do not invent a different style.
- `test/eval-pipeline.test.mjs` — secondary reference for testing pure-function modules with in-memory fixture objects (no disk I/O). Use this shape for detector functions that accept a parsed `package.json`-shaped object as a parameter rather than reading one from disk (e.g. `detectLintCmd`, `detectFormatCmd`, `detectTestCmd` if they take an object argument — confirm signature on read).
- `test/rebuild-context.test.mjs` — tertiary reference for `.mjs`-file test conventions in this repo (this repo mixes `.ts` and `.mjs` test files; this one plus `eval-pipeline.test.mjs` are the `.mjs` precedents to follow for the new `.mjs` files, since `agent-runner.test.ts` is TypeScript and may use slightly different import/type syntax that should NOT be carried into the new `.mjs` files).
- `skills/setup/scripts/detectors/fs-helpers.mjs` — read in full before writing `fs-helpers.test.mjs`. Exports `readJson`, `exists`, `readText`, `ls`, `findFiles`, `isDirectory`. This is the shared primitive nearly every other detector sits on top of (per the dependency map: `project.mjs`, `commands.mjs`, `source-layout.mjs`, `analytics.mjs`, `e2e.mjs`, `locales.mjs` all import `./fs-helpers.mjs`). Its actual behavior on missing/malformed input (throw vs. return null/undefined/false/'') must be established here first and then treated as ground truth for every other test file.
- `skills/setup/scripts/detectors/project-type.mjs` — read before `project.test.mjs`, since `detectProjectType`'s output (`'web'` / `'mobile'` / `'unknown'`, or whatever the actual literal values are — confirm on read, do not assume casing) is a required input fixture for `detectAppId`'s AC 4–6.
- `skills/setup/scripts/detectors/project.mjs` — read before `project.test.mjs`. Exports `detectProjectName`, `detectAppId`, `detectGithubRepo`, `detectDefaultBranch`. Confirm exact function signatures (what arguments each takes — a directory path? a parsed package.json object? both?) and confirm whether `detectGithubRepo`/`detectDefaultBranch` read from `.git/config` as text or shell out to `git` via `child_process` (the dependency map suggests no `child_process` import, i.e. text/JSON parsing, but this must be confirmed directly since it changes the fixture strategy).
- `skills/setup/scripts/detectors/commands.mjs` — read before `commands.test.mjs`. Exports `detectPackageManager`, `detectRunScript`, `runScriptPrefix`, `detectTypecheckCmd`, `detectLintCmd`, `detectTestCmd`, `detectFormatCmd`, `detectFormatWriteCmd`. Confirm exact precedence order when multiple tool dependencies are present (biome vs eslint/prettier) and the exact placeholder-string match used to exclude the npm-init default test script.
- `skills/setup/scripts/detectors/source-layout.mjs` — read before `source-layout.test.mjs`. Exports `detectSourceDirs`, `detectSkipDirs`, `detectSourceExtensions`. Confirm exact return value/order for the Expo-router (`app/_layout.tsx`) case and the `app`+`pages` hybrid case by direct inspection — the brief explicitly forbids guessing these.
- `skills/setup/scripts/detectors/stack.mjs`, `analytics.mjs`, `paywall.mjs`, `e2e.mjs`, `error-tracking.mjs`, `locales.mjs` — read each in full immediately before writing its corresponding test file. Each is small; enumerate every distinct signal/dependency name each function checks so the happy-path matrix in the test file is exhaustive rather than a guess at one example signal.
- `skills/setup/scripts/detect-stack.mjs` — read (do not modify) to understand how each detector is actually invoked in practice (argument order, which detectors depend on which other detectors' output as input) — this context helps get fixture shapes right even though this file itself is out of scope for edits.
- `package.json` (repo root) — read the `scripts.test` value to determine whether the current test command already recursively discovers files under `test/detectors/`, or whether it needs widening per the technical plan's Implementation Order step 8. Also check `dependencies`/`devDependencies` here to confirm no test framework beyond Node builtins is present (AC 23).
- `.ai/config.json` — read-only reference to confirm what `commands.test` currently points to and cross-check it against the literal `package.json` script it wraps; do not edit unless the technical plan's narrow exception applies.

## Similar Features

- **`test/agent-runner.test.ts` ↔ `skills/pipeline/scripts/agent-runner.ts`** — this is the closest analog in the whole repo: a single sizeable script module tested via a single `node:test` file with the same tools (`node:test`, `node:assert/strict`, `node:fs`, `node:os`, `node:path`). The new `test/detectors/*.test.mjs` files are doing the same thing, just fanned out 1:1 across 11 smaller modules instead of one large one. Follow its exact idioms for temp-dir setup/teardown.
- **`test/eval-pipeline.test.mjs` ↔ `skills/pipeline/scripts/eval-pipeline.mjs`** and **`test/rebuild-context.test.mjs` ↔ `skills/pipeline/scripts/rebuild-context.mjs`** — both are `.mjs` test files for `.mjs` source modules, the same file-extension pairing this feature uses. These are the more directly comparable precedents for import syntax, since `agent-runner.test.ts` is TypeScript.
- There is no existing precedent in this repo for a `test/<subfolder>/` layout — this feature introduces the first nested test directory. Treat `test/agent-runner.test.ts`'s per-file conventions as the style guide, but the directory nesting itself is new and only needs to be reflected in the test command's discovery pattern (technical plan, Impacted Files → `package.json`).

## Existing Conventions

- **Test framework:** `node:test` exclusively — no Jest, Vitest, Mocha, or Jasmine anywhere in this repo. Every new test file must import test-grouping/case functions only from `node:test`.
- **Assertions:** `node:assert/strict` (per the dependency map, all three existing test files use `node:assert/strict`, not the non-strict `node:assert`). Match this exact import in every new file for consistency, unless `agent-runner.test.ts` on inspection shows a documented reason to deviate (it doesn't appear to — confirm on read).
- **Fixture strategy — two distinct patterns depending on function signature, per the brief's own Technical Notes:**
  1. For detector functions that accept a parsed `package.json`-shaped object directly as a parameter: construct a plain JS object literal in the test (e.g. `{ scripts: { lint: '...' }, dependencies: {}, devDependencies: { eslint: '^9.0.0' } }`) and pass it straight to the function. No disk I/O needed for these cases.
  2. For detector functions that read from disk (via `fs-helpers.mjs`'s `exists`/`readJson`/`readText`, given a directory path): create a real temp directory via `mkdtempSync(path.join(os.tmpdir(), '<unique-prefix>-'))`, populate only the marker file(s)/subdirectory(ies) relevant to that one scenario using `mkdirSync`/`writeFileSync`, run the detector against that directory path, then remove the directory in a cleanup hook.
- **Temp-dir cleanup:** always via `rmSync(dir, { recursive: true, force: true })`, always inside an `after`/`afterEach` hook (or a `try/finally` around the individual test body if the file doesn't group scenarios under a shared `describe`) — never only at the end of a happy-path branch, so cleanup still runs even when an assertion throws.
- **Temp-dir naming:** each existing test file uses a distinguishable prefix passed to `mkdtempSync`. Each new file under `test/detectors/` must use its own unique prefix (e.g. a string containing the module name) to avoid any chance of collision if `node:test` runs multiple files concurrently.
- **"No signal found" assertions:** every negative-case test must assert the documented falsy/empty return value exactly as implemented (`''` for string-returning detectors, `[]` for array-returning detectors) — never assert `undefined`, `null`, or a fabricated default unless that is what the source actually, verifiably returns.
- **Characterization testing over spec testing for ambiguous cases:** for any scenario where the brief explicitly says the exact expected value is unknown (Expo-router `detectSourceDirs` result, mobile-fallback `detectAppId` format, multi-tool precedence in `commands.mjs`), the test must assert whatever the current source actually produces (read it, run it mentally or via a scratch script if needed, then hardcode that real value as the expectation) — not a guessed or "nicer" value.
- **Test naming:** name each `test(...)` call's description string after the acceptance criterion it satisfies in plain language, mirroring the brief's own example: `test('detectAppId returns \'\' when project_type is web and no mobile config exists', ...)`. This lets a reviewer map AC → test 1:1 without reading assertion bodies.
- **No mocking library:** this repo has no mocking/stubbing dependency (e.g. no `sinon`, no `jest.mock`). Where isolation is needed (e.g. avoiding real network/git calls), achieve it via real temp directories and real fixture files/objects, not mocks — consistent with Scope §1's explicit ban on adding a new mocking library.
- **ESM style:** all detector source files and all `.mjs` test files use ES module `import`/`export` syntax (no `require`). Match this in every new `.mjs` file.

## Reuse Opportunities

- **Temp-directory helper pattern from `test/agent-runner.test.ts`** — if that file defines a small local helper function for creating a temp dir with a given prefix (rather than calling `mkdtempSync` inline every time), replicate that same local helper (not a shared import — each test file is self-contained per existing convention) at the top of each new `test/detectors/*.test.mjs` file rather than inventing a new helper shape.
- **`skills/setup/scripts/detectors/fs-helpers.mjs`'s own exported functions** — once `fs-helpers.test.mjs` has established their real contract, that same understanding (not the functions themselves, since they're not test utilities) informs exactly how to structure every subsequent file's disk-based fixtures — e.g. if `readJson` is confirmed to throw on malformed JSON, then any detector test that wants to simulate malformed `package.json` should expect a throw (wrapped in `assert.throws`) rather than a falsy return.
- **`project-type.test.mjs`'s fixtures** — the same temp-dir/package.json fixtures built to exercise `detectProjectType`'s web/mobile/unknown classification can be directly reused (copy the fixture-construction code inline into `project.test.mjs`, since files are self-contained) as the `project_type` input for `detectAppId`'s AC 4–6 scenarios, keeping the two files' fixtures consistent with each other.

## Files To Avoid Touching

- `skills/setup/scripts/detectors/analytics.mjs`
- `skills/setup/scripts/detectors/commands.mjs`
- `skills/setup/scripts/detectors/e2e.mjs`
- `skills/setup/scripts/detectors/error-tracking.mjs`
- `skills/setup/scripts/detectors/fs-helpers.mjs`
- `skills/setup/scripts/detectors/locales.mjs`
- `skills/setup/scripts/detectors/paywall.mjs`
- `skills/setup/scripts/detectors/project-type.mjs`
- `skills/setup/scripts/detectors/project.mjs`
- `skills/setup/scripts/detectors/source-layout.mjs`
- `skills/setup/scripts/detectors/stack.mjs`
- `skills/setup/scripts/detect-stack.mjs`
- `.ai/config.json` — read-only; do not edit unless the literal `commands.test` string stored there is the specific thing being changed, and only after `package.json`'s actual runnable script has been changed first and confirmed to work
- `.ai/agents.json` and any other governance file
- `skills/pipeline/**` (agent prompts, registries, templates, `agent-runner.ts`, `eval-pipeline.mjs`, `rebuild-context.mjs`) — unrelated module, not part of this feature
- `video/**` (Remotion project) — unrelated, not part of this feature
- `test/agent-runner.test.ts`, `test/eval-pipeline.test.mjs`, `test/rebuild-context.test.mjs` — existing tests must not be modified or weakened; only read them for pattern reference
- `README.md`, `TODO.md`, `docs/index.html`, `LICENSE` — no reason for this feature to touch project-level docs
