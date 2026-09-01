// iOS native-project signals for App Store build uploads — used by
// setup to pre-fill the ios.* config section and by the opt-in
// --upload-build pipeline stage. Dependency-only detectors can't see these:
// scheme/workspace/project live in the filesystem (ios/ directory from a
// React Native or Expo prebuild, or an Xcode project at the repo root).
//
// All three fields are best-effort guesses — Xcode has no canonical mapping
// from directory layout to scheme name — so every value here is a prompt
// default the user can override during setup, never a source of truth.

import { exists, ls } from './fs-helpers.mjs';

/** Strip a trailing .xcworkspace/.xcodeproj/.xcodeproj extension. */
function baseName(name) {
  return name.replace(/\.xcworkspace$|\.xcodeproj$/, '');
}

/**
 * Detect iOS build inputs: { scheme, workspace, project }.
 *
 * Looks in the conventional `ios/` directory first (React Native / Expo
 * prebuild layout), then the repo root (bare Xcode projects). Prefers a
 * workspace over a bare project when both exist — CocoaPods apps only
 * archive correctly from the workspace. Scheme defaults to the project's
 * base name, matching Xcode's own default scheme naming.
 */
export function detectIos(root) {
  const result = { scheme: '', workspace: '', project: '' };
  const dirs = ['ios', '.'].filter((dir) => exists(root, dir));
  const rel = (dir, name) => (dir === '.' ? name : `${dir}/${name}`);
  let projName = '';
  for (const dir of dirs) {
    const entries = ls(root, dir).sort();
    if (!result.workspace) {
      const ws = entries.find((e) => e.endsWith('.xcworkspace')) || '';
      if (ws) result.workspace = rel(dir, ws);
    }
    if (!result.project) {
      // Skip the workspace's internal project wrapper (<name>.xcworkspace/<name>.xcodeproj
      // shows up as a sibling-named .xcodeproj only in odd layouts; a plain
      // suffix match on immediate children is enough here).
      const proj = entries.find((e) => e.endsWith('.xcodeproj')) || '';
      if (proj) {
        result.project = rel(dir, proj);
        projName = baseName(proj);
      }
    }
    if (result.workspace && result.project) break;
  }
  if (projName) result.scheme = projName;
  return result;
}
