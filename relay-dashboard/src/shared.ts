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
  // Chip text for the row's state badge ("halted", "review FAIL") — a name,
  // never a sentence (see STATE_BADGES in relay.ts). The core picks the
  // badge's VARIANT from its own severity flags, so this carries only the
  // words.
  readonly stateLabel: Uint8Array;
  // Precomposed display caption ("dev · $0.42 · claude-opus…"), built by
  // the service — the core subset cannot concatenate or format. The state
  // is NOT in it (that is stateLabel's job); it opens with a state note
  // only where one adds a fact the badge cannot (STATE_NOTES). Empty bytes
  // when there is nothing beyond the state to show.
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
  // The repo's configured .relay/config.json project.maxCostUsdPerFeature —
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

// The appearance the app forces on its own canvas tokens. "system" (the
// default) follows the OS; the other two override it. Matches
// @native-sdk/core/events' ThemeStateColorScheme member for member —
// declared here rather than imported so ONE declaration is authoritative
// on both sides of the boundary (the service reads/writes it too) and no
// SDK type name collides with a core-class name (NS1038).
export type ThemePref = "system" | "light" | "dark";

// Read and written on its OWN operation rather than as a field of
// AppConfig: loadConfig throws when no status.mjs resolves (an unusable
// repo list), and the chosen appearance must still load in that case —
// the settings window is exactly where such a config gets fixed.
export interface ThemeSettings {
  readonly theme: ThemePref;
}

export interface SaveThemeRequest {
  readonly theme: ThemePref;
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

// Cmd.ptySpawn takes argv and nothing else — no cwd, no env — so an
// attached run goes through `sh -lc <one command>`, and that command has to
// be composed and quoted somewhere. Not in the core: building it means
// joining and escaping strings, which is exactly the work the subset sends
// to a service. The core just reads the composed bytes into ptySpawn's argv
// (a model-derived argv element is accepted — verified against the running
// engine, not assumed).
export interface PtyCommandRequest {
  readonly repoRoot: Uint8Array;
  readonly resumeArgs: readonly Uint8Array[];
}

export interface PtyCommandResult {
  // `cd <repoRoot> && exec bash <script> <args...>`, every word quoted.
  readonly command: Uint8Array;
}

export interface RetryResult {
  readonly started: boolean;
  // Where stdout/stderr are being appended — the run-detail window polls
  // this via readLog while watching a run it started.
  //
  // The earlier note here blamed the SDK: `Cmd.ptySpawn` supposedly could
  // not be used because the contract generator "can't lower its event
  // shape". Re-tested on 0.9.5 and that is wrong — the trial it cites
  // imported `PtyState`/`PtyExitReason` from `@native-sdk/core`, and it is
  // the IMPORTED type alias the generator refuses (NS1063, pointing at the
  // import line). Declare both unions locally in core.ts and a
  // pty_event-shaped arm plus Cmd.ptySpawn/ptyKill build clean, contract
  // included. See SCROLLBACK_CAP in core.ts for the full recipe and for
  // what a pty would still cost (rendering raw ANSI, which no markup
  // widget does).
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
// tripped native-sdk's contract generator during V1. Unlike the pty claim
// in RetryResult above (which turned out to be an imported-alias problem,
// not an SDK gap), this one has NOT been re-tested: it crosses into
// services.contract.json rather than the core contract, so the local-alias
// fix that unblocked pty may or may not apply. Retest before assuming
// either way.
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
