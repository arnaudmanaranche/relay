// Tests for skills/relay-pipeline/scripts/upload-build.sh
//
// The stage shells out to the asc CLI, so every test runs against a stubbed
// `asc` binary placed first on PATH. The stub records each invocation's argv
// (one space-joined line per call into $ASC_CALLS) and can be told to fail at
// a specific step via ASC_STUB_FAIL ("build-number" | "archive" | "export" |
// "upload" | "testflight"). Real asc JSON shapes are mimicked closely enough
// for the script's node parsers (buildNumber, build.version).
//
// Each test gets a throwaway git repo as project root — upload-build.sh runs
// `git add -u` after the build-number bump, which requires a repository.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, '..', 'skills', 'relay-pipeline', 'scripts', 'upload-build.sh');

const tmpDirs = [];
function makeTmpDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `relay-upload-${prefix}-`));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

// Built as an explicit line array rather than a template literal — the
// \$ / \\n escape interactions inside a template literal are exactly the
// kind of thing that silently produces a broken stub.
const ASC_STUB = [
  '#!/usr/bin/env bash',
  "printf '%s\\n' \"$*\" >> \"$ASC_CALLS\"",
  'step=""',
  'case " $* " in',
  '  *" xcode version "* ) step="build-number" ;;',
  '  *" xcode archive "* ) step="archive" ;;',
  '  *" xcode export "* )',
  '    step="export"',
  '    # Materialize the IPA the way a real export would.',
  '    prev=""',
  '    for a in "$@"; do',
  '      if [ "$prev" = "--ipa-path" ]; then',
  '        mkdir -p "$(dirname "$a")"',
  '        : > "$a"',
  '      fi',
  '      prev="$a"',
  '    done',
  '    ;;',
  '  *" builds upload "* ) step="upload" ;;',
  '  *" publish testflight "* ) step="testflight" ;;',
  'esac',
  'if [ -n "$ASC_STUB_FAIL" ] && [ "$ASC_STUB_FAIL" = "$step" ]; then',
  '  echo "stubbed asc failure at $step" >&2',
  '  exit 1',
  'fi',
  'if [ "$step" = "build-number" ]; then echo \'{"buildNumber":"42"}\'; fi',
  'if [ "$step" = "upload" ]; then echo \'{"build":{"version":"42"}}\'; fi',
  'exit 0',
].join('\n');

function makeProject({ config } = {}) {
  const dir = makeTmpDir('ok');
  mkdirSync(join(dir, '.ai', 'artifacts', 'features', 'demo'), { recursive: true });
  writeFileSync(
    join(dir, '.ai', 'config.json'),
    JSON.stringify({
      project: { appId: '123456789' },
      ios: { scheme: 'MyApp', workspace: '', project: 'ios/MyApp.xcodeproj', configuration: 'Release', ...(config || {}) },
    })
  );
  // The configured project path must exist — upload-build.sh guards on it.
  mkdirSync(join(dir, 'ios', 'MyApp.xcodeproj'), { recursive: true });
  const stubDir = join(dir, '.stub');
  mkdirSync(stubDir);
  const ascPath = join(stubDir, 'asc');
  writeFileSync(ascPath, ASC_STUB);
  chmodSync(ascPath, 0o755);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  // Hermetic identity — the script now commits the upload report on success.
  execFileSync('git', ['config', 'user.email', 'relay-test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Relay Test'], { cwd: dir });
  return { dir, stubDir };
}

function runUploadBuild(dir, { extraArgs = [], failAt } = {}) {
  const callsFile = join(dir, 'asc-calls.log');
  const env = {
    ...process.env,
    PATH: `${join(dir, '.stub')}:${process.env.PATH}`,
    ASC_CALLS: callsFile,
  };
  if (failAt) env.ASC_STUB_FAIL = failAt;
  try {
    execFileSync('bash', [SCRIPT, 'demo', `--project-root=${dir}`, ...extraArgs], {
      cwd: dir,
      env,
      stdio: 'pipe',
    });
    return { code: 0, calls: readCalls(callsFile) };
  } catch (err) {
    return { code: err.status ?? 1, calls: readCalls(callsFile), stderr: String(err.stderr || '') };
  }
}

