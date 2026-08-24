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
  | "blockedDevReview"
  | "failedTypecheck"
  | "failedReview"
  | "failedQa"
  | "halted"
  | "crashed";

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
  // Ready-to-run resume command for design-gate runs; empty otherwise.
  readonly resumeHint: Uint8Array;
  readonly worktree: Uint8Array;
  // Producer `artifactsDir` (.relay/artifacts/<slug>); empty when absent.
  readonly artifactsDir: Uint8Array;
}

export interface RepoSummary {
  readonly name: Uint8Array;
  readonly root: Uint8Array;
  readonly active: readonly ActiveRun[];
  readonly completedCount: number;
  // Non-empty when the directory is not a Relay repo or could not be read.
  // (Named errorText: `error` is a keyword in the compiled facade.)
  readonly errorText: Uint8Array;
}

export interface AppConfig {
  // Absolute path to a status.mjs copy (any Relay checkout's
  // skills/relay-pipeline/scripts/status.mjs). Empty when not found.
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
