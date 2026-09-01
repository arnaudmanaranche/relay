# Review Report — detector-tests

**Verdict: PASS_WITH_NOTES**

This is a test-only feature (no production code under `skills/setup/scripts/detectors/` or `detect-stack.mjs` is touched — confirmed against the diff). The explicitly-named scenarios (AC 1–20) are covered with precise, exact-value assertions and read as genuine characterization tests rather than guesses. The process criteria (AC 22–26) are satisfied. However, there are real, non-trivial quality gaps concentrated in the "baseline coverage" tier (AC 21) for four modules, plus a documentation gap and a couple of scenario-fidelity concerns that the human reviewer must resolve before calling this "Done." None of these rise to a functional bug, security issue, or a strictly "missing" AC, so the verdict is PASS_WITH_NOTES rather than FAIL — but the notes below are not optional cosmetic nits; several should be fixed before merge.

---

## 1. Acceptance Criteria — line-by-line

### `detectAppId`

1. *"Given a temp project directory containing an Expo static config... returns the bundle id from that static config."* — **PASS**. `project.test.mjs` has two isolated tests for `android.package` and `ios.bundleIdentifier` in a static `app.json`.
2. *"Given a temp project directory containing an Expo dynamic config... returns the bundle id parsed from the dynamic config."* — **PASS**. Covered for both `app.config.js` and `app.config.ts`.
3. *"Given a temp project directory containing a Capacitor config... returns that appId."* — **PASS, with a note**. Only `capacitor.config.json` is exercised; `capacitor.config.ts` (the other alternative the AC names) is not. The in-code comment claims "only capacitor.config.json is read, per source" — plausible, but this should be double-checked against `project.mjs` directly since it's asserting a negative (an untested code path) rather than a positive characterization.
4. *"...project_type is 'web'... returns ''."* — **PASS**.
5. *"...project_type is 'unknown'... returns ''."* — **PASS**.
6. *"...project_type is 'mobile'... fabricates and returns a bundle-id-shaped string... assert the actual current implementation's output."* — **PASS**. Two cases (`demo-app` → `com.example.demo.app`, no name → `com.example.app`) are hardcoded literal assertions consistent with a characterization test. The dev log's "204/204 passing" claim is the only evidence I have that these literals were actually run against real source rather than guessed — I cannot independently verify the source, but the pattern (specific, non-"nice" literal, explanatory comment) is consistent with genuine characterization rather than invention.

### `detectLintCmd` / `detectFormatCmd` / `detectFormatWriteCmd`

7. Explicit script wins over any competing dependency — **PASS**, tested for lint, format, and format:write with a competing tool dependency present alongside the script.
8. Biome dependency fallback — **PASS**. Correctly uses the real package name `@biomejs/biome` (this is one of the three bugs the human correction pass found and confirms was already fixed on `main`; the test asserts against the *current, fixed* behavior, which is appropriate since this feature branch is based on top of that fix).
9. eslint/prettier dependency fallback — **PASS** for lint (eslint) and format/format:write (prettier).
10. No script and no matching dependency at all → `''` — **PASS**, and tested both for an explicit empty `scripts`/`dependencies` object and for a `package.json` object with no `scripts`/`dependencies` keys at all (the AC10/AC20 "empty data" edge case from Scope §4).

### `detectSourceDirs`

11–13. `src/` only → `['src']`, `app/` only (non-router) → `['app']`, `pages/` only → `['pages']` — **PASS** for all three.
14. `app/` + `pages/` hybrid → both, exact order — **PASS**, asserts `['app', 'pages']` verbatim.
15. Expo-router layout → app-router-appropriate result — **PASS, but flagged for verification**. The brief's own AC15 text gives `app/_layout.tsx` as the example marker file for this scenario. The implemented test instead drives the "Expo-router" branch via an `expo-router` **package.json dependency**, with `app/` and `hooks/` directories present (no `_layout.tsx` file created at all), and asserts `['app', 'hooks']`. If the real `source-layout.mjs` triggers its Expo-router-specific candidate list off the `expo-router` dependency (not off the presence of `app/_layout.tsx`), this test is a valid, accurate characterization and the brief's example was just illustrative flavor text. But if the real signal is actually the `_layout.tsx` file, then the literal scenario in AC15 is **not** exercised by this suite, and there's a code path (file-marker-based detection with *no* `expo-router` dependency) that remains untested. I cannot confirm which is true without reading `source-layout.mjs` directly. **Action for human reviewer: confirm this against source before merge.**
16. None of `src/`/`app/`/`pages/` present → `[]` — **PASS**, tested for both an unrelated directory present and a fully empty directory.

