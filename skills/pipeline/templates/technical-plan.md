# Technical Plan

## Architecture

One paragraph describing how the feature fits into the existing app structure.

## Diagram

A Mermaid diagram is mandatory — sequence diagram for a new interaction/API flow, component/flowchart for new UI or data flow. Review checks the implementation against this, not just the prose above.

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Component
    participant S as Service
    U->>UI: interacts
    UI->>S: calls
    S-->>UI: returns
```

## Data Model

Mandatory section — the Dev agent cannot read the schema itself, so anything not named here gets invented. Name every table/collection and column this feature reads or writes, spelled exactly as it exists today, plus anything that must be created or altered and the migration that does it. Write `None — this feature reads and writes no persisted data.` when that is genuinely the case; never omit the section.

- `table.column` (`type`, nullable) — read | written | new | altered
- Migration: `path/to/migration.sql` — what it changes

Every schema, migration, and generated-types file named here must also appear under Impacted Files (even read-only ones) — that list is what decides which file contents the Dev actually gets to see.

## Impacted Files

- `path/to/file.ts` — description of changes

## Delivery Shape

One of:
- **Single PR** — the whole feature ships as one PR (default for most features).
- **Split into N PRs** — list each slice as `1. <name>` with the files it owns (a subset of Impacted Files) and why it can land and stay green on its own before the next slice starts. Only propose a split when a slice is independently mergeable — reviewable and shippable without the rest of the feature half-built behind a flag.

## Existing Patterns To Reuse

- Reference specific components, hooks, or services

## Risks

- Things that could go wrong

## Implementation Order

1. Step 1
2. Step 2

## Testing Strategy

- How to verify each acceptance criterion

## Task Breakdown

- [ ] Task 1
- [ ] Task 2
