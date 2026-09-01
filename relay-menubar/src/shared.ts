// Boundary shapes shared by the deterministic core and the relay service.
// This file is core-class (subset-legal): the service imports it for the
// authoritative declarations, and the core imports the generated typed
// client that carries these same records. Never import src/services here.
//
// Records live in the model tree and hold heap-backed byte fields, so they
// are declared as interfaces (reference storage); an object-literal alias
// would be value storage and may only carry scalar fields (NS1061).

// Mirrors status.mjs's run states 1:1 — the SERVICE maps its hyphenated
// JSON tags onto these camelCase members (facade members must be
// declarable identifiers end to end).
export type RunState =
  | "running"
  | "designGate"
  | "blockedPmQuestions"
  | "blockedDevReview"
  | "failedTypecheck"
  | "failedReview"
  | "failedQa"
  | "halted"
  | "crashed"
  // The pipeline finished (retrospective.md written) — the worktree just
  // hasn't been cleaned up yet. Not a failure and not waiting on a gate.
  | "done";

export interface ActiveRun {
  readonly slug: Uint8Array;
  readonly repoName: Uint8Array;
  readonly state: RunState;
  // Precomposed display caption ("running · dev · $0.42 · claude-opus…"),
  // built by the service — the core subset cannot concatenate or format.
  // Empty bytes when there is nothing beyond the state to show.
  readonly caption: Uint8Array;
  // Producer `detail`: per-state operator guidance ("Quality gates failing
  // — see .agent-typecheck-feedback.md…"). Empty for plain running runs.
  readonly guidance: Uint8Array;
  // Design gate only: the plan changed since the recorded approval.
  readonly staleApproval: boolean;
  // Ready-to-run resume command, display form; empty when not resumable
  // (running, or blocked-dev-review — that one needs a human answer first).
  readonly resumeHint: Uint8Array;
  // Same command as resumeArgs (argv form: script path relative to
  // repoRoot, then flags) — a programmatic Retry must never shell out
  // resumeHint as a string, since slug/repoRoot ultimately come from the
  // filesystem. Empty exactly when resumeHint is empty.
  readonly resumeArgs: readonly Uint8Array[];
  // Project root (not the worktree) — needed to resolve resumeArgs[0] and
  // as the retry process's cwd.
  readonly repoRoot: Uint8Array;
  readonly worktree: Uint8Array;
  // Producer `artifactsDir` (.relay/artifacts/<slug>); empty when absent.
  readonly artifactsDir: Uint8Array;
  // The live process's pid (status.mjs's `livePid`) — 0 when there is no
  // live process to stop, matching this codebase's zero-sentinel
  // convention for "absent" (artifactsDir uses empty bytes the same way).
  readonly pid: number;
}

export interface CompletedFeature {
  readonly slug: Uint8Array;
  readonly branch: Uint8Array;
}

export interface RepoSummary {
  readonly name: Uint8Array;
  readonly root: Uint8Array;
  readonly active: readonly ActiveRun[];
  readonly completedCount: number;
  // Most-recent-first, capped by the service (see relay.ts) — enough to
  // show what merged without shipping the whole feature history.
  readonly completed: readonly CompletedFeature[];
  // Non-empty when the directory is not a Relay repo or could not be read.
  // (Named errorText: `error` is a keyword in the compiled facade.)
  readonly errorText: Uint8Array;
  // The repo's configured .ai/config.json project.maxCostUsdPerFeature —
  // 0 means unset, not "zero budget" (same zero-sentinel convention as
  // ActiveRun.pid/artifactsDir's empty bytes).
  readonly maxBudgetUsd: number;
  // Precomposed ("$15.00"), empty when maxBudgetUsd is 0 — core.ts has
  // no float formatting, so currency text is always built service-side
  // (composeCaption's convention).
  readonly maxBudgetText: Uint8Array;
}

export interface AppConfig {
  // Absolute path to a status.mjs copy (any Relay checkout's
  // skills/pipeline/scripts/status.mjs). Empty when not found.
  readonly statusScript: Uint8Array;
  readonly roots: readonly Uint8Array[];
}

export interface StatusRequest {
  readonly config: AppConfig;
}

export interface SaveReposRequest {
  readonly repos: readonly Uint8Array[];
}

export interface SaveResult {
  readonly saved: boolean;
}

export interface StatusSnapshot {
  readonly repos: readonly RepoSummary[];
}

export interface RetryRunRequest {
  readonly repoRoot: Uint8Array;
  readonly resumeArgs: readonly Uint8Array[];
}

