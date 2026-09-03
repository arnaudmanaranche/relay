// Code-style source detection.
//
// Finds the files that state how this project's code is supposed to look:
// linter config, formatter config, and hand-written style guidance
// (CLAUDE.md, AGENTS.md, CONTRIBUTING.md, a docs/ style guide).
//
// This detector only reports which of them EXIST. It deliberately does not
// parse them: turning `eslint.config.js` into rules a model can follow is
// judgment work, and it belongs to the setup skill (which can read and
// summarize) rather than to a script (which would have to execute a config
// file to resolve `extends`, plugins, and overrides). See "Distilling the
// project's code style" in skills/setup/SKILL.md for what happens with
// this output.
//
// Why it matters: the Dev agent runs with no filesystem tools, so it never
// sees any of these files. Its output used to differ from the project's
// style for no better reason than that nobody had told it, and each
// difference surfaced as a lint failure that cost a full Dev retry.

import { exists } from './fs-helpers.mjs';

// Flat-config first — a project with both is using the flat one, and the
// legacy .eslintrc is usually a leftover.
const LINT_CONFIG_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  '.eslintrc',
  'biome.json',
  'biome.jsonc',
  'oxlint.json',
  '.oxlintrc.json',
  'tslint.json',
];

const FORMAT_CONFIG_CANDIDATES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  '.prettierrc.toml',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  '.editorconfig',
];

// Prose written for humans or agents. These are the highest-value source
// for a distilled style doc — they already explain the *why*, which a lint
// config can only imply.
const STYLE_DOC_CANDIDATES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.cursor/rules',
  '.github/copilot-instructions.md',
  'CONTRIBUTING.md',
  'docs/CONTRIBUTING.md',
  'STYLEGUIDE.md',
  'STYLE_GUIDE.md',
  'docs/styleguide.md',
  'docs/style-guide.md',
  'docs/code-style.md',
  'docs/conventions.md',
];

function present(root, candidates) {
  return candidates.filter(candidate => exists(root, candidate));
}

export function detectLintConfigFiles(root) {
  return present(root, LINT_CONFIG_CANDIDATES);
}

export function detectFormatConfigFiles(root) {
  return present(root, FORMAT_CONFIG_CANDIDATES);
}

export function detectStyleDocFiles(root) {
  return present(root, STYLE_DOC_CANDIDATES);
}

// A `prettier` / `eslintConfig` key inside package.json is a real config
// location, and one a candidate-path scan would miss entirely — a project
// configured that way looks, wrongly, like a project with no style rules
// at all.
export function detectPackageJsonStyleKeys(pkg) {
  return ['prettier', 'eslintConfig', 'biome'].filter(
    key => pkg?.[key] !== undefined
  );
}
