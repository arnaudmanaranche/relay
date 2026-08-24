// Relay menu-bar core. Deterministic app logic only: polls the relay
// service for status.mjs snapshots, derives one flattened active-run list,
// renders the macOS status item + a small dashboard window, and fires
// read-only effects (reveal worktree, copy resume command).
//
// Subset constraints that shaped this file:
//   - no byte concatenation / float formatting -> display captions are
//     precomposed by the service; every other label is verbatim bytes or a
//     literal table entry keyed by RunState
//   - markup dispatches Msg arms directly with payload fields
//     ("reveal:{r.index}"); commandMsg only routes shell commands
//     (activation / Option-click) by name

import { Cmd, Sub, asciiBytes, utf8Bytes, windowDescriptor } from "@native-sdk/core";
import type {
  StatusItemState,
  WindowDescriptor,
} from "@native-sdk/core/events";
import { applyTextInputEvent, trimAsciiSpaces } from "@native-sdk/core/text";
import type { TextInputEvent, TextEditState } from "@native-sdk/core/text";
import { relayLoadConfig, relayFetchStatus, relaySaveRepos } from "@native-sdk/services";
import type {
  ActiveRun,
  AppConfig,
  RepoSummary,
  RunState,
  SaveResult,
  StatusSnapshot,
} from "./shared.ts";

export type Phase = "boot" | "watching";

export interface Model {
  readonly phase: Phase;
  readonly configScript: Uint8Array;
  readonly roots: readonly Uint8Array[];
  readonly repos: readonly RepoSummary[];
  readonly fetchInFlight: boolean;
  readonly lastSyncMs: number;
  readonly nowMs: number;
  readonly lastError: Uint8Array;
  // Settings window (model-declared): a draft copy of the configured roots
  // edited in place, the add-field buffer, and the save round-trip state.
  readonly settingsOpen: boolean;
  readonly draftRepos: readonly Uint8Array[];
  readonly newTextEditor: TextEditState;
  readonly saving: boolean;
  readonly saveError: Uint8Array;
}

export type Msg =
  | { readonly kind: "tick"; readonly at: number }
  | { readonly kind: "clock"; readonly at: number }
  | { readonly kind: "configured"; readonly config: AppConfig }
  | { readonly kind: "configure_failed"; readonly error: Uint8Array }
  | { readonly kind: "fetched"; readonly snapshot: StatusSnapshot }
  | { readonly kind: "sync_failed"; readonly error: Uint8Array }
  | { readonly kind: "synced"; readonly at: number }
  | { readonly kind: "refresh" }
  | { readonly kind: "reveal"; readonly index: number }
  | { readonly kind: "reveal_artifacts"; readonly index: number }
  | { readonly kind: "copy_resume"; readonly index: number }
  | { readonly kind: "open_dashboard" }
  | { readonly kind: "do_quit" }
  | { readonly kind: "open_settings" }
  | { readonly kind: "close_settings" }
  | { readonly kind: "new_repo_edit"; readonly edit: TextInputEvent }
  | { readonly kind: "add_new_repo" }
  | { readonly kind: "remove_draft"; readonly index: number }
  | { readonly kind: "save_repos" }
  | { readonly kind: "repos_saved" }
  | { readonly kind: "repos_save_failed"; readonly error: Uint8Array };

// Host-dispatched arms never appear in markup.
export const viewUnbound = [
  "tick",
  "clock",
  "configured",
  "configure_failed",
  "fetched",
  "sync_failed",
  "synced",
  "configScript",
  "roots",
  "fetchInFlight",
  "lastSyncMs",
  "nowMs",
  "settingsOpen",
] as const;


export function initialModel(): [Model, Cmd<Msg>] {
  const model: Model = {
    phase: "boot",
    configScript: new Uint8Array(0),
    roots: [],
    repos: [],
    fetchInFlight: false,
    lastSyncMs: -1,
    nowMs: -1,
    lastError: new Uint8Array(0),
    settingsOpen: false,
    draftRepos: [],
    newTextEditor: emptyEditor(),
    saving: false,
    saveError: new Uint8Array(0),
  };
  return [
    model,
    relayLoadConfig({ key: "boot", ok: "configured", err: "configure_failed" }),
  ];
}

export function subscriptions(model: Model): Sub<Msg> {
  return Sub.batch([
    Sub.timer("poll", 5000, "tick"),
    Sub.timer("clock", 1000, "clock"),
  ]);
}

// --- flattened active runs ------------------------------------------------

export function activeRuns(model: Model): readonly ActiveRun[] {
  let out: ActiveRun[] = [];
  for (const repo of model.repos) {
    out = out.concat(repo.active);
  }
  return out;
}

