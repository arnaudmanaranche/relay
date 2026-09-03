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
- `theme` (optional): `system` (default), `light`, or `dark`. Written by the
  Appearance switch in Settings; anything else reads as `system`.

The config path is fixed at `~/.config/relay-dashboard.json` — the service
carrier runs under an SDK environment allowlist, so env-var overrides cannot
reach it. Editing the file by hand still works; the app reads it at launch.

Both halves are editable in the app itself — see Settings below.

## What you see

A regular Dock app (`dock_visible: true`), not a status-item accessory: the
dashboard window opens at launch, the Dock icon activates it, and closing the
window only hides it (`close_policy: "hide"` — AppKit's Dock-reopen brings it
back). Quit from the footer button, the Relay menu, or ⌘Q. There is no
status-item title, so
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

## The menu bar, and Settings

Relay carries a real macOS menu bar (`menus` in app.json, routed through
`commandMsg`), so its verbs live where a Mac app's verbs live:

The application menu — the bold **Relay** — is host-built and takes no app
items: `addApplicationMenuToMenu` in the SDK's AppKit host always installs
About/Hide/Quit itself and offers no hook ("No Settings item: the host has no
settings surface to open… apps add their own through custom menus when they
grow one"). So Settings… cannot live under Relay in SDK 0.9.x; it lives in
the first declared menu beside it.

| Menu | Item | Key | Command |
| --- | --- | --- | --- |
| Relay (host-built) | About / Hide / Quit Relay | ⌘Q | — |
| Dashboard | Settings… | ⌘, | `app.settings` |
| Dashboard | New Feature | ⌘N | `app.new_run` |
| Dashboard | Refresh | ⌘R | `app.refresh` |
| Window | Dashboard | ⌘0 | `app.open_dashboard` |
| Window | Close Window | ⌘W | `app.close_window` |

**Settings is a window, not a sheet** (`src/windows/settings.native`, declared
by `windows()`): the dashboard header has no Settings button — ⌘, or the
Dashboard menu opens it, the way preferences open anywhere else on the
platform. It holds two sections with deliberately different commit
semantics:

- **Appearance** — System / Light / Dark chips. Applies on the press
  (`themeState()` re-derives the color scheme after every committed update)
  and persists in the same step: no Save, so the theme you click is the theme
  you see. `system` follows macOS. A forced scheme reaches the CANVAS tokens,
  which is the whole UI here; native chrome (titlebars, the menu bar) stays
  OS-themed.

  Both views wrap their body in a `<column key="{themeKey}">`, and that key
  is load-bearing. Without it a flip repaints only the widgets whose CONTENT
  changed — nodes that changed COLOR alone (the header strip, a section
  label) keep their old pixels on the live Metal path, which shows up as a
  band of the old scheme across a window that just went dark. Re-keying
  rebuilds the tree, so every command is new and the whole surface repaints.
  The key has to sit on that inner column: on the view root it is ignored
  (the automation snapshot's widget ids don't change across a flip with it
  there, and all change with it one level in). `native automate screenshot`
  cannot see the bug either way — the reference renderer plans every frame
  as a full repaint — so check a theme flip on the glass, not in a capture.
- **Repositories** — a draft copy of the configured roots. Save rewrites
  `~/.config/relay-dashboard.json` atomically (preserving unknown keys) and
  re-resolves the config so the new roots are polled immediately; Cancel
  discards the drafts, and leaves the theme alone.

Two trades worth knowing. Declaring `menus` REPLACES the host's default
File/Edit/View/Window menus — only the application menu survives — so Edit's
Cut/Copy/Paste/Undo items are gone. The shortcuts still work: the canvas
resolves ⌘C/⌘X/⌘V/⌘Z/⌘A from the key events themselves, and those menu items
were only a second entry point into the same path. And a menu command names no
window, so ⌘W closes the settings window while it exists, then hides the
dashboard (`close_policy: "hide"`, never a quit).

## Architecture

- `src/core.ts` — deterministic core (TEA subset): model/update/subscriptions
  and the dashboard bindings. No JSON/process/string work. `panelRows()` is
  one FLAT list interleaving each repo's runs and merges, because markup's
  `for each` only accepts a model slice or fn — never a field of its own loop
  item — so per-repo nested loops aren't expressible.
- `src/services/relay.ts` — service layer (ordinary TS): reads the config,
  spawns `node <statusScript> --json <roots…>`, maps JSON onto the boundary
  records in `src/shared.ts`. Child-carrier process (`service_carrier: child`).
  `loadTheme`/`saveTheme` are their own ops rather than fields of
  `loadConfig`: that one throws when no status.mjs resolves, and the chosen
  appearance has to load anyway — the settings window is where such a config
  gets fixed.
- `src/app.native` — dashboard markup bound to exported helpers.
- `src/windows/settings.native` — the Settings window's markup.
- `assets/icon.png` — app / Dock icon.

## Development

Every `native` command that touches the TypeScript core needs Node 24+; a
Node 22 default PATH fails with "TypeScript apps need Node.js 24+":

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
native test --yes                  # regenerates the model contract, then runs the suite
native check                       # manifest + markup + subset + static coverage
native dev --yes                   # build & run (add -Dautomation=true for automate)
native dev --core --script msgs.ndjson   # headless core loop under node
```

Run `native test` before `native check`: with a stale
`zig-out/model-contract.zon`, check only validates the markup structurally and
binding errors stay hidden.

Automation smoke — the menu bar is outside every window capture, so the
snapshot's `app-menu` rows are the evidence it loaded, and `menu-command`
drives an item the way a real selection does:

```bash
native dev --yes -Dautomation=true &
native automate wait
native automate assert 'ready=true'
native automate snapshot | grep app-menu
native automate menu-command app.settings
native automate screenshot settings-canvas
native automate screenshot main-canvas
```
