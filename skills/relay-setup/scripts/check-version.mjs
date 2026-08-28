#!/usr/bin/env node
// Compares a target project's installed Relay version against this
// module's own version — Relay update check
// Usage: node check-version.mjs --project-root=<path>
// Output: JSON printed to stdout — {current, latest, upToDate, behind}
//
// Deterministic on purpose, same reason as detect-stack.mjs: "is this
// project behind?" should be answered by reading two files, not by an
// agent's judgment call.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ROOT = (() => {
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--project-root=(.+)$/);
    if (m) return m[1];
  }
  return process.cwd();
})();

function readModuleVersion() {
  const moduleYamlPath = join(__dirname, '..', 'assets', 'module.yaml');
  const text = readFileSync(moduleYamlPath, 'utf-8');
  const match = text.match(/^module_version:\s*(\S+)/m);
  if (!match) {
    throw new Error(`module_version not found in ${moduleYamlPath}`);
  }
  return match[1];
}

function readProjectVersion() {
  const configPath = join(ROOT, '.ai', 'config.json');
  if (!existsSync(configPath)) return null;
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  return config.relayVersion ?? null;
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

const latest = readModuleVersion();
const current = readProjectVersion();
const behind = current === null || compareSemver(current, latest) < 0;

console.log(JSON.stringify({
  current,
  latest,
  upToDate: !behind,
  behind,
}, null, 2));