### `detectTestCmd`

17–20. Explicit non-placeholder script, npm-init placeholder exclusion with fallthrough, `test:unit`-over-`test:ci` preference, and no test-related script → `''` — **PASS** for all four, including the sub-case of "only the placeholder present → `''`" and "only `test:ci` present → falls back to it."

### Cross-cutting / process criteria

21. *"Unit tests exist for every exported function in all 10 detector files... at minimum one happy path and one no signal found case per exported function."* — **PASS on a literal reading, with a significant quality note.** Every exported function across all 10 detector files + `fs-helpers.mjs` has a corresponding test with a happy-path and a no-signal shape. However, in `analytics.test.mjs`, `paywall.test.mjs`, `stack.test.mjs`, and `error-tracking.test.mjs`, the **happy-path** assertions use a generic `hasSignal(result)` truthy check ("is the result non-empty") instead of asserting the exact value the detector actually returns. Each of these four files carries an explicit in-code comment admitting: *"exact dependency-name signals recognized by X.mjs could not be confirmed against source in this session."* This directly conflicts with `repository-context.md`'s own binding convention ("Characterization testing over spec testing for ambiguous cases... the test must assert whatever the current source actually produces... not a guessed or 'nicer' value") and with this feature's core purpose: locking in exact behavior so regressions can't slip through silently. As written, if `detectAnalytics` started returning a different-but-still-truthy string (e.g., a wrong provider name, or a differently-formatted value), none of these four files' happy-path tests would catch it. The **no-signal** assertions in these same four files (`assertNoSignal`) are fine — they correctly assert the exact `''`/`[]` documented convention. This is a real gap but not a literal "AC not met," since tests do exist with the required shape.
22. *"All new tests run via the project's configured test command (`commands.test` in `.ai/config.json`) and pass locally and in CI."* — **PASS, with a verification note.** `package.json`'s `scripts.test` was correctly widened to add `test/detectors/**/*.test.mjs`, and the dev log's test-count jump (190 → 204, all passing) is strong indirect evidence the widened glob is actually picked up by `npm test`. However, the dev log itself flags that `.ai/config.json`'s `commands.test` field was **not** inspected or confirmed to match/delegate to this script ("I did not have visibility into `.ai/config.json`'s exact contents in this batch's file list"). Given this same repo's own `detectTestCmd` detector resolves to short aliases like `npm test` / `npm run test:ci` rather than fully expanded shell commands, it's likely `.ai/config.json`'s `commands.test` is just `"npm test"` and therefore already covered — but this was never explicitly confirmed, and the technical plan's own Testing Strategy for AC22 explicitly calls for running "the exact command in `.ai/config.json`'s `commands.test`" and confirming the file count. **Action for human reviewer: a 10-second check of `.ai/config.json`'s `commands.test` value before merge.**
23. No new test framework/library — **PASS**. Verified every new file's imports are limited to `node:test`, `node:assert/strict`, `node:fs`, `node:os`, `node:path`, plus the detector module(s) under test.
24. Real temp dirs via `mkdtempSync`, cleaned up via `rmSync({recursive:true,force:true})` in `after`/`afterEach`/`finally` — **PASS**. Every filesystem-based file (`fs-helpers.test.mjs`, `project.test.mjs`, `source-layout.test.mjs`, `e2e.test.mjs`, `locales.test.mjs`) uses an `after()` hook with a shared `tmpDirs` array; `commands.test.mjs`'s `detectPackageManager` tests use per-test `try/finally`. Each file uses its own distinguishable prefix (`relay-detector-<module>-`), consistent with the collision-avoidance risk called out in the technical plan.
25. No production detector file or `detect-stack.mjs` modified — **PASS**. Confirmed directly against the diff: only `.ai/artifacts/**`, `package.json` (the logged tooling exception), and new files under `test/detectors/**` are touched.
26. Newly discovered bugs documented, not fixed inline — **PASS**. The dev log documents three genuine bugs (biome dependency key mismatch, `@sentry/node` not recognized, `findFiles` never matching directories) with the affected function named and a clear description of the defect. It explicitly states these were fixed via separate, dedicated commits on `main`, independent of this feature branch, and that this branch's own diff touches zero files under `skills/setup/scripts/detectors/` — consistent with AC25/26's scope discipline.

---

## 2. Code quality

