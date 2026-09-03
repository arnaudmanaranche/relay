# Code style

Template for the `dev` role's `extraSkills`. Setup copies this to `.relay/skills/code-style.md`, **rewrites every section with this project's actual rules**, and wires it up:

```json
"extraSkills": [".relay/skills/code-style.md"]
```

Unlike `ui-standards.md`, this file is worthless as-is: it is a shape to fill in, not a starter set of opinions. Its content comes from distilling the project's real linter config, formatter config, and style docs — see "Distilling the project's code style" in `skills/setup/SKILL.md` for how, and what to leave out.

Delete this header block when you fill it in.

## What NOT to put here

Read this before writing anything below it.

- **Nothing a formatter fixes on its own.** Quote style, semicolons, trailing commas, indent width, line length, import sorting when a plugin sorts it: `run-pipeline.sh` runs `commands.lintFix` and `commands.formatWrite` over the worktree *before* the quality gates judge it, so these are corrected mechanically in milliseconds. A rule here spends prompt budget on every single Dev call for the life of the project to prevent something that was already being fixed for free.
- **Nothing the typechecker already enforces.** `strict` mode, no-implicit-any, exhaustive switches: a violation is a typecheck failure with an exact file and line, which is better feedback than a prose rule.
- **Nothing generic.** "Write readable code", "use meaningful names", "avoid duplication" — the model already writes this way by default, and a list of platitudes dilutes the rules that actually matter.

What belongs here is the opposite: the project-specific rules a machine can flag but not fix, and the conventions that are invisible in any single file.

## Naming

The project's real conventions, stated concretely, with what they apply to — not a generic list. Say what files, components, hooks, services, types, tests, and constants are actually named in this codebase, with one real example each.

## Imports and module boundaries

- The path alias and when to use it vs. a relative import.
- Which layers may not import which (e.g. `no-restricted-imports` rules, a UI layer that must not reach into data access).
- Barrel-file policy: expected, tolerated, or banned.

## Error handling

How this project actually reports and recovers from failures: the error type or wrapper, whether throwing is acceptable, how errors reach the user, what must never be swallowed, and where the error-tracking SDK is invoked.

## Async and data access

The project's real pattern for fetching, caching, and mutating — the specific client/hook/service to use, and what a new call site must look like to match it.

## Tests

Where tests live, how they are named, which framework and assertion style, what a new test file is expected to include, and what is not worth testing here.

## Lint rules that fail the build

The specific rules whose violation fails `commands.lint` and cannot be auto-fixed — the ones that would otherwise cost a Dev retry. State each as a rule to follow, not as a rule name: "never leave a `useEffect` without a dependency array" beats "`react-hooks/exhaustive-deps` is on".

## Project-specific prohibitions

Anything this codebase bans for a reason a linter cannot express: a deprecated internal module, a library being migrated away from, a global that must go through a wrapper. Include the *why* in one clause — a rule with a reason survives contact with a case it didn't anticipate.
