// Source directory layout, skip dirs, and indexed file extensions.

import { exists } from './fs-helpers.mjs';

export function detectSourceDirs(pkg, root) {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  // React Native / Expo: source is typically at root-level 'app' (expo-router) or 'src'
  if (deps?.['expo-router'] && exists(root, 'app')) {
    return ['app', 'components', 'hooks', 'lib'].filter(d => exists(root, d));
  }
  if (exists(root, 'src')) return ['src'];
  if (exists(root, 'app') && exists(root, 'pages')) return ['app', 'pages']; // Next.js app + pages hybrid
  if (exists(root, 'app')) return ['app'];
  if (exists(root, 'pages')) return ['pages'];
  // Found live: this used to fall back to ['src'] even when no src/app/pages
  // directory exists at all — confidently pointing rebuild-context.mjs (and
  // therefore the Architect/Dev's whole view of the codebase) at a directory
  // that doesn't exist, for any project that isn't a typical frontend
  // layout (e.g. a CLI/tooling repo with code under lib/, skills/, etc.).
  // Empty means "ask the user", same principle as the other detectors —
  // not a confident-looking guess that happens to be wrong.
  return [];
}

export function detectSkipDirs(pkg, root) {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const base = ['node_modules', 'dist', 'build', '.git'];
  if (deps?.['react-native'] || deps?.['expo']) {
    base.push('ios', 'android', '.expo');
  }
  if (deps?.['next']) base.push('.next');
  if (exists(root, '.svelte-kit')) base.push('.svelte-kit');
  if (exists(root, '.nuxt')) base.push('.nuxt');
  return base;
}

export function detectSourceExtensions(pkg) {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const exts = ['.ts', '.tsx'];
  if (!deps?.['typescript'] && (deps?.['react'] || deps?.['vue'])) {
    exts.push('.js', '.jsx');
  }
  if (deps?.['vue']) exts.push('.vue');
  if (deps?.['svelte']) exts.push('.svelte');
  return exts;
}
