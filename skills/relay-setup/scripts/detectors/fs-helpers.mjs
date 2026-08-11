// Shared filesystem helpers for the per-concern detectors. Every function
// takes `root` explicitly rather than closing over a module-level constant,
// so detectors stay pure and testable in isolation.

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export function readJson(root, path) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf-8'));
  } catch {
    return null;
  }
}

export function exists(root, ...parts) {
  return existsSync(join(root, ...parts));
}

export function readText(root, path) {
  try {
    return readFileSync(join(root, path), 'utf-8');
  } catch {
    return '';
  }
}

/** List immediate children of a directory (names only). Returns [] on error. */
export function ls(root, dir) {
  try {
    return readdirSync(join(root, dir));
  } catch {
    return [];
  }
}

/**
 * Recursively find files OR directories matching a predicate, up to
 * maxDepth. Found while dogfooding: this used to only ever test the
 * predicate against files (the `else if` branch below) — a directory
 * always recursed unconditionally, never itself checked against the
 * predicate. That silently broke locales.mjs's own fallback branch, which
 * calls this specifically to find a directory NAMED 'i18n'/'intl'/
 * 'translations'/'locales' — a call that could never succeed, since
 * directory names were never actually tested.
 */
export function findFiles(root, dir, predicate, maxDepth = 3, _depth = 0) {
  if (_depth > maxDepth) return [];
  const results = [];
  try {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (predicate(entry.name, rel)) results.push(rel);
        if (!['node_modules', 'dist', 'build', '.git'].includes(entry.name)) {
          results.push(...findFiles(root, rel, predicate, maxDepth, _depth + 1));
        }
      } else if (predicate(entry.name, rel)) {
        results.push(rel);
      }
    }
  } catch {}
  return results;
}

export function isDirectory(root, rel) {
  try {
    return statSync(join(root, rel)).isDirectory();
  } catch {
    return false;
  }
}
