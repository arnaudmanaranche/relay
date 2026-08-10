Add unit test coverage for `skills/relay-setup/scripts/detectors/*.mjs`.

Context: this module (`project.mjs`, `commands.mjs`, `project-type.mjs`,
`source-layout.mjs`, `stack.mjs`, `analytics.mjs`, `paywall.mjs`, `e2e.mjs`,
`error-tracking.mjs`, `locales.mjs`, `fs-helpers.mjs`) implements
`detect-stack.mjs`'s auto-detection logic and currently has zero test
coverage. That gap already let real bugs ship silently: `detectAppId`
fabricated a mobile-style bundle id for non-mobile projects, `detectLintCmd`/
`detectFormatCmd`/`detectFormatWriteCmd` defaulted to `eslint`/`prettier`
commands even when neither tool was an actual dependency, and
`detectSourceDirs` fell back to `['src']` even when no such directory
exists at all.

Add tests under `test/` (mirroring the existing style in
`test/agent-runner.test.ts` — Node's built-in `node:test` + `assert`) that
cover each exported detector function with representative fixtures:
package.json-shaped objects for the dependency-based detectors, and real
temp directories with marker files (via `mkdtempSync`) for the
filesystem-based ones (`exists`/`readJson`/`readText` in `fs-helpers.mjs`,
and anything that calls them). At minimum, cover:

- `detectAppId`: Expo static config, Expo dynamic config, Capacitor, no
  mobile signal + project_type web (must return ''), no mobile signal +
  project_type unknown (must return ''), project_type mobile (fabricates
  a bundle id from the package name).
- `detectLintCmd`/`detectFormatCmd`/`detectFormatWriteCmd`: explicit
  package.json script wins, biome dependency without a script, eslint/
  prettier dependency without a script, and the no-tool-at-all case (must
  return '').
- `detectSourceDirs`: src/, app/, pages/, app+pages hybrid, expo-router
  layout, and the no-known-layout case (must return []).
- `detectTestCmd`: explicit test script, the `npm init` placeholder
  ("no test specified") must be excluded, test:unit/test:ci fallbacks,
  and no test script at all (must return '').

This is a test-only change — no production code should need to change to
add this coverage. If a test reveals an actual detector bug beyond what's
listed above, note it in the dev log rather than silently working around it.
