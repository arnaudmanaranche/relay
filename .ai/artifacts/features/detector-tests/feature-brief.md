# Feature Brief: Detector Test Coverage (`detector-tests`)

**Status:** Draft — ready for Architect review (see Risks & open questions before technical planning)
**Source:** GitHub issue — "Add unit test coverage for `skills/relay-setup/scripts/detectors/*.mjs`"
**Type:** Test-only / internal developer tooling change (no end-user-facing app surface)

---

## Problem & Goals

`skills/relay-setup/scripts/detectors/*.mjs` implements the auto-detection logic that `detect-stack.mjs` uses to bootstrap a new project's `.ai/config.json` (app id, lint/format/test commands, source layout, stack, analytics provider, paywall provider, e2e framework, error tracking provider, locales). This module currently has **zero automated test coverage**, and that gap has already let real bugs ship silently:

- `detectAppId` fabricated a mobile-style bundle id for projects that are not mobile projects at all.
- `detectLintCmd` / `detectFormatCmd` / `detectFormatWriteCmd` defaulted to `eslint` / `prettier` commands even when neither tool was an actual dependency of the target project (producing a generated command that would fail to run in the target repo).
- `detectSourceDirs` fell back to `['src']` even when no `src` directory exists anywhere in the target project — this exact bug is documented in this repo's own `project-context.md` setup notes, which had to manually hardcode `sourceDirs` to work around it.