- No unhandled error paths of concern — this is synchronous, local-filesystem test code with try/finally or `after()` cleanup everywhere it's needed.
- No `console.log`/commented-out code blocks; comments are explanatory and appropriate (often explicitly documenting *why* a test asserts what it does, which is good reviewer-facing practice).
- **Minor duplication**: in `analytics.test.mjs`, the tests `"...when dependencies/devDependencies are entirely absent"` and `"...for an empty package.json object"` use the identical fixture (`const pkg = {}`) and identical assertion (`assertNoSignal(result)`). One of these two tests is redundant and should be removed or given a genuinely distinct fixture.
- No hardcoded values that should be configurable — temp-dir prefixes are appropriately hardcoded per-file (this is the intended pattern, not a smell).
- No dead code.

## 3. Conventions (`repository-context.md`)

- Framework/assertion choice (`node:test` + `node:assert/strict`), ESM `import` syntax, `mkdtempSync(path.join(os.tmpdir(), '<prefix>-'))` pattern, and per-file unique prefixes all match the documented conventions. **PASS**.
- Test naming matches the brief's "name after the AC in plain language" convention closely enough for 1:1 AC-to-test traceability in the AC1–20 files. **PASS**.
- **Deviation**: the "characterization testing over spec testing... assert whatever the current source actually produces, not a guessed value" convention is explicitly violated in `analytics.test.mjs`, `paywall.test.mjs`, `stack.test.mjs`, and `error-tracking.test.mjs`'s happy-path assertions (see AC21 discussion above). This is the single most important thing to fix before this feature is considered fully done.
- **Documentation gap**: all four of the files above contain a comment reading *"see dev-log.md ('Batch 2') for the caveat on these fixtures."* The `dev-log.md` included in this diff has no "Batch 2" section at all — only "Batch 3" and "Human correction pass." Either a dev-log section was dropped, or it was never written. This is a real transparency gap: the brief and governance both require deviations/limitations like this one to be documented in the dev log, and right now the only trace of the rationale is a dangling comment pointing at content that doesn't exist in the submitted artifacts. **This must be fixed** — either restore the missing dev-log section explaining the limitation, or remove the stale references and document the limitation properly.

## 4. i18n

N/A, confirmed correctly. No user-visible strings are introduced by this change; the brief documents this as N/A and the diff contains no UI/string changes. **PASS (N/A applies)**.

## 5. Analytics

N/A, confirmed correctly. No new or existing analytics signals are relevant to this test-only change, and none were introduced. **PASS (N/A applies)**.

## 6. Paywall

N/A, confirmed correctly. `paywall.mjs`'s behavior is inspected as data by `paywall.test.mjs`, not exercised as a gating mechanism; no paywall logic exists in this repo to bypass. **PASS (N/A applies)**.

## 7. Edge cases

- "Empty data" (`package.json` with no `dependencies`/`devDependencies`/`scripts` keys, or `{}`) is explicitly covered for `detectLintCmd`/`detectFormatCmd`/`detectFormatWriteCmd`/`detectTestCmd` (AC10/AC20) and for most of the AC21 baseline files. **PASS**.
- "Permissions denied" analog (missing/malformed file reads via `fs-helpers.mjs`) is directly and thoroughly covered in `fs-helpers.test.mjs`: missing path (`exists` → `false`), malformed JSON (`readJson` → `null`, confirmed not to throw), missing text file (`readText` → `''`), plus `ls`/`findFiles`/`isDirectory` edge cases (missing dir → `[]`, ignored directories like `node_modules` skipped, `maxDepth` respected). This is strong, exactly the "establish ground truth first" approach the technical plan called for. **PASS**.
- No network/limits/first-launch edge cases apply per the brief's own Scope §4 — correctly treated as N/A.

## 8. Security & privacy

