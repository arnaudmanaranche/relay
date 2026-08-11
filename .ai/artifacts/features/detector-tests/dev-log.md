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

**Genuine new detector bugs found and fixed (not just test corrections), per AC 26:**
1. `detectLintCmd`/`detectFormatCmd`/`detectFormatWriteCmd` checked the dependency key `'biome'`, which is not a real npm package — the actual Biome package is `@biomejs/biome`. The biome fallback path never fired for any real project using it. Fixed the key.
2. `detectErrorTracking` didn't recognize `@sentry/node` (the plain Node.js/backend Sentry SDK) — only frontend-framework-flavored Sentry packages. Added it.
3. `fs-helpers.mjs`'s `findFiles` only ever tested its predicate against files, never against directories — silently breaking `detectLocales`'s own fallback branch, which calls `findFiles` specifically to find a directory *named* `i18n`/`intl`/`translations`/`locales`. That branch could never succeed before this fix.

All three are one-line-scoped fixes with test coverage added; none change the module's public API shape. `npm test`: 204/204 passing after the correction pass (up from 133/190 on Dev's original output — the new tests plus these three source fixes account for the difference).
