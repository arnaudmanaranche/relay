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
import {
  relayLoadConfig,
  relayFetchStatus,
  relaySaveRepos,
  relayRetryRun,
  relayOpenInEditor,
  relayReadArtifact,
  relaySubmitAnswer,
  relayReadLog,
  relayStartRun,
  relayStopRun,
  relayReadTimeline,
} from "@native-sdk/services";
import type {
  ActiveRun,
  AppConfig,
  CompletedFeature,
  ReadArtifactResult,
  ReadLogResult,
  ReadTimelineResult,
  RepoSummary,
  RunState,
  SaveResult,
  StartRunResult,
  StatusSnapshot,
  RetryResult,
  OpenResult,
  StopRunResult,
  SubmitAnswerResult,
  TimelineRow,
} from "./shared.ts";

// Scrollback is trimmed to this many bytes on every poll — an unbounded
// byte array isn't provable in the core subset, and a live pipeline log
// is only ever usefully read from its tail anyway. Polled rather than
// pushed: native-sdk's Cmd.ptySpawn exists in the TS SDK surface but this
// SDK version's contract generator can't yet lower its event shape
// (confirmed by trial — see RetryResult.logPath in shared.ts), so the
// run-detail window watches a run the same way retryRun's existing
// detached-spawn-to-logfile path already does, just polled on a timer
// instead of left for the user to `cat` themselves.
const SCROLLBACK_CAP = 65536;

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
  // Last Retry / Open in Code failure, shown in the dashboard until the
  // next successful action or poll clears it. Not tied to a specific row —
  // there is at most one in flight at a time (each is a single click).
  readonly actionError: Uint8Array;
  // The run-detail window: at most one open at a time (opening a
  // different run tears this one down first — see "open_run").
  readonly openRun: OpenRun | null;
  // The run-detail window's answer draft — flat on Model like
  // newTextEditor above, not nested inside OpenRun.
  readonly answerEditor: TextEditState;
  // The "New Feature" window: empty newRunRepoRoot means no repo chosen
  // yet (the form's first step — pick a repo, then slug + issue text
  // appear). Deliberately Uint8Array, not an index into model.repos —
  // storing an interaction-derived NUMBER in Model and indexing with it
  // later (across pick_new_run_repo/submit_new_run/new_run_started) is
  // NOT a pattern used anywhere else in this file, and confirmed by
  // trial to be unprovable however the guard was spelled; every other
  // "pick one of these rows" flow in this file (runs(), draftRows(),
  // erroredRepos()) only ever uses a loop-bounded index within its OWN
  // function, never carries one across dispatches in Model.
  readonly newRunOpen: boolean;
  readonly newRunRepoRoot: Uint8Array;
  readonly newRunRepoName: Uint8Array;
  readonly newRunSlugEditor: TextEditState;
  readonly newRunIssueEditor: TextEditState;
  readonly newRunSubmitting: boolean;
  readonly newRunError: Uint8Array;
}

export type OpenRunPhase = "idle" | "running" | "exited";

