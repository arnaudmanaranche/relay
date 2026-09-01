# Relay menu bar

macOS menu-bar extra (native SDK) that surfaces live Relay pipeline runs across
your repos. Polls the read-only aggregator from
`skills/pipeline/scripts/status.mjs` every 5s; fully read-only — reveal
worktree in Finder, copy a resume command, nothing else.

## Configure

```bash
mkdir -p ~/.config
cp relay-menubar.example.json ~/.config/relay-menubar.json
# then edit ~/.config/relay-menubar.json to list your repo roots
```

- `repos`: absolute paths (or `~/…`) to Relay-managed repos.
- `statusScript` (optional): path to any checkout's status.mjs copy. When
  omitted, the first configured root that has one wins.

The config path is fixed at `~/.config/relay-menubar.json` — the service
carrier runs under an SDK environment allowlist, so env-var overrides cannot
reach it.

## What you see

The tray title is the whole menu-bar presence: `> RELAY` while something
runs, `! RELAY` when any run needs attention (design gate, review/QA FAIL,
crash, halt), else `RELAY`. Clicking it opens the dashboard — there is no
dropdown (the AppKit host pops the menu *and* fires the activation command,
which duplicated the dashboard with a weaker surface). Option-click refreshes.

The dashboard is the single surface: a stat strip (running / need attention /
merged), runs grouped under repo headers with merged counts, severity-tinted
state icons, service-composed captions (`running · dev · $1.24`), operator
guidance for gated/failed runs, inline copy-resume rows, per-repo error
banners, and Quit in the footer. Closing the window only hides it — the app
stays in the menu bar (`close_policy: "hide"`); quit via the footer button.

Run states mirror status.mjs 1:1: running, designGate, blockedDevReview,
failedTypecheck, failedReview, failedQa, halted, crashed.

## Architecture

- `src/core.ts` — deterministic core (TEA subset): model/update/subscriptions,
  status-item + dashboard bindings. No JSON/process/string work.
- `src/services/relay.ts` — service layer (ordinary TS): reads the config,
  spawns `node <statusScript> --json <roots…>`, maps JSON onto the boundary
  records in `src/shared.ts`. Child-carrier process (`service_carrier: child`).
- `src/app.native` — dashboard markup bound to exported helpers.
- `assets/menu-bar.svg` — status-item icon.

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