**Goals:**
1. Add unit tests under `test/`, in the existing `node:test` + `assert` style (mirroring `test/agent-runner.test.ts`), for every exported detector function across all 10 files: `project.mjs`, `commands.mjs`, `project-type.mjs`, `source-layout.mjs`, `stack.mjs`, `analytics.mjs`, `paywall.mjs`, `e2e.mjs`, `error-tracking.mjs`, `locales.mjs`, `fs-helpers.mjs`.
2. At minimum, lock in the specific scenarios called out in the issue so the three known bug classes above cannot silently regress again.
3. Use realistic fixtures: in-memory/temp `package.json`-shaped objects for dependency-based detectors, and real temp directories (via `mkdtempSync`) with marker files for filesystem-based detectors (anything going through `fs-helpers.mjs`'s `exists`/`readJson`/`readText`).
4. Ship this as a **test-only change** — no file under `skills/relay-setup/scripts/detectors/` or `detect-stack.mjs` should need to change to satisfy these tests. If a test uncovers a real bug beyond the three already known, it must be **documented in the dev log**, not silently patched.

---

## Acceptance Criteria

### `detectAppId`
1. Given a temp project directory containing an Expo static config (`app.json` with an `expo` key and a bundle identifier under `ios.bundleIdentifier`/`android.package`), when `detectAppId` runs, then it returns the bundle id from that static config.
2. Given a temp project directory containing an Expo dynamic config (`app.config.js` or `app.config.ts`) that resolves to an `expo` object with a bundle identifier, when `detectAppId` runs, then it returns the bundle id parsed from the dynamic config.
3. Given a temp project directory containing a Capacitor config (`capacitor.config.json` or `capacitor.config.ts`) with an `appId` field, when `detectAppId` runs, then it returns that `appId`.
4. Given no mobile config signal is present (no Expo/Capacitor config) and `project_type` is `"web"`, when `detectAppId` runs, then it returns `''`.
5. Given no mobile config signal is present and `project_type` is `"unknown"`, when `detectAppId` runs, then it returns `''`.
6. Given no mobile config signal is present and `project_type` is `"mobile"`, when `detectAppId` runs, then it fabricates and returns a bundle-id-shaped string derived from the `package.json` `name` field (exact fabrication format to be confirmed against source — see Risks & open questions; the test must assert the actual current implementation's output, not a guessed format).

### `detectLintCmd` / `detectFormatCmd` / `detectFormatWriteCmd`
7. Given a `package.json` with an explicit `lint` (resp. `format`/`format:write`) script, when the detector runs, then it returns that script's command verbatim, regardless of any lint/format tool present in dependencies.
8. Given a `package.json` with no relevant script but a `biome`/`@biomejs/biome` dependency, when the detector runs, then it returns the biome-based command for that concern (lint, format-check, or format-write).
9. Given a `package.json` with no relevant script but an `eslint` dependency (for lint) or a `prettier` dependency (for format/format-write), when the detector runs, then it returns the eslint/prettier-based command.
10. Given a `package.json` with no relevant script and no matching tool dependency at all, when the detector runs, then it returns `''` (not a fabricated `eslint`/`prettier` default — this is the regression the issue calls out explicitly).

### `detectSourceDirs`
11. Given a temp directory containing a top-level `src/` directory, when `detectSourceDirs` runs, then it returns `['src']`.
12. Given a temp directory containing a top-level `app/` directory (non-expo-router layout), when `detectSourceDirs` runs, then it returns `['app']`.
13. Given a temp directory containing a top-level `pages/` directory, when `detectSourceDirs` runs, then it returns `['pages']`.
14. Given a temp directory containing both `app/` and `pages/` directories (hybrid), when `detectSourceDirs` runs, then it returns both directories (exact order to match current implementation's stable output — assert against actual behavior).
15. Given a temp directory with an Expo-router-style `app/` layout (e.g. `app/_layout.tsx` present), when `detectSourceDirs` runs, then it returns the app-router-appropriate result (exact expected value to be confirmed against source — see Risks & open questions).
16. Given a temp directory with none of `src/`, `app/`, `pages/` present, when `detectSourceDirs` runs, then it returns `[]` (not a fabricated `['src']` default — this is the regression the issue calls out explicitly).

### `detectTestCmd`
17. Given a `package.json` with an explicit, non-placeholder `test` script, when `detectTestCmd` runs, then it returns that script's command.
18. Given a `package.json` whose `test` script is the `npm init` placeholder (contains `"no test specified"`), when `detectTestCmd` runs, then that script is treated as absent (excluded), and the detector falls through to the next rule rather than returning the placeholder text.
19. Given a `package.json` with no usable `test` script but a `test:unit` or `test:ci` script present, when `detectTestCmd` runs, then it returns the `test:unit` (preferred, if both present) or `test:ci` fallback command.
20. Given a `package.json` with no test-related script at all (or only the placeholder), when `detectTestCmd` runs, then it returns `''`.

### Cross-cutting / process criteria
21. Unit tests exist for every exported function in all 10 detector files, not only the ones named above — at minimum one "happy path" and one "no signal found" case per exported function, using the same fixture patterns (package.json-shaped objects and/or real temp dirs via `mkdtempSync`).
22. All new tests run via the project's configured test command (`commands.test` in `.ai/config.json`) and pass locally and in CI.
23. Tests use Node's built-in `node:test` and `node:assert` (or `node:assert/strict`) exclusively — no new test framework or assertion library dependency is introduced.
24. Filesystem-based detector tests create real temp directories via `mkdtempSync` (under `os.tmpdir()`) with marker files/directories, and clean up (`rmSync` with `{ recursive: true, force: true }`) in an `after`/`afterEach` hook, leaving no residue on disk after a run.
25. No file under `skills/relay-setup/scripts/detectors/` or `skills/relay-setup/scripts/detect-stack.mjs` is modified as part of this change.
26. If a test run reveals a detector bug not already listed in this brief's known-bugs list (Problem & Goals), it is written up in the dev log with repro details, and is **not** silently fixed as part of this test-only change.

---

## UX / Screens

N/A — this feature has no UI. `skills/relay-setup/scripts/detectors/*.mjs` and `detect-stack.mjs` are Node.js CLI/skill scripts invoked during project onboarding to this pipeline; they have no screens, components, or visual surface. This change adds test files only and must not alter the CLI's observable output or behavior (see AC 25). No existing screens in the project directory tree (there are none — this repo is developer tooling, not an app) are affected.

---

## i18n

N/A — no new user-facing strings are introduced. The detectors read/inspect a target project's own locale configuration (via `locales.mjs`) as *data*, they don't render translated UI themselves. No translation keys are added for this feature, and the project's configured locale (`en`) is unaffected.

---

## Analytics

N/A — detectors run synchronously during a one-time CLI/skill bootstrap flow (`detect-stack.mjs`), invoked by a human or agent setting up the pipeline for a new project. There is no running app instance, no end user, and no analytics SDK in this execution context, so no existing or `(NEW)` signal from the analytics registry applies. This test-only change adds no new runtime behavior that could be instrumented.

---

## Paywall

N/A — this is internal developer tooling with no free/premium user surfaces. The `paywall.mjs` detector inspects a *target* project's paywall provider as configuration data for the pipeline's own registries; it does not itself gate any feature behind a paywall, and this change does not alter its behavior.

---

## Technical Notes

**Files likely touched (all new test files — no production file listed below should require modification per AC 25):**

- `test/detectors/project.test.mjs` — covers `project.mjs` (including `detectAppId` scenarios 1–6).
- `test/detectors/commands.test.mjs` — covers `commands.mjs` (`detectLintCmd`, `detectFormatCmd`, `detectFormatWriteCmd`, `detectTestCmd`, scenarios 7–20).
- `test/detectors/project-type.test.mjs` — covers `project-type.mjs` (project type classification that scenarios 4–6 depend on as an input fixture).
- `test/detectors/source-layout.test.mjs` — covers `source-layout.mjs` (`detectSourceDirs`, scenarios 11–16).
- `test/detectors/stack.test.mjs` — covers `stack.mjs`.
- `test/detectors/analytics.test.mjs` — covers `analytics.mjs`.
- `test/detectors/paywall.test.mjs` — covers `paywall.mjs`.
- `test/detectors/e2e.test.mjs` — covers `e2e.mjs`.
- `test/detectors/error-tracking.test.mjs` — covers `error-tracking.mjs`.
- `test/detectors/locales.test.mjs` — covers `locales.mjs`.
- `test/detectors/fs-helpers.test.mjs` — covers `exists`/`readJson`/`readText` directly (missing file, malformed JSON, present-and-valid cases), since every filesystem-based detector depends on these primitives being correct.

**Rationale for one test file per detector module** (rather than a single flat `test/detectors.test.mjs`): mirrors the 1:1 mapping already used for source files under `skills/relay-setup/scripts/detectors/`, keeps each file focused and reviewable, and matches how `test/agent-runner.test.ts` maps to `skills/relay-pipeline/scripts/agent-runner.ts`. Placing them under a `test/detectors/` subdirectory (new directory) rather than flat in `test/` avoids cluttering the existing three top-level test files with ten more.

**Config/tooling check (not a production code change, but must be verified):**
- Confirm the project's configured test command (`commands.test` in `.ai/config.json`, run via `npm test` or equivalent) actually discovers files under a new `test/detectors/` subdirectory. If the current script uses an explicit file list instead of a recursive glob (e.g. `node --test test/*.test.ts test/*.test.mjs`), the glob/list needs to be widened to include `test/detectors/**/*.test.mjs`. This is a test-runner configuration adjustment, not a change to detector logic, and stays within the spirit of "test-only change" — but must be called out explicitly in the dev log per the denied-actions rule on installing/adding things silently.
- No new npm dependency is required: `node:test`, `node:assert`, `node:fs` (`mkdtempSync`, `mkdirSync`, `writeFileSync`, `rmSync`), `node:os` (`tmpdir`), and `node:path` are all Node built-ins already used by `test/agent-runner.test.ts`.

**Fixture patterns to standardize across all 10 test files:**
- Dependency-based detectors (script/dependency lookups in `package.json`): pass a plain JS object shaped like a parsed `package.json` (with `scripts`/`dependencies`/`devDependencies` as needed) directly to the detector function where the function signature allows it; where the function reads `package.json` from disk instead, write the fixture object to a temp dir via `mkdtempSync` + `writeFileSync(path.join(dir, 'package.json'), JSON.stringify(fixture))`.
- Filesystem-layout detectors (`detectSourceDirs`, mobile config detection in `detectAppId`, etc.): create a real temp directory via `mkdtempSync(path.join(os.tmpdir(), 'relay-detector-'))`, populate only the marker files/directories relevant to the scenario under test, run the detector against that directory, then remove it in a cleanup hook.
- Every "no signal found" scenario (empty `dependencies`, missing script, missing directory) must assert the detector's falsy/empty return value (`''` or `[]` as documented per function) rather than any fabricated default — this is the core regression this issue is guarding against.

---

## E2E / QA

This repo has no configured end-to-end UI test framework (it is a Node.js CLI/skill tool, not an app) — the closest equivalent QA flow is running the unit test suite plus a manual smoke test of the actual `detect-stack.mjs` entry point against representative real project shapes:

1. **Unit test run:** Execute the project's configured test command (`commands.test`) and confirm all new `test/detectors/*.test.mjs` files pass, all existing tests (`test/agent-runner.test.ts`, `test/eval-pipeline.test.mjs`, `test/rebuild-context.test.mjs`) still pass, and no test is skipped or weakened (per denied-actions: removing/weakening existing tests is forbidden).
2. **Coverage spot-check:** Confirm each scenario in Acceptance Criteria 1–20 has a corresponding, clearly named test case (e.g. `test('detectAppId returns '' when project_type is web and no mobile config exists', ...)`), so a reviewer can map AC → test 1:1 without reading implementation details.
3. **Manual smoke test against `detect-stack.mjs`:** Run `detect-stack.mjs` directly against a small set of representative fixture directories to confirm no observable behavior change from before this PR (since this is test-only):
 - An Expo app (static `app.json` config) → app id detected as before.
 - A Capacitor app → app id detected as before.
 - A plain web app with no lint/format tool installed → `commands.lint`/`commands.formatCheck`/`commands.formatWrite` come back empty (matches this repo's own `.ai/config.json`, per the project context setup notes).
 - A repo with no `src`/`app`/`pages` directory (this repo itself, per the setup notes) → `sourceDirs` detection returns `[]`, confirming the fix this issue is guarding against stays fixed.
4. **Regression check:** Diff `git status` / `git diff` after running the test suite to confirm zero changes to any file under `skills/relay-setup/scripts/detectors/` or `skills/relay-setup/scripts/detect-stack.mjs` (per AC 25 and the issue's "no production code should change" requirement).
5. **Dev log check:** If any test fails against current implementation behavior in a way that reveals a new, previously-undocumented bug, confirm the dev log contains a clear write-up (symptom, minimal repro, affected function) rather than an inline code fix.

---

## Scope

### 1. IN / OUT
**IN:**
- Adding `node:test` unit tests for all 10 files under `skills/relay-setup/scripts/detectors/*.mjs`.
- Full coverage of the specific scenarios enumerated in the issue for `detectAppId`, `detectLintCmd`, `detectFormatCmd`, `detectFormatWriteCmd`, `detectSourceDirs`, and `detectTestCmd`.
- Baseline ("happy path" + "no signal found") coverage for every other exported function in `project.mjs`, `project-type.mjs`, `stack.mjs`, `analytics.mjs`, `paywall.mjs`, `e2e.mjs`, `error-tracking.mjs`, `locales.mjs`, and direct coverage of `fs-helpers.mjs`'s `exists`/`readJson`/`readText`.
- Widening the test-runner's file discovery glob/list in the test command config, if needed, so new files under `test/detectors/` are actually picked up.
- Documenting (not fixing) any newly discovered detector bug in the dev log.

**OUT:**
- Any change to detector logic itself in `skills/relay-setup/scripts/detectors/*.mjs` or to `skills/relay-setup/scripts/detect-stack.mjs`, including fixing any newly discovered bug (explicitly deferred per the issue).
- Any change to `skills/relay-pipeline/*` (agent prompts, registries, templates) — unrelated module.
- Adding a new test framework, assertion library, or mocking library.
- Any i18n, analytics, or paywall work — not applicable to this tooling change.
- Any change to the `video/` Remotion project — unrelated.

### 2. Entry points
There is no end-user entry point (this is not an app feature). The developer/CI-facing entry points are:
- Running the project's configured test command (e.g. `npm test`), which executes all `test/**/*.test.{ts,mjs}` files including the new ones.
- CI running the test suite automatically on a pull request touching this feature.
- A developer running a single test file directly, e.g. `node --test test/detectors/commands.test.mjs`.
- A developer or agent invoking `detect-stack.mjs` directly during onboarding of a new project to this pipeline (unchanged behavior, now covered by tests).

### 3. Side effects
- **Permissions:** N/A — no OS-level permissions (camera, push, etc.) are involved; this is a Node CLI tool.
- **Navigation / routing:** N/A — no app navigation exists in this repo.
- **Existing state:** No persisted application state is touched. Tests create and destroy their own temp directories per run; no shared fixture state leaks between tests.
- **External services:** None. All detectors operate on local filesystem/`package.json` content only; no network calls.
- **Analytics / telemetry:** None.
- **Tooling config:** The test command's file-discovery glob/list may need widening (see Technical Notes) to pick up the new `test/detectors/` subdirectory — this is the only non-test-file side effect anticipated, and must be logged if made.

### 4. Edge cases
- **No network / offline:** N/A — no network dependency in detectors or their tests.
- **Permissions denied / revoked:** N/A in the OS-permission sense. Closest analog: `fs-helpers.mjs` reading a file that doesn't exist, or a `package.json` that contains invalid JSON — both should be covered by `test/detectors/fs-helpers.test.mjs` (`exists` returns false for missing paths; `readJson`/`readText` behavior on missing/invalid files should be asserted against actual current implementation behavior, e.g. throws vs. returns `null`/`undefined` — confirm exact contract during implementation).
- **Empty data:** `package.json` with no `dependencies`/`devDependencies` key at all, no `scripts` key at all, or an empty object `{}` — must be covered for every dependency- and script-based detector (this is exactly AC 10 and AC 20's "no tool at all" / "no test script at all" cases).
- **Limits:** N/A — no pagination, quotas, or item limits apply to detector logic.
- **First launch vs. returning user:** N/A — detectors are pure, stateless functions with no persisted history between invocations at this layer.

### 5. Dependencies
- `node:test`, `node:assert` (or `node:assert/strict`) — already used by `test/agent-runner.test.ts`, no version/installation change needed.
- `node:fs` (`mkdtempSync`, `mkdirSync`, `writeFileSync`, `rmSync`), `node:os` (`tmpdir`), `node:path` — Node built-ins, no new dependency.
- No new npm package is introduced by this feature. Per denied-actions rules, any dependency addition not listed here must be logged in the dev log before use — none is anticipated.

### 6. Data
- No user-facing data is stored by this feature. Test fixtures are either:
 - **In-memory:** plain JS objects shaped like a parsed `package.json`, held only for the duration of a test.
 - **Ephemeral on-disk:** real temp directories created via `mkdtempSync(path.join(os.tmpdir(), 'relay-detector-'))`, populated with marker files (e.g. `app.json`, `capacitor.config.json`, `src/`, `app/_layout.tsx`) needed for a given scenario, and deleted via `rmSync({ recursive: true, force: true })` after each test.
- No data is written to the actual repository (`.ai/config.json` or elsewhere) by the tests themselves.

### 7. Screens / navigation
N/A — no screens exist in this repository and none are added, modified, or removed by this feature. No navigation changes apply.

---

## Risks & Open Questions

1. **Exact fabrication format for `detectAppId` when `project_type === 'mobile'` (AC 6) is not specified in the issue.** Missing from the issue — needs human input, or the Architect/Dev must read `project.mjs` directly and assert against its actual current output (not invent an expected format) so the test locks in real behavior rather than a guess.
2. **Exact expected return value of `detectSourceDirs` for the Expo-router layout case (AC 15) and the exact ordering for the `app` + `pages` hybrid case (AC 14) are not specified in the issue.** Missing from the issue — needs human input, or must be derived from reading `source-layout.mjs` during technical planning.
3. **Exact exported function names and behaviors for `stack.mjs`, `analytics.mjs`, `paywall.mjs`, `e2e.mjs`, `error-tracking.mjs`, `locales.mjs`, and `project-type.mjs` beyond what's implied by their filenames are not enumerated in the issue** (the issue only gives detailed scenarios for `detectAppId`, `detectLintCmd`/`detectFormatCmd`/`detectFormatWriteCmd`, `detectSourceDirs`, and `detectTestCmd`). Missing from the issue — needs human input, or the Architect must enumerate exports from source during technical planning and define the "happy path + no signal found" matrix referenced in AC 21 and Scope §1.
4. **`fs-helpers.mjs` contract on malformed/missing input** (does `readJson` throw on invalid JSON, or return `null`/`undefined`? does `readText` throw on a missing file, or return `''`?) is not specified in the issue. Needs confirmation from source during implementation so tests assert real behavior (Scope §4).
5. **Precedence when multiple lint/format tools are present simultaneously** (e.g. both `biome` and `eslint` as dependencies, with no explicit script) is not addressed by the issue's scenario list. If the current implementation has defined precedence, it should get a test; if it's genuinely undefined/untested behavior today, this should be logged as a discovered gap per AC 26 rather than a spec the Dev agent invents.
6. **Test file layout decision** (one file per detector module under a new `test/detectors/` subdirectory, as proposed in Technical Notes) is a PM recommendation, not dictated by the issue — Architect should confirm or override this during technical planning, and confirm the test command's discovery glob covers it.

None of the above blocks starting technical planning, but all six should be resolved (via source inspection, not invention) before Dev writes assertions for the affected scenarios.