export interface RetryResult {
  readonly started: boolean;
  // Where stdout/stderr are being appended — the run-detail window polls
  // this via readLog while watching a run it started (native-sdk's
  // Cmd.ptySpawn exists in the TS SDK surface but this SDK version's
  // contract generator can't yet lower its event shape, confirmed by
  // trial: native test fails the moment a pty_event-shaped Msg arm or a
  // Cmd.ptySpawn/ptyKill call appears anywhere in core.ts, and passes
  // clean the moment it's removed — so polling a log file is the fallback
  // until that lands upstream).
  readonly logPath: Uint8Array;
  // The spawned child's pid — lets the run-detail window offer Stop
  // immediately, before status.mjs's next poll would otherwise be the
  // first time a pid becomes visible (via ActiveRun.pid).
  readonly pid: number;
}

export interface ReadLogRequest {
  readonly path: Uint8Array;
}

export interface ReadLogResult {
  readonly content: Uint8Array;
}

// Stops a running pipeline — SIGTERM to the pid (status.mjs's `livePid`,
// or the pid a fresh spawn handed back), not a graceful pipeline-level
// cancel: run-pipeline.sh's own `trap release_lock EXIT` still runs on
// the way out, so the lock clears and the next status.mjs poll reflects
// it stopped.
export interface StopRunRequest {
  readonly pid: number;
}

export interface StopRunResult {
  readonly stopped: boolean;
}

export interface OpenInEditorRequest {
  readonly path: Uint8Array;
}

export interface OpenResult {
  readonly opened: boolean;
}

// Closed set of artifact files the run-detail window may read — never a
// free-form path from the model, so this can't become an arbitrary-file
// read. fileIndex: 0 = technical-plan.md, 1 = pm-questions.md,
// 2 = pm-dev-thread.md (see relay.ts's ARTIFACT_FILES). A plain number
// rather than a string-literal union deliberately — a union field here
// was the thing that tripped native-sdk's contract generator during V1
// (see RetryResult.logPath's note on the pty gap for how that class of
// failure was diagnosed).
export interface ReadArtifactRequest {
  readonly artifactsDir: Uint8Array;
  readonly fileIndex: number;
}

export interface ReadArtifactResult {
  readonly content: Uint8Array;
  readonly found: boolean;
}

// One row per fixed pipeline role (pm, architect, dev, dev-review,
// pm-respond, review, qa, retro — see relay.ts's TIMELINE_ROLES), in
// that order. `reached` false means the role never ran — every other
// field is a zero-value sentinel in that case (empty bytes / 0), the
// same convention as everywhere else in this file.
export interface TimelineRow {
  readonly seq: number;
  readonly role: Uint8Array;
  readonly reached: boolean;
  // Redundant with !reached — markup's <if> has no negation operator, so
  // both directions need their own bindable field.
  readonly notReached: boolean;
  readonly verdict: Uint8Array;
  readonly model: Uint8Array;
  // Precomposed ("$2.41", empty when not reached) — core.ts has no
  // float formatting, so currency/relative-time text is always built
  // service-side (composeCaption's convention).
  readonly costText: Uint8Array;
  readonly tokens: number;
  readonly completedAgo: Uint8Array;
}

export interface ReadTimelineRequest {
  readonly artifactsDir: Uint8Array;
}

export interface ReadTimelineResult {
  readonly rows: readonly TimelineRow[];
  readonly totalCostText: Uint8Array;
  readonly totalTokens: number;
}

// Answers either a PM clarifying question (pm-questions.md, gated by
// run-pipeline.sh's literal `## Your answers` heading check) or a
// dev-review thread (pm-dev-thread.md, read semantically by the next
// pm-respond/dev-review agent turn, no script-level gate) — isDevReview
// picks which. Both close over the same shape (append the human's text,
// hand back a resume command) so the run-detail window's textarea+submit
// flow is one flow, not two.
export interface SubmitAnswerRequest {
  readonly artifactsDir: Uint8Array;
  readonly answerText: Uint8Array;
  readonly isDevReview: boolean;
  // Carried through so the result can hand back a ready-to-run resume
  // command — status.mjs deliberately never gives blocked-pm-questions/
  // blocked-dev-review runs a resumeArgs (a bare Retry on the plain list
  // would just halt the same way again), so the run-detail window builds
  // its own here, in the ordinary-TS service layer where byte
  // concatenation is legal.
  readonly slug: Uint8Array;
  readonly repoRoot: Uint8Array;
}

export interface SubmitAnswerResult {
  readonly submitted: boolean;
  readonly resumeArgs: readonly Uint8Array[];
}

// Starts a feature that has never run before — run-pipeline.sh creates
// the git worktree itself (see run-pipeline.sh's setup_worktree), so all
// the app needs to hand it is a slug and the issue text.
export interface StartRunRequest {
  readonly repoRoot: Uint8Array;
  readonly slug: Uint8Array;
  readonly issueText: Uint8Array;
}

export interface StartRunResult {
  readonly started: boolean;
  readonly logPath: Uint8Array;
  readonly pid: number;
}