function findRun(model: Model, index: number): ActiveRun | null {
  const runs = activeRuns(model);
  if (index < 0 || index >= runs.length) return null;
  return runs[index];
}

function needsAttention(state: RunState): boolean {
  switch (state) {
    case "running":
      return false;
    default:
      return true;
  }
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// --- dashboard bindings ---------------------------------------------------

// One flattened run row; the first row of each repo carries its header.
export interface RunRow {
  readonly seq: number;
  // Global flat index across all repos — the payload of reveal/copy presses.
  readonly index: number;
  readonly slug: Uint8Array;
  readonly caption: Uint8Array;
  readonly guidance: Uint8Array;
  readonly resumeHint: Uint8Array;
  readonly resumable: boolean;
  readonly hasArtifacts: boolean;
  // Severity groups pick the row icon + tint in markup (style attributes
  // are literals-only there, so the variant choice must be a flag).
  readonly running: boolean;
  readonly gated: boolean;
  readonly failed: boolean;
  readonly hasGuidance: boolean;
  // Repo grouping: the first row of each repo renders the group header.
  readonly showHeader: boolean;
  readonly repoName: Uint8Array;
  readonly repoDone: number;
}

function severityFailed(state: RunState): boolean {
  return (
    state === "failedTypecheck" ||
    state === "failedReview" ||
    state === "failedQa" ||
    state === "crashed"
  );
}

export function runs(model: Model): readonly RunRow[] {
  const flat = activeRuns(model);
  let out: RunRow[] = [];
  let prevName: Uint8Array = new Uint8Array(0);
  // Literal bound: the integer-range prover needs a literal, not a const.
  for (let i = 0; i < 8; i += 1) {
    if (i >= flat.length) break;
    const run = flat[i];
    const showHeader = !eqBytes(run.repoName, prevName);
    prevName = run.repoName;
    let repoDone = 0;
    for (const repo of model.repos) {
      if (eqBytes(repo.name, run.repoName)) repoDone = repo.completedCount;
    }
    out = out.concat([
      {
        seq: i,
        index: i,
        slug: run.slug,
        caption: run.caption,
        guidance: run.guidance,
        resumeHint: run.resumeHint,
        resumable: run.state === "designGate",
        hasArtifacts: run.artifactsDir.length > 0,
        running: run.state === "running",
        gated: run.state !== "running" && !severityFailed(run.state),
        failed: severityFailed(run.state),
        hasGuidance: run.guidance.length > 0 && run.state !== "running",
        showHeader,
        repoName: run.repoName,
        repoDone,
      },
    ]);
  }
  return out;
}

export function hasRuns(model: Model): boolean {
  return activeRuns(model).length > 0;
}

export function watching(model: Model): boolean {
  return model.phase === "watching";
}

export function isBoot(model: Model): boolean {
  return model.phase === "boot";
}

// Service-level failure (config missing/invalid, poll spawn or JSON error).
// Cleared on the next successful fetch.
export function hasSyncError(model: Model): boolean {
  return model.lastError.length > 0;
}

export function syncError(model: Model): Uint8Array {
  return model.lastError;
}

export interface ErrorRow {
  readonly seq: number;
  readonly name: Uint8Array;
  readonly errorText: Uint8Array;
}

export function erroredRepos(model: Model): readonly ErrorRow[] {
  let out: ErrorRow[] = [];
  for (let r = 0; r < 8; r += 1) {
    if (r >= model.repos.length) break;
    const repo = model.repos[r];
    if (repo.errorText.length === 0) continue;
    out = out.concat([
      { seq: r, name: repo.name, errorText: repo.errorText },
    ]);
  }
  return out;
}

export function hasErroredRepos(model: Model): boolean {
  return erroredRepos(model).length > 0;
}

// Watching, everything healthy, nothing in flight — the calm dashboard.
export function emptyQuiet(model: Model): boolean {
  return (
    watching(model) &&
    !hasRuns(model) &&
    !hasErroredRepos(model) &&
    !hasSyncError(model)
  );
}

export function totalCompleted(model: Model): number {
  let n = 0;
  for (const repo of model.repos) n += repo.completedCount;
  return n;
}

export function repoCount(model: Model): number {
  return model.repos.length;
}

export function runningCount(model: Model): number {
  let n = 0;
  const flat = activeRuns(model);
  for (let i = 0; i < 8; i += 1) {
    if (i >= flat.length) break;
    if (flat[i].state === "running") n += 1;
  }
  return n;
}

export function attentionCount(model: Model): number {
  let n = 0;
  const flat = activeRuns(model);
  for (let i = 0; i < 8; i += 1) {
    if (i >= flat.length) break;
    if (needsAttention(flat[i].state)) n += 1;
  }
  return n;
}

export function hasAttention(model: Model): boolean {
  return attentionCount(model) > 0;
}

// --- settings bindings ------------------------------------------------------

// Fresh mirror state for the add-repo field (text + selection + composition).
function emptyEditor(): TextEditState {
  return { text: new Uint8Array(0), selection: { anchor: 0, focus: 0 }, composition: null };
}

export interface DraftRow {
  readonly seq: number;
  readonly path: Uint8Array;
}

// The draft list as rows so markup gets a key field (loop items over plain
// bytes have none). Literal bound for the prover, same as runs().
export function draftRows(model: Model): readonly DraftRow[] {
  let out: DraftRow[] = [];
  for (let i = 0; i < 32; i += 1) {
    if (i >= model.draftRepos.length) break;
    out = out.concat([{ seq: i, path: model.draftRepos[i] }]);
  }
  return out;
}

export function hasDrafts(model: Model): boolean {
  return model.draftRepos.length > 0;
}

export function noDrafts(model: Model): boolean {
  return model.draftRepos.length === 0;
}

export function draftCount(model: Model): Uint8Array {
  return utf8Bytes(`${model.draftRepos.length} configured`);
}

// The text-field binds this fn, never the editor state itself.
export function newText(model: Model): Uint8Array {
  return model.newTextEditor.text;
}

export function addDisabled(model: Model): boolean {
  return trimAsciiSpaces(model.newTextEditor.text).length === 0;
}

export function hasSaveError(model: Model): boolean {
  return model.saveError.length > 0;
}

export function saveErrorText(model: Model): Uint8Array {
  return model.saveError;
}

export function saveLabel(model: Model): Uint8Array {
  if (model.saving) return utf8Bytes("Saving…");
  return asciiBytes("Save");
}

// --- update ---------------------------------------------------------------

export function update(model: Model, msg: Msg): Model | [Model, Cmd<Msg>] {
  switch (msg.kind) {
    case "clock":
      return { ...model, nowMs: msg.at };

    case "tick": {
      const stepped: Model = { ...model, nowMs: msg.at };
      if (stepped.phase === "boot") {
        return [
          stepped,
          relayLoadConfig({ key: "boot", ok: "configured", err: "configure_failed" }),
        ];
      }
      if (stepped.fetchInFlight || stepped.configScript.length === 0) return stepped;
      const polling: Model = { ...stepped, fetchInFlight: true };
      return [
        polling,
        relayFetchStatus(
          { config: { statusScript: stepped.configScript, roots: stepped.roots } },
          { key: "poll", ok: "fetched", err: "sync_failed" },
        ),
      ];
    }

    case "configured": {
      const configured: Model = {
        ...model,
        phase: "watching",
        configScript: msg.config.statusScript,
        roots: msg.config.roots,
        lastError: new Uint8Array(0),
      };
      return [
        configured,
        relayFetchStatus(
          { config: { statusScript: msg.config.statusScript, roots: msg.config.roots } },
          { key: "poll", ok: "fetched", err: "sync_failed" },
        ),
      ];
    }

    case "configure_failed":
      return { ...model, phase: "boot", lastError: msg.error };

    case "fetched": {
      const cleared: Model = {
        ...model,
        repos: msg.snapshot.repos,
        fetchInFlight: false,
        lastError: new Uint8Array(0),
      };
      return [cleared, Cmd.now("synced")];
    }

    case "synced":
      return { ...model, lastSyncMs: msg.at };

    case "sync_failed":
      return { ...model, fetchInFlight: false, lastError: msg.error };

    case "refresh": {
      if (model.fetchInFlight || model.configScript.length === 0) return model;
      const polling: Model = { ...model, fetchInFlight: true };
      return [
        polling,
        relayFetchStatus(
          { config: { statusScript: model.configScript, roots: model.roots } },
          { key: "poll", ok: "fetched", err: "sync_failed" },
        ),
      ];
    }

    case "reveal": {
      const run = findRun(model, msg.index);
      if (run === null || run.worktree.length === 0) return model;
      return [model, Cmd.revealPath(run.worktree)];
    }

    case "reveal_artifacts": {
      const run = findRun(model, msg.index);
      if (run === null || run.artifactsDir.length === 0) return model;
      return [model, Cmd.revealPath(run.artifactsDir)];
    }

    case "copy_resume": {
      const run = findRun(model, msg.index);
      if (run === null || run.resumeHint.length === 0) return model;
      return [model, Cmd.clipboardWrite(run.resumeHint)];
    }

    case "open_dashboard":
      return [model, Cmd.showWindow("main")];

    case "do_quit":
      return [model, Cmd.quitApp()];

    // --- settings -------------------------------------------------------------

    case "open_settings": {
      const draft = model.roots.map((root) => root.slice());
      return {
        ...model,
        settingsOpen: true,
        draftRepos: draft,
        newTextEditor: emptyEditor(),
        saving: false,
        saveError: new Uint8Array(0),
      };
    }

    case "close_settings":
      return { ...model, settingsOpen: false };

    case "new_repo_edit": {
      const applied = applyTextInputEvent(model.newTextEditor, msg.edit, 512);
      // null = the edit would not fit the capacity; keep the old state.
      if (applied === null) return model;
      return { ...model, newTextEditor: applied };
    }

    case "add_new_repo": {
      const entry = trimAsciiSpaces(model.newTextEditor.text);
      if (entry.length === 0) return model;
      for (const existing of model.draftRepos) {
        if (eqBytes(existing, entry)) return { ...model, newTextEditor: emptyEditor() };
      }
      return {
        ...model,
        draftRepos: model.draftRepos.concat([entry.slice()]),
        newTextEditor: emptyEditor(),
      };
    }

    case "remove_draft": {
      let kept: readonly Uint8Array[] = [];
      for (let i = 0; i < model.draftRepos.length; i += 1) {
        if (i !== msg.index) kept = kept.concat([model.draftRepos[i]]);
      }
      return { ...model, draftRepos: kept };
    }

    case "save_repos":
      if (model.saving) return model;
      return [
        { ...model, saving: true, saveError: new Uint8Array(0) },
        relaySaveRepos(
          { repos: model.draftRepos },
          { key: "save", ok: "repos_saved", err: "repos_save_failed" },
        ),
      ];

    case "repos_saved":
      // The file is on disk; re-resolve the config so changed roots take
      // effect immediately (the configured arm fetches fresh status too).
      return [
        { ...model, saving: false, settingsOpen: false },
        relayLoadConfig({ key: "boot", ok: "configured", err: "configure_failed" }),
      ];

    case "repos_save_failed":
      return { ...model, saving: false, saveError: msg.error };
  }
}

// --- command routing (status item shell + markup payloads) ------------------

export function commandMsg(name: string): Msg | null {
  if (name === "app.refresh") return { kind: "refresh" };
  if (name === "app.open_dashboard") return { kind: "open_dashboard" };
  if (name === "app.quit") return { kind: "do_quit" };
  if (name === "app.settings-closed") return { kind: "close_settings" };
  return null;
}

// --- model-declared windows ---------------------------------------------------

// The settings window exists while settingsOpen is committed model state
// (presence is liveness). A user close is routed back through commandMsg as
// app.settings-closed, which clears the flag.
export function windows(model: Model): readonly WindowDescriptor[] {
  if (!model.settingsOpen) return [];
  return [
    windowDescriptor({
      label: asciiBytes("settings"),
      canvasLabel: asciiBytes("settings-canvas"),
      title: asciiBytes("Relay Settings"),
      width: 480,
      height: 420,
      resizable: true,
      closePolicy: "quit",
      onCloseCommand: asciiBytes("app.settings-closed"),
    }),
  ];
}

// --- menu-bar status item ---------------------------------------------------

function menuTitle(model: Model): Uint8Array {
  const all = activeRuns(model);
  let attention = false;
  let running = false;
  for (const run of all) {
    if (needsAttention(run.state)) attention = true;
    if (run.state === "running") running = true;
  }
  if (attention) return asciiBytes("! RELAY");
  if (running) return asciiBytes("> RELAY");
  return asciiBytes("RELAY");
}

export function statusItem(_model: Model): StatusItemState {
  // The tray is deliberately menu-less: the AppKit host pops the dropdown
  // AND fires the activation command on every click when items exist, which
  // duplicated the dashboard with a second, weaker surface. With no items
  // the native menu stays nil and a click is purely "open the dashboard";
  // Option-click still refreshes. Every action lives in the window.
  return {
    iconPath: asciiBytes("assets/menu-bar.svg"),
    tooltip: utf8Bytes("Relay pipelines"),
    activationCommand: asciiBytes("app.open_dashboard"),
    alternateActivationCommand: asciiBytes("app.refresh"),
    openCommand: asciiBytes(""),
    presentation: {
      title: menuTitle(_model),
      width: 74,
      tone: "normal",
      iconOpacity: 1,
      monospaced: true,
      fontSize: 12,
      fontWeight: "semibold",
    },
    items: [],
  };
}