// Snapshot of one active run's fields taken when its window opened, plus
// everything the window itself accumulates (pty output, loaded artifact
// text, the answer draft). Deliberately NOT re-synced from later polls —
// switching what a run detail window shows mid-read would be jarring, and
// action buttons dispatch off runIndex/resumeArgs captured at open time.
export interface OpenRun {
  readonly runIndex: number;
  readonly slug: Uint8Array;
  readonly repoRoot: Uint8Array;
  readonly artifactsDir: Uint8Array;
  readonly state: RunState;
  readonly resumeArgs: readonly Uint8Array[];
  // Set once relayRetryRun starts the process; polled by log_poll_tick
  // while phase is "running" (see the SCROLLBACK_CAP comment above).
  readonly logPath: Uint8Array;
  // The live process's pid — from ActiveRun.pid (a row already running
  // outside the app, per status.mjs's livePid) or from the fresh spawn's
  // own result (detail_run_started/new_run_started). 0 = nothing to
  // stop. Lets Stop reach a run whichever way it got started, which is
  // the whole point: a run watched only because it's "already running
  // outside the app" couldn't be stopped at all before this existed.
  readonly pid: number;
  readonly scrollback: Uint8Array;
  readonly phase: OpenRunPhase;
  readonly exitSummary: Uint8Array;
  readonly planContent: Uint8Array;
  readonly planLoaded: boolean;
  readonly questionsContent: Uint8Array;
  readonly questionsLoaded: boolean;
  readonly submitting: boolean;
  readonly actionError: Uint8Array;
  // The owning repo's configured budget — looked up once at open time
  // (see the open_run case). budgetUsd 0 = unset; budgetText is the
  // precomposed "$15.00" for display (RepoSummary.maxBudgetText).
  readonly budgetUsd: number;
  readonly budgetText: Uint8Array;
  // Loaded once at open, then re-read on the same log_poll_tick cadence
  // as scrollback while phase is "running" (see readTimeline in
  // relay.ts) — capped at 8 rows, one per fixed pipeline role.
  readonly timeline: readonly TimelineRow[];
  readonly timelineLoaded: boolean;
  readonly timelineTotalCostText: Uint8Array;
  readonly timelineTotalTokens: number;
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
  | { readonly kind: "retry"; readonly index: number }
  | { readonly kind: "retried"; readonly result: RetryResult }
  | { readonly kind: "retry_failed"; readonly error: Uint8Array }
  | { readonly kind: "open_in_editor"; readonly index: number }
  | { readonly kind: "editor_opened"; readonly result: OpenResult }
  | { readonly kind: "editor_open_failed"; readonly error: Uint8Array }
  | { readonly kind: "open_dashboard" }
  | { readonly kind: "do_quit" }
  | { readonly kind: "open_settings" }
  | { readonly kind: "close_settings" }
  | { readonly kind: "new_repo_edit"; readonly edit: TextInputEvent }
  | { readonly kind: "add_new_repo" }
  | { readonly kind: "remove_draft"; readonly index: number }
  | { readonly kind: "save_repos" }
  | { readonly kind: "repos_saved"; readonly result: SaveResult }
  | { readonly kind: "repos_save_failed"; readonly error: Uint8Array }
  // --- run-detail window ---------------------------------------------
  | { readonly kind: "open_run"; readonly index: number }
  | { readonly kind: "close_run" }
  | { readonly kind: "run_pty" }
  | { readonly kind: "detail_run_started"; readonly result: RetryResult }
  | { readonly kind: "detail_run_start_failed"; readonly error: Uint8Array }
  | { readonly kind: "log_poll_tick"; readonly at: number }
  | { readonly kind: "log_polled"; readonly result: ReadLogResult }
  | { readonly kind: "log_poll_failed"; readonly error: Uint8Array }
  | { readonly kind: "plan_loaded"; readonly result: ReadArtifactResult }
  | { readonly kind: "plan_load_failed"; readonly error: Uint8Array }
  | { readonly kind: "questions_loaded"; readonly result: ReadArtifactResult }
  | { readonly kind: "questions_load_failed"; readonly error: Uint8Array }
  | { readonly kind: "answer_edit"; readonly edit: TextInputEvent }
  | { readonly kind: "submit_answer" }
  | { readonly kind: "answer_submitted"; readonly result: SubmitAnswerResult }
  | { readonly kind: "answer_submit_failed"; readonly error: Uint8Array }
  | { readonly kind: "stop_run" }
  | { readonly kind: "run_stopped"; readonly result: StopRunResult }
  | { readonly kind: "run_stop_failed"; readonly error: Uint8Array }
  | { readonly kind: "timeline_loaded"; readonly result: ReadTimelineResult }
  | { readonly kind: "timeline_load_failed"; readonly error: Uint8Array }
  // --- new-feature window ----------------------------------------------
  | { readonly kind: "open_new_run" }
  | { readonly kind: "close_new_run" }
  | { readonly kind: "pick_new_run_repo"; readonly index: number }
  | { readonly kind: "reset_new_run_repo" }
  | { readonly kind: "new_run_slug_edit"; readonly edit: TextInputEvent }
  | { readonly kind: "new_run_issue_edit"; readonly edit: TextInputEvent }
  | { readonly kind: "submit_new_run" }
  | { readonly kind: "new_run_started"; readonly result: StartRunResult }
  | { readonly kind: "new_run_start_failed"; readonly error: Uint8Array };

// Host-dispatched arms never appear in markup.
export const viewUnbound = [
  "tick",
  "clock",
  "configured",
  "configure_failed",
  "fetched",
  "sync_failed",
  "synced",
  "retried",
  "retry_failed",
  "editor_opened",
  "editor_open_failed",
  "configScript",
  "roots",
  "fetchInFlight",
  "lastSyncMs",
  "nowMs",
  "settingsOpen",
  "detail_run_started",
  "detail_run_start_failed",
  "log_poll_tick",
  "log_polled",
  "log_poll_failed",
  "plan_loaded",
  "plan_load_failed",
  "questions_loaded",
  "questions_load_failed",
  "answer_submitted",
  "answer_submit_failed",
  "run_stopped",
  "run_stop_failed",
  "timeline_loaded",
  "timeline_load_failed",
  "openRun",
  "new_run_started",
  "new_run_start_failed",
  "newRunSubmitting",
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
    actionError: new Uint8Array(0),
    openRun: null,
    answerEditor: emptyEditor(),
    newRunOpen: false,
    newRunRepoRoot: new Uint8Array(0),
    newRunRepoName: new Uint8Array(0),
    newRunSlugEditor: emptyEditor(),
    newRunIssueEditor: emptyEditor(),
    newRunSubmitting: false,
    newRunError: new Uint8Array(0),
  };
  return [
    model,
    relayLoadConfig({ key: "boot", ok: "configured", err: "configure_failed" }),
  ];
}

