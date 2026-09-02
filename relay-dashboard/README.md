# Relay dashboard

Small macOS app (native SDK) with a Dock icon that surfaces live Relay pipeline
runs across your repos. Polls the read-only aggregator from
`skills/pipeline/scripts/status.mjs` every 5s; fully read-only — reveal
worktree in Finder, copy a resume command, nothing else.

## Configure

```bash
mkdir -p ~/.config
cp relay-dashboard.example.json ~/.config/relay-dashboard.json
# then edit ~/.config/relay-dashboard.json to list your repo roots
```

- `repos`: absolute paths (or `~/…`) to Relay-managed repos.
- `statusScript` (optional): path to any checkout's status.mjs copy. When
  omitted, the first configured root that has one wins.

The config path is fixed at `~/.config/relay-dashboard.json` — the service
carrier runs under an SDK environment allowlist, so env-var overrides cannot
reach it.

## What you see

A regular Dock app (`dock_visible: true`), not a status-item accessory: the
dashboard window opens at launch, the Dock icon activates it, and closing the
window only hides it (`close_policy: "hide"` — AppKit's Dock-reopen brings it
back). Quit from the footer button or ⌘Q. There is no status-item title, so
nothing signals a waiting run while the window is closed — that's the trade
for having an app-switcher/Dock presence instead.

The dashboard is the single surface: a stat strip (running / need attention /
merged), then one section per repo. Each repo header carries its merged count
and is followed by that repo's active runs — sorted failed → gated → running
— and then its own "Recently merged" list; merges are grouped with the repo
that made them, never in a separate bottom section. Repos stay in configured
order so sections don't shuffle between polls.

A run row is its slug plus actions, then a state `<badge>` (the component
library's chip: `halted`, `review FAIL`, `design gate` — quiet secondary chip
with severity ink, destructive variant for failures) beside the
service-composed caption (`dev · $1.24 · claude-opus`). Below that come
operator guidance for gated/failed runs and inline copy-resume / retry rows.
Per-repo poll errors keep their own banner section under the groups.

Run states mirror status.mjs 1:1: running, designGate, blockedPmQuestions,
blockedDevReview, failedTypecheck, failedReview, failedQa, halted, crashed,
done. `STATE_BADGES` in `src/services/relay.ts` names each one for the chip;
`STATE_NOTES` holds what a chip can't say (`pushed, no PR`) and opens the
caption.

## Architecture

- `src/core.ts` — deterministic core (TEA subset): model/update/subscriptions
  and the dashboard bindings. No JSON/process/string work. `panelRows()` is
  one FLAT list interleaving each repo's runs and merges, because markup's
  `for each` only accepts a model slice or fn — never a field of its own loop
  item — so per-repo nested loops aren't expressible.
- `src/services/relay.ts` — service layer (ordinary TS): reads the config,
  spawns `node <statusScript> --json <roots…>`, maps JSON onto the boundary
  records in `src/shared.ts`. Child-carrier process (`service_carrier: child`).
- `src/app.native` — dashboard markup bound to exported helpers.
- `assets/icon.png` — app / Dock icon.

## Development

```bash
native check                       # manifest + markup + subset + static coverage
native dev --yes                   # build & run (add -Dautomation=true for automate)
native dev --core --script msgs.ndjson   # headless core loop under node
```

Automation smoke:

```bash
native dev --yes -Dautomation=true &
native automate wait
native automate assert 'ready=true'
native automate screenshot main-canvas
```
