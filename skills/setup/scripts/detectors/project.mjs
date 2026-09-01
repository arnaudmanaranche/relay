// Project identity: name, app id, github repo, default git branch.

import { basename } from 'path';
import { readJson, readText } from './fs-helpers.mjs';

export function detectProjectName(pkg, root) {
  if (pkg?.name) {
    // Convert package name to display name: my-app → My App
    return pkg.name
      .replace(/^@[^/]+\//, '') // strip scope
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  // Fall back to directory name
  return basename(root)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function detectAppId(pkg, root, projectType) {
  // expo app.json (static)
  const appJson = readJson(root, 'app.json');
  if (appJson?.expo?.android?.package) return appJson.expo.android.package;
  if (appJson?.expo?.ios?.bundleIdentifier) return appJson.expo.ios.bundleIdentifier;

  // expo app.config.ts / app.config.js (dynamic config — the modern Expo
  // default, and JS/TS, so not readable as JSON). Regex-extracted from the
  // raw text rather than imported/executed — this script only ever reads
  // files, never runs project code.
  for (const configFile of ['app.config.ts', 'app.config.js']) {
    const text = readText(root, configFile);
    const iosMatch = text.match(/bundleIdentifier\s*:\s*['"]([^'"]+)['"]/);
    if (iosMatch) return iosMatch[1];
    const androidMatch = text.match(/package\s*:\s*['"]([^'"]+)['"]/);
    if (androidMatch) return androidMatch[1];
  }

  // Capacitor
  const capacitorJson = readJson(root, 'capacitor.config.json');
  if (capacitorJson?.appId) return capacitorJson.appId;

  // No explicit mobile config found and no positive mobile signal at all
  // (if there were one, one of the checks above would already have
  // returned). A bundle-id-shaped fallback like `com.example.<name>` is
  // meaningless for anything that isn't actually mobile — only fabricate
  // one when projectType is confidently 'mobile'. Found live: a plain
  // library/webapp with projectType 'unknown' (no router, no mobile
  // framework, no config file) got handed a fabricated
  // `com.example.<name>` here anyway, contradicting this module's own
  // documented setup guidance ("unknown — don't assume a default beyond
  // what detect-stack.mjs returned; ask plainly").
  if (projectType !== 'mobile') return '';

  // Derive from package name
  if (pkg?.name) {
    const clean = pkg.name.replace(/^@[^/]+\//, '').replace(/[^a-z0-9]/g, '.');
    return `com.example.${clean}`;
  }
  return 'com.example.app';
}

export function detectGithubRepo(root) {
  // Try to read from git remote
  const gitConfig = readText(root, '.git/config');
  const match = gitConfig.match(/url\s*=\s*.*github\.com[:/]([^/\s]+\/[^\s.]+)/);
  if (match) return match[1].replace(/\.git$/, '');

  // Try package.json repository field
  return 'org/repo';
}

export function detectDefaultBranch(root) {
  const gitHead = readText(root, '.git/HEAD');
  const match = gitHead.match(/ref: refs\/heads\/(.+)/);
  return match?.[1]?.trim() || 'main';
}