export function subscriptions(model: Model): Sub<Msg> {
  if (model.openRun !== null && model.openRun.phase === "running") {
    return Sub.batch([
      Sub.timer("poll", 5000, "tick"),
      Sub.timer("clock", 1000, "clock"),
      Sub.timer("log-poll", 1200, "log_poll_tick"),
    ]);
  }
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
  // Mechanical re-run of a failed/crashed/halted run — excludes design-gate
  // (that one needs a human to read technical-plan.md first, so it only
  // ever offers the copy-and-paste-yourself resumeHint above) and
  // blocked-dev-review (needs pm-dev-thread.md answered first; status.mjs
  // never gives that state a resumeArgs, so retryable is false for it too).
  readonly retryable: boolean;
  readonly resumeArgs: readonly Uint8Array[];
  readonly repoRoot: Uint8Array;
  readonly hasArtifacts: boolean;
  // Severity groups pick the row icon + tint in markup (style attributes
  // are literals-only there, so the variant choice must be a flag).
  readonly running: boolean;
  readonly gated: boolean;
  readonly failed: boolean;
  readonly done: boolean;
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

// Failed (red, broken) sorts above gated (amber, waiting on a human) sorts
// above running (blue, no action needed) — so opening the panel puts what
// needs a decision at the top instead of wherever its repo happened to
// land in status.mjs's output order.
function severityRank(state: RunState): number {
  if (severityFailed(state)) return 0;
  if (state === "running") return 2;
  return 1;
}

export function runs(model: Model): readonly RunRow[] {
  const flat = activeRuns(model);
  let out: RunRow[] = [];
  let prevName: Uint8Array = new Uint8Array(0);
  // Three passes over the same flat list, one per severity tier, each
  // still index-bounded by the literal the prover needs. Every run matches
  // exactly one tier, so the flat index (used as both seq and the
  // reveal/retry/copy_resume payload) stays unique across all three.
  for (let tier = 0; tier < 3; tier += 1) {
    for (let i = 0; i < 8; i += 1) {
      if (out.length >= 8) break;
      if (i >= flat.length) break;
      const run = flat[i];
      if (severityRank(run.state) !== tier) continue;
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
          retryable: run.state !== "designGate" && run.resumeArgs.length > 0,
          resumeArgs: run.resumeArgs,
          repoRoot: run.repoRoot,
          hasArtifacts: run.artifactsDir.length > 0,
          running: run.state === "running",
          gated: run.state !== "running" && run.state !== "done" && !severityFailed(run.state),
          failed: severityFailed(run.state),
          done: run.state === "done",
          hasGuidance: run.guidance.length > 0 && run.state !== "running",
          showHeader,
          repoName: run.repoName,
          repoDone,
        },
      ]);
    }
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

export interface MergedRow {
  readonly seq: number;
  readonly repoName: Uint8Array;
  readonly slug: Uint8Array;
  readonly branch: Uint8Array;
}

// Recently merged features, most-recent-first (status.mjs orders each
// repo's list that way), flattened across repos and capped so "which one
// merged" is answerable without leaving the panel.
export function recentlyMerged(model: Model): readonly MergedRow[] {
  let out: MergedRow[] = [];
  for (let r = 0; r < 8; r += 1) {
    if (out.length >= 5) break;
    if (r >= model.repos.length) break;
    const repo = model.repos[r];
    for (let c = 0; c < 5; c += 1) {
      if (out.length >= 5) break;
      if (c >= repo.completed.length) break;
      const feature = repo.completed[c];
      // r and c are both literal-bounded loop counters, so this stays a
      // provably whole, bounded i64 — unlike out.length, which the prover
      // cannot refine the same way.
      out = out.concat([
        { seq: r * 5 + c, repoName: repo.name, slug: feature.slug, branch: feature.branch },
      ]);
    }
  }
  return out;
}