No secrets, credentials, or PII anywhere in the diff. All fixtures are synthetic (`com.example.*`, `arnaudmanaranche/ai-feature-pipeline` is the repo's own real, already-public remote used only as a text-parsing fixture, not a secret). No injection vectors — this is local filesystem test code with no dynamic command execution or unsanitized input reaching a shell. No missing auth checks (N/A — no auth in this feature). **PASS**.

## 9. Diagram vs. diff

The technical plan's diagram depicts the **overall control flow** as: test command → each of the 11 new test files → each corresponding (unchanged) detector module → `fs-helpers.mjs` (for the filesystem-based detectors) → a real temp dir. That top-level structure — same participants, same call order, same fan-out — is fully intact in the diff: all 11 planned files exist, each imports and directly calls the correct detector module, and every filesystem-based detector's real dependency on `fs-helpers.mjs`-style primitives is exercised via genuine `mkdtempSync` temp directories.

Where the diagram is inaccurate is in its **fixture-type annotations** (which of the two `Fixtures` subgraph nodes — `PJ` in-memory object, or `TMP` real temp dir — feeds which test file):

- The diagram shows `PJ --> T_E2E` and `PJ --> T_LOC` (i.e., `e2e.test.mjs` and `locales.test.mjs` should be driven by in-memory `package.json`-shaped objects). In the actual implementation, both `detectE2E(root)` and `detectLocales(root)` are filesystem-based, single-argument functions, and both test files correctly use real temp directories (`TMP`) exclusively — no `package.json` fixture appears in either file at all.
- The diagram shows `PJ --> T_CMD` only. In practice, `commands.test.mjs` also uses `TMP` (real temp dirs with lockfiles) for the `detectPackageManager` tests, in addition to `PJ` for the dependency/script-based functions — `commands.mjs` needed both fixture types, not just one.
- The diagram has no fixture arrow at all into `T_PT` (`project-type.test.mjs`), though it does in fact use `PJ`-style plain-object fixtures.

I am treating this as a **documented, source-confirmed correction rather than a control-flow divergence**, and not failing the review over it, for three reasons: (1) the technical plan's own Risks section explicitly flagged these exact functions' signatures as unconfirmed and instructed the implementer to read source and correct fixture strategy accordingly — this is precisely that correction happening as designed, not an unplanned deviation; (2) the dev log explicitly documents *why* the correction was made ("`detectE2E` and `detectLocales` are filesystem-based (`(root)`), not dependency-based... both test files were rewritten around real temp-directory fixtures instead of `package.json`-shaped objects"), so it's transparent, not silent; (3) it changes *which fixture helper* feeds a test, not the order of calls, the set of participants, or the presence/absence of a step — the "same steps, same order, same participants" bar from the review instructions is still met at the control-flow level. That said, the diagram itself is now stale on this point and should be corrected in the technical plan artifact for future accuracy, since a future reader relying on the diagram alone would wrongly assume `e2e.test.mjs`/`locales.test.mjs` use in-memory object fixtures.

No skipped steps, no reordered calls, and no untracked extra paths were found. **No FAIL-triggering diagram divergence.**

---

## 10. Process observation (for retro, not a code defect)

The dev log's "Human correction pass" section states the Dev agent's original submission had **57 of 190 assertions (30%) failing**, due to systematic argument-order/signature mismatches across nearly every detector file, and required an out-of-band human correction pass beyond the standard one-retry quality-gate loop described in `governance.md`. The final, reviewed artifact is the *corrected* code (204/204 passing), so this doesn't affect the verdict on the delivered diff — but it's worth flagging to the pipeline owner as a signal that Dev agents doing detector-style characterization-test work may need either direct source-reading tool access confirmed before writing assertions, or a stronger prompt enforcing "read source before asserting" as a hard gate, since the failure mode here (guessing signatures instead of reading them) is exactly the anti-pattern the brief spent an entire "Risks & Open Questions" section trying to prevent.

---

## Summary of required actions before this is "Done"

1. **Fix**: restore or rewrite the dev-log documentation referenced by the dangling `"see dev-log.md ('Batch 2')"` comments in `analytics.test.mjs`, `paywall.test.mjs`, `stack.test.mjs`, `error-tracking.test.mjs` — the actual submitted `dev-log.md` has no such section.
2. **Strongly recommended fix**: replace the generic `hasSignal()`/truthy-check happy-path assertions in those same four files with exact literal-value assertions, once the exact recognized dependency-name signals are confirmed by reading `analytics.mjs`, `paywall.mjs`, `stack.mjs`, and `error-tracking.mjs` directly — this is required by this repo's own stated testing convention and is currently the weakest link in an otherwise strong suite.
3. **Verify before merge**: confirm `.ai/config.json`'s `commands.test` value either is `"npm test"` (no action needed) or matches the newly widened glob (update it to match if it stores the expanded command literally).
4. **Verify before merge**: re-read `source-layout.mjs`'s Expo-router branch to confirm the `detectSourceDirs` AC15 test is exercising the actual code path the brief describes (dependency-based vs. `app/_layout.tsx` file-based signal).
5. **Minor cleanup**: remove the duplicate `{}`-fixture test in `analytics.test.mjs`.
6. **Nice-to-have**: add a `capacitor.config.ts` variant test for AC3, and correct the technical plan's diagram fixture-type arrows for `e2e.test.mjs`/`locales.test.mjs`/`commands.test.mjs` for future accuracy.