function readCalls(file) {
  try {
    return readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function readReport(dir) {
  return readFileSync(join(dir, '.ai', 'artifacts', 'features', 'demo', 'build-upload.md'), 'utf-8');
}

function steps(calls) {
  // Pad each line so patterns can require word boundaries via spaces —
  // 'xcode version' at position 0 must still match.
  return calls.map((c) => {
    const p = ` ${c} `;
    if (p.includes(' xcode version ')) return 'build-number';
    if (p.includes(' xcode archive ')) return 'archive';
    if (p.includes(' xcode export ')) return 'export';
    if (p.includes(' builds upload ')) return 'upload';
    if (p.includes(' publish testflight ')) return 'testflight';
    return 'unknown';
  });
}

test('happy path: build number → archive → export → upload, success report written', () => {
  const { dir } = makeProject({});
  const { code, calls } = runUploadBuild(dir);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(steps(calls), ['build-number', 'archive', 'export', 'upload']);

  const report = readReport(dir);
  assert.match(report, /\*\*Status:\*\* success/);
  assert.match(report, /\*\*Build number:\*\* 42/);
  assert.match(report, /\*\*TestFlight:\*\* skipped \(ios\.testflightGroup not set\)/);

  // Archive targets the configured project with the generic iOS destination;
  // export passes provisioning updates through.
  assert.ok(calls.some((c) => c.includes('--project ios/MyApp.xcodeproj') && c.includes('generic/platform=iOS')));
  assert.ok(calls.some((c) => c.includes('xcodebuild-flag=-allowProvisioningUpdates')));
  assert.ok(calls.some((c) => c.includes('builds upload') && c.includes('--app 123456789') && c.includes('--wait')));

  // The report is committed so it survives worktree cleanup and reaches the
  // open PR when run-pipeline.sh pushes after this script succeeds.
  const log = execFileSync('git', ['log', '--format=%s'], { cwd: dir }).toString().trim().split('\n');
  assert.ok(log.includes('chore(ship): record build upload for demo'), `expected report commit, got: ${log.join(' | ')}`);
});

test('workspace wins over bare project when both are configured', () => {
  const { dir } = makeProject({ config: { workspace: 'ios/MyApp.xcworkspace' } });
  // makeProject already created ios/MyApp.xcodeproj; add the workspace dir.
  mkdirSync(join(dir, 'ios', 'MyApp.xcworkspace'), { recursive: true });
  const { code, calls } = runUploadBuild(dir);
  assert.strictEqual(code, 0);
  assert.ok(calls.some((c) => c.includes('--workspace ios/MyApp.xcworkspace')));
  assert.ok(!calls.some((c) => c.includes('--project ios/MyApp.xcodeproj')));
});

test('TestFlight distribution runs when ios.testflightGroup is set', () => {
  const { dir } = makeProject({ config: { testflightGroup: 'Internal Beta' } });
  const { code, calls } = runUploadBuild(dir);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(steps(calls), ['build-number', 'archive', 'export', 'upload', 'testflight']);
  assert.ok(calls.some((c) => c.includes('publish testflight') && c.includes('--group Internal Beta')));
  assert.match(readReport(dir), /distributed/);
});

test('missing appId fails fast before any asc call', () => {
  const { dir } = makeProject({});
  // Overwrite config without appId.
  writeFileSync(
    join(dir, '.ai', 'config.json'),
    JSON.stringify({ project: {}, ios: { scheme: 'MyApp', project: 'ios/MyApp.xcodeproj' } })
  );
  const { code, calls } = runUploadBuild(dir);
  assert.strictEqual(code, 1);
  assert.deepStrictEqual(calls, []);
});

test('archive failure writes a failure report naming the step and exits 1', () => {
  const { dir } = makeProject();
  const { code, calls } = runUploadBuild(dir, { failAt: 'archive' });
  assert.strictEqual(code, 1);
  // Build number succeeded, archive did not — export/upload never ran.
  assert.deepStrictEqual(steps(calls), ['build-number', 'archive']);
  const report = readReport(dir);
  assert.match(report, /\*\*Status:\*\* failure/);
  assert.match(report, /Failed at: archive/);
  assert.match(report, /stubbed asc failure at archive/);
});

test('failed TestFlight after successful upload reports partial status', () => {
  const { dir } = makeProject({ config: { testflightGroup: 'Internal Beta' } });
  const { code, calls } = runUploadBuild(dir, { failAt: 'testflight' });
  assert.strictEqual(code, 1);
  assert.deepStrictEqual(steps(calls), ['build-number', 'archive', 'export', 'upload', 'testflight']);
  const report = readReport(dir);
  assert.match(report, /\*\*Status:\*\* partial/);
  assert.match(report, /Failed at: testflight/);
});

test('dry-run plans all steps without invoking asc or writing artifacts', () => {
  const { dir } = makeProject({ config: { testflightGroup: 'Internal Beta' } });
  const { code, calls } = runUploadBuild(dir, { extraArgs: ['--dry-run'] });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(calls, []); // stub never invoked
  const report = readReport(dir);
  assert.match(report, /\*\*Status:\*\* dry-run/);
  assert.match(report, /- `asc xcode archive /);
  assert.match(report, /- `asc builds upload /);
  assert.match(report, /- `asc publish testflight /);
  assert.match(report, /TestFlight group:\*\* Internal Beta — planned/);
});