export function hasRecentlyMerged(model: Model): boolean {
  return recentlyMerged(model).length > 0;
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

export function hasActionError(model: Model): boolean {
  return model.actionError.length > 0;
}

export function actionErrorText(model: Model): Uint8Array {
  return model.actionError;
}

export function saveLabel(model: Model): Uint8Array {
  if (model.saving) return utf8Bytes("Saving…");
  return asciiBytes("Save");
}

// --- run-detail bindings ---------------------------------------------------

export function hasOpenRun(model: Model): boolean {
  return model.openRun !== null;
}

export function openRunSlug(model: Model): Uint8Array {
  return model.openRun === null ? new Uint8Array(0) : model.openRun.slug;
}

// designGate/blockedPmQuestions/blockedDevReview gate the context panel on
// a manual action (Approve / Submit answer) before anything runs; every
// other state either auto-starts (failed/crashed/halted) or has nothing
// to run (running/done). blockedPmQuestions and blockedDevReview share
// one flow (openRunNeedsAnswer) — same read-doc/answer/submit shape, just
// a different target file and submit endpoint (see relay.ts's
// submitAnswer isDevReview branch).
export function openRunIsDesignGate(model: Model): boolean {
  return model.openRun !== null && model.openRun.state === "designGate";
}

export function openRunNeedsAnswer(model: Model): boolean {
  return (
    model.openRun !== null &&
    (model.openRun.state === "blockedPmQuestions" || model.openRun.state === "blockedDevReview")
  );
}

export function openRunIsAlreadyRunning(model: Model): boolean {
  return model.openRun !== null && model.openRun.state === "running";
}

export function openRunNothingToRun(model: Model): boolean {
  return (
    model.openRun !== null &&
    model.openRun.state !== "designGate" &&
    model.openRun.state !== "blockedPmQuestions" &&
    model.openRun.state !== "blockedDevReview" &&
    model.openRun.state !== "running" &&
    model.openRun.resumeArgs.length === 0
  );
}

export function openRunPlanContent(model: Model): Uint8Array {
  return model.openRun === null ? new Uint8Array(0) : model.openRun.planContent;
}

export function openRunPlanLoaded(model: Model): boolean {
  return model.openRun !== null && model.openRun.planLoaded;
}

export function openRunCanApprove(model: Model): boolean {
  return (
    model.openRun !== null &&
    model.openRun.state === "designGate" &&
    model.openRun.phase === "idle" &&
    model.openRun.resumeArgs.length > 0
  );
}

// Every other resumable state (failed/crashed/halted) — designGate has
// its own Approve button above, blockedPmQuestions/blockedDevReview
// their own Submit-answer flow; this is what's left. Dispatches the
// same "run_pty" Msg Approve does — opening never starts this on its
// own (see open_run), only pressing Play does.
export function openRunCanPlay(model: Model): boolean {
  return (
    model.openRun !== null &&
    model.openRun.state !== "designGate" &&
    !openRunNeedsAnswer(model) &&
    model.openRun.phase === "idle" &&
    model.openRun.resumeArgs.length > 0
  );
}

export function openRunQuestionsContent(model: Model): Uint8Array {
  return model.openRun === null ? new Uint8Array(0) : model.openRun.questionsContent;
}

export function openRunQuestionsLoaded(model: Model): boolean {
  return model.openRun !== null && model.openRun.questionsLoaded;
}

// The textarea binds this fn, never the editor state itself (newText's
// convention above).
export function openRunAnswerText(model: Model): Uint8Array {
  return model.answerEditor.text;
}

export function openRunSubmitDisabled(model: Model): boolean {
  if (model.openRun === null || model.openRun.submitting) return true;
  return trimAsciiSpaces(model.answerEditor.text).length === 0;
}

export function openRunSubmitting(model: Model): boolean {
  return model.openRun !== null && model.openRun.submitting;
}

export function openRunScrollback(model: Model): Uint8Array {
  return model.openRun === null ? new Uint8Array(0) : model.openRun.scrollback;
}

export function openRunIsRunning(model: Model): boolean {
  return model.openRun !== null && model.openRun.phase === "running";
}

// A live pid to stop — whether the run is one the app is watching
// (phase "running") or one already running outside the app entirely
// (state "running", phase never left "idle" since there was nothing for
// this window to spawn) — Stop reaches either.
export function openRunCanStop(model: Model): boolean {
  return model.openRun !== null && model.openRun.pid > 0 && model.openRun.phase !== "exited";
}

// A <for> binding directly to an imported service type (TimelineRow,
// from shared.ts) failed the markup compiler ("key fields must be
// integers or strings", confirmed by trial to be about the type origin,
// not the field's own shape — every other <for> row type in this file
// is declared locally). Materializing a local row type via the same
// bounded-loop pattern runs()/erroredRepos() already use fixes it.
export interface TimelineDisplayRow {
  readonly seq: number;
  readonly role: Uint8Array;
  readonly reached: boolean;
  readonly notReached: boolean;
  readonly verdict: Uint8Array;
  readonly model: Uint8Array;
  readonly costText: Uint8Array;
  readonly completedAgo: Uint8Array;
}

export function openRunTimeline(model: Model): readonly TimelineDisplayRow[] {
  if (model.openRun === null) return [];
  let out: TimelineDisplayRow[] = [];
  for (let i = 0; i < 8; i += 1) {
    if (i >= model.openRun.timeline.length) break;
    const row = model.openRun.timeline[i];
    out = out.concat([
      {
        seq: i,
        role: row.role,
        reached: row.reached,
        notReached: row.notReached,
        verdict: row.verdict,
        model: row.model,
        costText: row.costText,
        completedAgo: row.completedAgo,
      },
    ]);
  }
  return out;
}

export function openRunTimelineLoaded(model: Model): boolean {
  return model.openRun !== null && model.openRun.timelineLoaded;
}

export function openRunTotalCostText(model: Model): Uint8Array {
  return model.openRun === null ? new Uint8Array(0) : model.openRun.timelineTotalCostText;
}

export function openRunTotalTokens(model: Model): number {
  return model.openRun === null ? 0 : model.openRun.timelineTotalTokens;
}

export function openRunHasBudget(model: Model): boolean {
  return model.openRun !== null && model.openRun.budgetUsd > 0;
}

export function openRunBudgetText(model: Model): Uint8Array {
  return model.openRun === null ? new Uint8Array(0) : model.openRun.budgetText;
}

export function openRunIsExited(model: Model): boolean {
  return model.openRun !== null && model.openRun.phase === "exited";
}

export function openRunExitSummary(model: Model): Uint8Array {
  return model.openRun === null ? new Uint8Array(0) : model.openRun.exitSummary;
}

export function openRunHasActionError(model: Model): boolean {
  return model.openRun !== null && model.openRun.actionError.length > 0;
}

export function openRunActionErrorText(model: Model): Uint8Array {
  return model.openRun === null ? new Uint8Array(0) : model.openRun.actionError;
}

// --- new-feature window bindings --------------------------------------------

export function hasNewRunOpen(model: Model): boolean {
  return model.newRunOpen;
}

export interface NewRunRepoRow {
  readonly seq: number;
  readonly index: number;
  readonly name: Uint8Array;
  readonly chosen: boolean;
}

// Literal bound for the prover, same as runs()/erroredRepos().
export function newRunRepoRows(model: Model): readonly NewRunRepoRow[] {
  let out: NewRunRepoRow[] = [];
  for (let i = 0; i < 8; i += 1) {
    if (i >= model.repos.length) break;
    const repo = model.repos[i];
    out = out.concat([{ seq: i, index: i, name: repo.name, chosen: eqBytes(repo.root, model.newRunRepoRoot) }]);
  }
  return out;
}

export function newRunHasNoRepos(model: Model): boolean {
  return model.repos.length === 0;
}

export function newRunRepoChosen(model: Model): boolean {
  return model.newRunRepoRoot.length > 0;
}

export function newRunNoRepoChosen(model: Model): boolean {
  return !newRunRepoChosen(model);
}

export function newRunChosenRepoName(model: Model): Uint8Array {
  return model.newRunRepoName;
}

export function newRunSlugText(model: Model): Uint8Array {
  return model.newRunSlugEditor.text;
}

export function newRunIssueText(model: Model): Uint8Array {
  return model.newRunIssueEditor.text;
}

export function newRunSubmitDisabled(model: Model): boolean {
  if (model.newRunSubmitting || !newRunRepoChosen(model)) return true;
  if (trimAsciiSpaces(model.newRunSlugEditor.text).length === 0) return true;
  if (trimAsciiSpaces(model.newRunIssueEditor.text).length === 0) return true;
  return false;
}

export function newRunHasError(model: Model): boolean {
  return model.newRunError.length > 0;
}

export function newRunErrorText(model: Model): Uint8Array {
  return model.newRunError;
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

    case "retry": {
      const run = findRun(model, msg.index);
      if (run === null || run.resumeArgs.length === 0) return model;
      return [
        model,
        relayRetryRun(
          { repoRoot: run.repoRoot, resumeArgs: run.resumeArgs },
          { key: "retry", ok: "retried", err: "retry_failed" },
        ),
      ];
    }

    case "retried":
      return { ...model, actionError: new Uint8Array(0) };

    case "retry_failed":
      return { ...model, actionError: msg.error };

    case "open_in_editor": {
      const run = findRun(model, msg.index);
      if (run === null || run.artifactsDir.length === 0) return model;
      return [
        model,
        relayOpenInEditor(
          { path: run.artifactsDir },
          { key: "open_in_editor", ok: "editor_opened", err: "editor_open_failed" },
        ),
      ];
    }

    case "editor_opened":
      return { ...model, actionError: new Uint8Array(0) };

    case "editor_open_failed":
      return { ...model, actionError: msg.error };

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

    // --- run-detail window ------------------------------------------------

    case "open_run": {
      // Only one run is watched at a time. While the open window's own
      // process is running, opening a DIFFERENT run is refused — the
      // window's state (logPath, scrollback) belongs to that one process,
      // and swapping it out from under a live poll would misattribute the
      // next log_polled result. Reopening the same run that's already
      // open is a no-op either way; close it first to switch.
      if (model.openRun !== null && model.openRun.phase === "running") return model;
      const run = findRun(model, msg.index);
      if (run === null) return model;
      // Same lookup-by-loop pattern runs() uses for repoDone — never
      // store an index, just resolve the value now (see the
      // Model.newRunRepoRoot doc comment for why).
      let budgetUsd = 0;
      let budgetText: Uint8Array = new Uint8Array(0);
      for (const repo of model.repos) {
        if (eqBytes(repo.root, run.repoRoot)) {
          budgetUsd = repo.maxBudgetUsd;
          budgetText = repo.maxBudgetText;
        }
      }
      const opened: OpenRun = {
        runIndex: msg.index,
        slug: run.slug,
        repoRoot: run.repoRoot,
        artifactsDir: run.artifactsDir,
        state: run.state,
        resumeArgs: run.resumeArgs,
        logPath: new Uint8Array(0),
        pid: run.pid,
        scrollback: new Uint8Array(0),
        phase: "idle",
        exitSummary: new Uint8Array(0),
        planContent: new Uint8Array(0),
        planLoaded: false,
        questionsContent: new Uint8Array(0),
        questionsLoaded: false,
        submitting: false,
        actionError: new Uint8Array(0),
        budgetUsd,
        budgetText,
        timeline: [],
        timelineLoaded: false,
        timelineTotalCostText: new Uint8Array(0),
        timelineTotalTokens: 0,
      };
      // relayReadTimeline is repeated inline in every branch below rather
      // than hoisted to a shared local — a Cmd built outside the literal
      // return expression it's issued from fails the checker (NS1017:
      // "commands are issued in update's return, not stored"), confirmed
      // by trial the same way the ptyKill-before-spawn attempt was.
      if (run.state === "designGate") {
        return [
          { ...model, openRun: opened, answerEditor: emptyEditor() },
          Cmd.batch([
            relayReadTimeline(
              { artifactsDir: run.artifactsDir },
              { key: "timeline", ok: "timeline_loaded", err: "timeline_load_failed" },
            ),
            relayReadArtifact(
              { artifactsDir: run.artifactsDir, fileIndex: 0 },
              { key: "plan", ok: "plan_loaded", err: "plan_load_failed" },
            ),
          ]),
        ];
      }
      if (run.state === "blockedPmQuestions" || run.state === "blockedDevReview") {
        return [
          { ...model, openRun: opened, answerEditor: emptyEditor() },
          Cmd.batch([
            relayReadTimeline(
              { artifactsDir: run.artifactsDir },
              { key: "timeline", ok: "timeline_loaded", err: "timeline_load_failed" },
            ),
            relayReadArtifact(
              { artifactsDir: run.artifactsDir, fileIndex: run.state === "blockedPmQuestions" ? 1 : 2 },
              { key: "questions", ok: "questions_loaded", err: "questions_load_failed" },
            ),
          ]),
        ];
      }
      if (run.state === "running" || run.resumeArgs.length === 0) {
        return [
          { ...model, openRun: opened, answerEditor: emptyEditor() },
          relayReadTimeline(
            { artifactsDir: run.artifactsDir },
            { key: "timeline", ok: "timeline_loaded", err: "timeline_load_failed" },
          ),
        ];
      }
      // Everything else (failed/crashed/halted): just open and load the
      // timeline — opening never starts anything on its own. Watching it
      // live is the explicit Play action (openRunCanPlay / "run_pty"),
      // the same trigger the Approve-design button already uses.
      return [
        { ...model, openRun: opened, answerEditor: emptyEditor() },
        relayReadTimeline(
          { artifactsDir: run.artifactsDir },
          { key: "timeline", ok: "timeline_loaded", err: "timeline_load_failed" },
        ),
      ];
    }

    case "close_run":
      return { ...model, openRun: null };

    case "run_pty": {
      const open = model.openRun;
      if (open === null || open.phase === "running" || open.resumeArgs.length === 0) return model;
      return [
        { ...model, openRun: { ...open, phase: "running", scrollback: new Uint8Array(0) } },
        relayRetryRun(
          { repoRoot: open.repoRoot, resumeArgs: open.resumeArgs },
          { key: "detail_run", ok: "detail_run_started", err: "detail_run_start_failed" },
        ),
      ];
    }

    case "detail_run_started": {
      const open = model.openRun;
      if (open === null) return model;
      return { ...model, openRun: { ...open, logPath: msg.result.logPath, pid: msg.result.pid } };
    }

    case "detail_run_start_failed": {
      const open = model.openRun;
      if (open === null) return model;
      return { ...model, openRun: { ...open, phase: "idle", actionError: msg.error } };
    }

    case "log_poll_tick": {
      const open = model.openRun;
      if (open === null || open.phase !== "running") return model;
      // Reuses this same 1.2s timer for the timeline re-read too (see
      // subscriptions()) — one poll loop, not two — gated separately
      // since a run's artifactsDir can be known before its logPath is
      // (new_run_started's worktree isn't created yet) or vice versa.
      if (open.logPath.length > 0 && open.artifactsDir.length > 0) {
        return [
          model,
          Cmd.batch([
            relayReadLog({ path: open.logPath }, { key: "log_poll", ok: "log_polled", err: "log_poll_failed" }),
            relayReadTimeline(
              { artifactsDir: open.artifactsDir },
              { key: "timeline", ok: "timeline_loaded", err: "timeline_load_failed" },
            ),
          ]),
        ];
      }
      if (open.logPath.length > 0) {
        return [
          model,
          relayReadLog({ path: open.logPath }, { key: "log_poll", ok: "log_polled", err: "log_poll_failed" }),
        ];
      }
      if (open.artifactsDir.length > 0) {
        return [
          model,
          relayReadTimeline(
            { artifactsDir: open.artifactsDir },
            { key: "timeline", ok: "timeline_loaded", err: "timeline_load_failed" },
          ),
        ];
      }
      return model;
    }

    case "log_polled": {
      const open = model.openRun;
      if (open === null) return model;
      return { ...model, openRun: { ...open, scrollback: capTail(msg.result.content, SCROLLBACK_CAP) } };
    }

    case "log_poll_failed":
      return model;

    case "timeline_loaded": {
      const open = model.openRun;
      if (open === null) return model;
      return {
        ...model,
        openRun: {
          ...open,
          timeline: msg.result.rows,
          timelineLoaded: true,
          timelineTotalCostText: msg.result.totalCostText,
          timelineTotalTokens: msg.result.totalTokens,
        },
      };
    }

    case "timeline_load_failed": {
      const open = model.openRun;
      if (open === null) return model;
      return { ...model, openRun: { ...open, timelineLoaded: true } };
    }

    case "plan_loaded": {
      const open = model.openRun;
      if (open === null) return model;
      return { ...model, openRun: { ...open, planContent: msg.result.content, planLoaded: true } };
    }

    case "plan_load_failed": {
      const open = model.openRun;
      if (open === null) return model;
      return { ...model, openRun: { ...open, planLoaded: true, actionError: msg.error } };
    }

    case "questions_loaded": {
      const open = model.openRun;
      if (open === null) return model;
      return {
        ...model,
        openRun: { ...open, questionsContent: msg.result.content, questionsLoaded: true },
      };
    }

    case "questions_load_failed": {
      const open = model.openRun;
      if (open === null) return model;
      return { ...model, openRun: { ...open, questionsLoaded: true, actionError: msg.error } };
    }

    case "answer_edit": {
      if (model.openRun === null) return model;
      const applied = applyTextInputEvent(model.answerEditor, msg.edit, 8192);
      if (applied === null) return model;
      return { ...model, answerEditor: applied };
    }

    case "submit_answer": {
      const open = model.openRun;
      if (open === null || open.submitting) return model;
      const answerText = trimAsciiSpaces(model.answerEditor.text);
      if (answerText.length === 0) return model;
      return [
        { ...model, openRun: { ...open, submitting: true, actionError: new Uint8Array(0) } },
        relaySubmitAnswer(
          {
            artifactsDir: open.artifactsDir,
            answerText,
            isDevReview: open.state === "blockedDevReview",
            slug: open.slug,
            repoRoot: open.repoRoot,
          },
          { key: "submit_answer", ok: "answer_submitted", err: "answer_submit_failed" },
        ),
      ];
    }

    case "answer_submitted": {
      const open = model.openRun;
      if (open === null) return model;
      if (msg.result.resumeArgs.length === 0) {
        return { ...model, openRun: { ...open, submitting: false, resumeArgs: msg.result.resumeArgs } };
      }
      return [
        {
          ...model,
          openRun: {
            ...open,
            submitting: false,
            resumeArgs: msg.result.resumeArgs,
            scrollback: new Uint8Array(0),
            phase: "running",
          },
        },
        relayRetryRun(
          { repoRoot: open.repoRoot, resumeArgs: msg.result.resumeArgs },
          { key: "detail_run", ok: "detail_run_started", err: "detail_run_start_failed" },
        ),
      ];
    }

    case "answer_submit_failed": {
      const open = model.openRun;
      if (open === null) return model;
      return { ...model, openRun: { ...open, submitting: false, actionError: msg.error } };
    }

    case "stop_run": {
      const open = model.openRun;
      if (open === null || open.pid === 0) return model;
      return [
        { ...model, openRun: { ...open, actionError: new Uint8Array(0) } },
        relayStopRun({ pid: open.pid }, { key: "stop_run", ok: "run_stopped", err: "run_stop_failed" }),
      ];
    }

    case "run_stopped": {
      const open = model.openRun;
      if (open === null) return model;
      // The next status.mjs poll (every 5s) will confirm the lock is
      // gone and reclassify the row properly; this just stops the
      // window's own poll loop and shows something happened now rather
      // than leaving "Running…" up for up to 5 more seconds.
      return {
        ...model,
        openRun: { ...open, phase: "exited", exitSummary: asciiBytes("Stopped.") },
      };
    }

    case "run_stop_failed": {
      const open = model.openRun;
      if (open === null) return model;
      return { ...model, openRun: { ...open, actionError: msg.error } };
    }

    // --- new-feature window ------------------------------------------------

    case "open_new_run":
      return {
        ...model,
        newRunOpen: true,
        newRunRepoRoot: new Uint8Array(0),
        newRunRepoName: new Uint8Array(0),
        newRunSlugEditor: emptyEditor(),
        newRunIssueEditor: emptyEditor(),
        newRunSubmitting: false,
        newRunError: new Uint8Array(0),
      };

    case "close_new_run":
      return { ...model, newRunOpen: false };

    case "reset_new_run_repo":
      return { ...model, newRunRepoRoot: new Uint8Array(0), newRunRepoName: new Uint8Array(0) };

    case "pick_new_run_repo": {
      // Looked up by a bounded loop rather than storing msg.index itself
      // (see the Model.newRunRepoRoot doc comment) — i === msg.index is
      // NaN-safe on its own (every comparison against NaN is false, so a
      // garbage payload just never matches and root/name stay empty,
      // caught by the length check below).
      let root: Uint8Array = new Uint8Array(0);
      let name: Uint8Array = new Uint8Array(0);
      for (let i = 0; i < 8; i += 1) {
        if (i >= model.repos.length) break;
        if (i === msg.index) {
          root = model.repos[i].root;
          name = model.repos[i].name;
        }
      }
      if (root.length === 0) return model;
      return { ...model, newRunRepoRoot: root, newRunRepoName: name };
    }

    case "new_run_slug_edit": {
      const applied = applyTextInputEvent(model.newRunSlugEditor, msg.edit, 128);
      if (applied === null) return model;
      return { ...model, newRunSlugEditor: applied };
    }

    case "new_run_issue_edit": {
      const applied = applyTextInputEvent(model.newRunIssueEditor, msg.edit, 16384);
      if (applied === null) return model;
      return { ...model, newRunIssueEditor: applied };
    }

    case "submit_new_run": {
      if (model.newRunSubmitting) return model;
      if (model.newRunRepoRoot.length === 0) return model;
      const slug = trimAsciiSpaces(model.newRunSlugEditor.text);
      const issueText = trimAsciiSpaces(model.newRunIssueEditor.text);
      if (slug.length === 0 || issueText.length === 0) return model;
      return [
        { ...model, newRunSubmitting: true, newRunError: new Uint8Array(0) },
        relayStartRun(
          { repoRoot: model.newRunRepoRoot, slug, issueText },
          { key: "start_run", ok: "new_run_started", err: "new_run_start_failed" },
        ),
      ];
    }

    case "new_run_started": {
      if (model.newRunRepoRoot.length === 0) {
        return { ...model, newRunOpen: false, newRunSubmitting: false };
      }
      // The process is started and detached either way — this only
      // decides whether the app also opens a window to watch it. If a
      // DIFFERENT run's poll is already live, attaching here would
      // overwrite it and misattribute its next log_polled result (the
      // same hazard open_run's running-guard exists for). The run still
      // shows up in the plain dashboard list on the next 5s poll either
      // way, so just close the form rather than fight over the one
      // openRun slot.
      if (model.openRun !== null && model.openRun.phase === "running") {
        return { ...model, newRunOpen: false, newRunSubmitting: false };
      }
      let newRunBudgetUsd = 0;
      let newRunBudgetText: Uint8Array = new Uint8Array(0);
      for (const repo of model.repos) {
        if (eqBytes(repo.root, model.newRunRepoRoot)) {
          newRunBudgetUsd = repo.maxBudgetUsd;
          newRunBudgetText = repo.maxBudgetText;
        }
      }
      const opened: OpenRun = {
        runIndex: -1,
        slug: trimAsciiSpaces(model.newRunSlugEditor.text),
        repoRoot: model.newRunRepoRoot,
        artifactsDir: new Uint8Array(0),
        // Not a real RunState from status.mjs — a placeholder so the
        // run-detail window's state-keyed branches (designGate,
        // openRunNeedsAnswer, openRunIsAlreadyRunning) all skip past it to
        // the plain "phase is running" scrollback view, same as any other
        // freshly-launched run.
        state: "halted",
        resumeArgs: [],
        logPath: msg.result.logPath,
        pid: msg.result.pid,
        scrollback: new Uint8Array(0),
        phase: "running",
        exitSummary: new Uint8Array(0),
        planContent: new Uint8Array(0),
        planLoaded: false,
        questionsContent: new Uint8Array(0),
        questionsLoaded: false,
        submitting: false,
        actionError: new Uint8Array(0),
        budgetUsd: newRunBudgetUsd,
        budgetText: newRunBudgetText,
        timeline: [],
        timelineLoaded: false,
        timelineTotalCostText: new Uint8Array(0),
        timelineTotalTokens: 0,
      };
      return { ...model, newRunOpen: false, newRunSubmitting: false, openRun: opened };
    }

    case "new_run_start_failed":
      return { ...model, newRunSubmitting: false, newRunError: msg.error };
  }
}

