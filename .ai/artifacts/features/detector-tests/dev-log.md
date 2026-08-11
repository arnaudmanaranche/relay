# Dev Log — detector-tests

## Batch 3 (package.json test glob widening)

- **Change made:** Widened the root `package.json` `scripts.test` command from:
  ```
  node --import tsx --test test/*.test.ts test/*.test.mjs
  ```
  to:
  ```
  node --import tsx --test test/*.test.ts test/*.test.mjs test/detectors/**/*.test.mjs
  ```
  **Why:** The original glob `test/*.test.mjs` only matches files directly inside `test/` and does not descend into the new `test/detectors/` subdirectory created by this feature (per Technical Notes / Implementation Order step 8 in the technical plan). Node's built-in test runner (`node --test`) supports glob patterns including `**` recursive segments natively (no shell globstar dependency needed, since Node expands these patterns itself via its internal glob matching, available since Node 18.20/20.6+), so no new tooling or dependency was required — this is a pure CLI-argument change, not a detector/production code change.
  - This does **not** touch `.ai/config.json`'s `commands.test` string itself, since (per the technical plan's narrow exception) that file should only be edited if the literal command string stored there is the thing changing — I did not have visibility into `.ai/config.json`'s exact contents in this batch's file list, so no change was made there. If `.ai/config.json` mirrors this exact `package.json` script string verbatim, a follow-up may be needed to keep them in sync, but per denied-actions rules I am not modifying `.ai/config.json` without direct confirmation it needs the same literal string.
  - No new npm dependency was added. `devDependencies` (`@types/node`, `tsx`, `typescript`) are unchanged.
  - Per AC 25 / Scope §1: no file under `skills/relay-setup/scripts/detectors/` or `skills/relay-setup/scripts/detect-stack.mjs` was touched in this batch, consistent with this feature being test-only aside from this one tooling-config line.
  - This change should be verified locally by running `npm test` and confirming the file count/list in the test runner's output includes all files under `test/detectors/*.test.mjs` in addition to the existing 3 top-level `test/*.test.ts`/`test/*.test.mjs` files (per technical plan Implementation Order step 9 and Testing Strategy AC 22/24).

## Human correction pass (post-Dev, pre-Review)

Running `npm test` against Dev's original output surfaced 57 failing assertions out of 190. Root-caused each one against the actual detector source (not available to the Dev agent run per its own notes above) and corrected the test files to match real function signatures/return contracts. No test assumption was "fixed" by weakening it — every correction traces to a concrete signature or return-value mismatch confirmed by reading source directly.

**Systematic issue, most files:** several detectors take `(pkg, root)` / `(pkg, root, projectType)` and were called with the wrong argument count/order, or with the "pkg" argument standing in for a directory path. `detectAppId`, `detectProjectName`, `detectSourceDirs`, `detectSkipDirs`, `detectTypecheckCmd`/`detectLintCmd`/`detectFormatCmd`/`detectFormatWriteCmd`/`detectTestCmd`, and all of `fs-helpers.mjs`'s exports were affected. `detectE2E` and `detectLocales` are filesystem-based (`(root)`), not dependency-based, and always return a truthy `{framework/locales, dir}` object rather than a `''`/`[]` no-signal case — both test files were rewritten around real temp-directory fixtures instead of `package.json`-shaped objects.

**Genuine new detector bugs found while writing this feature's tests, per AC 26 — documented here, NOT fixed as part of this change:**
1. `detectLintCmd`/`detectFormatCmd`/`detectFormatWriteCmd` checked the dependency key `'biome'`, which is not a real npm package — the actual Biome package is `@biomejs/biome`. The biome fallback path never fired for any real project using it.
2. `detectErrorTracking` didn't recognize `@sentry/node` (the plain Node.js/backend Sentry SDK) — only frontend-framework-flavored Sentry packages.
3. `fs-helpers.mjs`'s `findFiles` only ever tested its predicate against files, never against directories — silently breaking `detectLocales`'s own fallback branch, which calls `findFiles` specifically to find a directory *named* `i18n`/`intl`/`translations`/`locales`. That branch could never succeed as a result.

**Per AC 25/26, none of the three were fixed as part of THIS feature's own change.** They were reported to the pipeline owner and fixed via three separate, dedicated commits directly on `main` (independent of this feature branch, made before this branch was rebased onto it) — proper scope discipline for a genuine production bug is a dedicated fix commit, not a smuggled change inside an unrelated test-only PR. `git diff` for this feature's own commits touches zero files under `skills/relay-setup/scripts/detectors/` — confirm with `git diff main...feat/detector-tests -- skills/relay-setup/scripts/detectors/` (empty). The tests below assert the CURRENT (already-fixed-on-main) behavior, since this branch is based on top of those fixes; they are not characterization tests of unfixed behavior.

`npm test`: 204/204 passing after the correction pass (up from 133/190 on Dev's original output).

## Second correction pass (post-Review PASS_WITH_NOTES)

Addressed every actionable note from the Review report:

1. **Exact-value assertions for `analytics.test.mjs`, `paywall.test.mjs`, `stack.test.mjs`, `error-tracking.test.mjs`.** These previously used a generic `hasSignal()` truthy check for happy-path cases, with a comment deferring the caveat to a "Batch 2" dev-log section that was never actually written (a real documentation gap Review caught). Re-read `analytics.mjs`, `paywall.mjs`, `stack.mjs`, `error-tracking.mjs` directly and rewrote every happy-path assertion to the exact literal value each recognized dependency resolves to, matching this repo's stated characterization-testing convention. Removed the now-obsolete "see Batch 2" comments along with the truthy-check helper — there's no remaining caveat to defer.
2. **Added the missing `firebase-analytics` branch coverage** in `analytics.test.mjs` (requires a real temp dir with `src/`, since that branch's guard is `deps?.['firebase'] && exists(root, 'src')`) — this branch had no test at all before.
3. **Removed the duplicate test** in `analytics.test.mjs` (`"...dependencies/devDependencies are entirely absent"` and `"...for an empty package.json object"` were identical fixtures and assertions).
4. **Clarified the AC15 Expo-router test** in `source-layout.test.mjs` with an explicit source citation (`deps?.['expo-router'] && exists(root, 'app')`) confirming the signal is the `expo-router` dependency, not an `app/_layout.tsx` file — the brief's AC15 wording used the file as illustrative flavor text, not as the actual detection mechanism.
5. **Added a negative characterization test** for AC3: `detectAppId` does NOT read `capacitor.config.ts` (only `capacitor.config.json` — confirmed via `readJson(root, 'capacitor.config.json')` being the only Capacitor read in source, no `.ts` regex-parsing branch exists for it unlike the Expo dynamic-config case).
6. **Verified `.ai/config.json`'s `commands.test`**: it's the literal string `"npm test"`, which delegates to `package.json`'s own `scripts.test` — already covers the widened `test/detectors/**/*.test.mjs` glob with no further change needed.

Not addressed (per Review's own classification as "nice-to-have," not required before merge): correcting the technical plan's diagram fixture-type arrows for `e2e.test.mjs`/`locales.test.mjs`/`commands.test.mjs`.

`npm test` after this pass: all detector test files re-verified passing individually; full suite re-run before re-review.
