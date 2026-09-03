#!/usr/bin/env node
// Auto-detect project stack from existing files — Relay setup
// Usage: node detect-stack.mjs [--project-root=<path>]
// Output: JSON printed to stdout — consumed by setup to pre-fill prompts
//
// Detection logic lives in ./detectors/*.mjs, one file per concern, so this
// file stays a thin composer instead of growing unbounded every time a new
// stack signal gets added.

import { readJson } from './detectors/fs-helpers.mjs';
import { detectPackageManager, detectRunScript, detectTypecheckCmd, detectLintCmd, detectLintFixCmd, detectTestCmd, detectFormatCmd, detectFormatWriteCmd } from './detectors/commands.mjs';
import { detectProjectName, detectAppId, detectGithubRepo, detectDefaultBranch } from './detectors/project.mjs';
import { detectProjectType } from './detectors/project-type.mjs';
import { detectRouter, detectStyling, detectBackend } from './detectors/stack.mjs';
import { detectAnalytics } from './detectors/analytics.mjs';
import { detectPaywall } from './detectors/paywall.mjs';
import { detectErrorTracking } from './detectors/error-tracking.mjs';
import { detectE2E } from './detectors/e2e.mjs';
import { detectLocales } from './detectors/locales.mjs';
import { detectIos } from './detectors/ios.mjs';
import { detectSourceDirs, detectSkipDirs, detectSourceExtensions } from './detectors/source-layout.mjs';
import { detectSchemaFiles } from './detectors/schema.mjs';

const ROOT = (() => {
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--project-root=(.+)$/);
    if (m) return m[1];
  }
  return process.cwd();
})();

const pkg = readJson(ROOT, 'package.json');
const e2e = detectE2E(ROOT);
const { locales, dir: localeDir } = detectLocales(ROOT);
const ios = detectIos(ROOT);
const sourceDirs = detectSourceDirs(pkg, ROOT);
const skipDirs = detectSkipDirs(pkg, ROOT);
const sourceExtensions = detectSourceExtensions(pkg);
const packageManager = detectPackageManager(ROOT);
const projectType = detectProjectType(pkg);

const detected = {
  project_name:       detectProjectName(pkg, ROOT),
  project_type:       projectType,
  app_id:             detectAppId(pkg, ROOT, projectType),
  github_repo:        detectGithubRepo(ROOT),
  package_manager:    packageManager,
  run_script:         detectRunScript(pkg),
  typecheck_cmd:      detectTypecheckCmd(pkg, packageManager),
  lint_cmd:           detectLintCmd(pkg, packageManager),
  lint_fix_cmd:       detectLintFixCmd(pkg, packageManager),
  test_cmd:           detectTestCmd(pkg, packageManager),
  format_cmd:         detectFormatCmd(pkg, packageManager),
  format_write_cmd:   detectFormatWriteCmd(pkg, packageManager),
  default_branch:     detectDefaultBranch(ROOT),
  branch_prefix:      'feat',
  locales,
  locale_dir:         localeDir,
  analytics_provider: detectAnalytics(pkg, ROOT),
  paywall_provider:   detectPaywall(pkg),
  backend_service:    detectBackend(pkg),
  error_tracking:     detectErrorTracking(pkg),
  e2e_framework:      e2e.framework,
  e2e_dir:            e2e.dir,
  source_dirs:        sourceDirs.join(','),
  skip_dirs:          skipDirs.join(','),
  source_extensions:  sourceExtensions.join(','),
  schema_files:       detectSchemaFiles(ROOT).join(','),
  router:             detectRouter(pkg),
  styling:            detectStyling(pkg),
  ios_scheme:         ios.scheme,
  ios_workspace:      ios.workspace,
  ios_project:        ios.project,
};

// Print as JSON — setup reads this to pre-fill prompts
process.stdout.write(JSON.stringify(detected, null, 2) + '\n');