// Trims to the LAST `cap` bytes — no unbounded growth, keeps the polled
// log provably bounded for the checker the same way every other list in
// this file is literal-capped, and a live log is only usefully read from
// its tail anyway. Uint8Array has no .slice-from-end shorthand here that
// avoids a copy, so this goes through the same new + .set + .subarray
// splice pattern @native-sdk/core/text's replaceTextRange uses.
function capTail(content: Uint8Array, cap: number): Uint8Array {
  if (content.length <= cap) return content;
  const out = new Uint8Array(cap);
  out.set(content.subarray(content.length - cap), 0);
  return out;
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

function settingsWindow(): WindowDescriptor {
  return windowDescriptor({
    label: asciiBytes("settings"),
    canvasLabel: asciiBytes("settings-canvas"),
    title: asciiBytes("Relay Settings"),
    width: 480,
    height: 420,
    resizable: true,
    closePolicy: "quit",
    onCloseCommand: asciiBytes("app.settings-closed"),
  });
}

// The settings window exists while settingsOpen is committed model state
// (presence is liveness). A user close is routed back through commandMsg
// as app.settings-closed, which clears the flag. Run Detail and New
// Feature are <sheet> overlays inside app.native now, not windows — see
// their on-dismiss bindings there (close_run / close_new_run).
export function windows(model: Model): readonly WindowDescriptor[] {
  if (model.settingsOpen) return [settingsWindow()];
  return [];
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
