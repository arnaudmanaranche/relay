#!/usr/bin/env bash
# Launch Relay Studio against the project this is run from.
#
# Studio is a Vite dev server that lives in the Relay module, not in your
# project: only skills/ and .relay/ are copied into a project by /relay:setup,
# and shipping a React app plus its node_modules into every repo would be
# absurd. So this script has one real job — find the module's studio/ folder
# wherever Relay happens to be installed, then start it with the project as
# its working directory.
set -euo pipefail

PROJECT_ROOT="$PWD"
OPEN_BROWSER=1
VITE_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --project-root=*) PROJECT_ROOT="${arg#*=}" ;;
    --no-open) OPEN_BROWSER=0 ;;
    --port=*) VITE_ARGS+=(--port "${arg#*=}" --strictPort) ;;
    -h|--help)
      cat <<'USAGE'
Usage: relay-studio.sh [--project-root=<path>] [--port=<n>] [--no-open]

Starts Relay Studio (roles, skills, pipeline) for the given project.
Runs in the foreground; stop it with Ctrl-C.
USAGE
      exit 0
      ;;
    *) echo "relay-studio.sh: unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -d "$PROJECT_ROOT" ]; then
  echo "relay-studio.sh: no such directory: $PROJECT_ROOT" >&2
  exit 1
fi
PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"

# Studio reads .relay/agents.json to list the roles; without it there is
# nothing to edit and the app would open straight onto an error.
if [ ! -f "$PROJECT_ROOT/.relay/agents.json" ]; then
  echo "relay-studio.sh: $PROJECT_ROOT has no .relay/agents.json — run /relay:setup there first." >&2
  exit 1
fi

# Resolve the module root from this script's own location rather than from the
# caller's cwd: <module>/skills/studio/scripts/relay-studio.sh. Works the same
# whether Relay is a plugin under ~/.claude/plugins/cache/…, a git checkout, or
# a vendored copy. `cd -P` follows the symlink a plugin install may leave.
SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_ROOT="$(cd -P "$SCRIPT_DIR/../../.." && pwd)"
STUDIO_DIR="$MODULE_ROOT/studio"

# Fallback for the case where only skills/ was copied into the project (the
# script is then at <project>/skills/relay-studio/scripts/, whose grandparent
# is the project, not the module). installed_plugins.json is where Claude Code
# records every install path.
if [ ! -f "$STUDIO_DIR/package.json" ]; then
  INSTALLED="$HOME/.claude/plugins/installed_plugins.json"
  if [ -f "$INSTALLED" ] && command -v node >/dev/null 2>&1; then
    FOUND="$(node -e '
      const fs = require("fs");
      try {
        const { plugins = {} } = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
        for (const [key, installs] of Object.entries(plugins)) {
          if (!key.startsWith("relay@")) continue;
          for (const i of installs) {
            if (i.installPath && fs.existsSync(i.installPath + "/studio/package.json")) {
              console.log(i.installPath);
              process.exit(0);
            }
          }
        }
      } catch {}
    ' "$INSTALLED" 2>/dev/null || true)"
    [ -n "$FOUND" ] && STUDIO_DIR="$FOUND/studio"
  fi
fi

# Last resort: walk the plugin cache directly, in case the manifest moves or
# the install is keyed under a name this doesn't recognise. Newest version
# last, so the loop ends on it.
if [ ! -f "$STUDIO_DIR/package.json" ]; then
  for candidate in "$HOME"/.claude/plugins/cache/*/relay/*/studio; do
    [ -f "$candidate/package.json" ] && STUDIO_DIR="$candidate"
  done
fi

if [ ! -f "$STUDIO_DIR/package.json" ]; then
  cat >&2 <<EOF
relay-studio.sh: could not find the Studio app.

Looked in:
  $MODULE_ROOT/studio
  the install paths in ~/.claude/plugins/installed_plugins.json
  ~/.claude/plugins/cache/*/relay/*/studio

Studio ships with the Relay module rather than being copied into a project.
If you are working from a Relay checkout, run it directly:

  npm run studio
EOF
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "relay-studio.sh: npm is required (Node.js 18+)." >&2
  exit 1
fi

# One install, shared by every project, next to the app itself.
if [ ! -d "$STUDIO_DIR/node_modules" ]; then
  echo "Installing Studio dependencies (first run only)…"
  npm --prefix "$STUDIO_DIR" install --silent
fi

[ "$OPEN_BROWSER" -eq 1 ] && VITE_ARGS+=(--open)

echo "Relay Studio → $PROJECT_ROOT"
echo "Stop with Ctrl-C."

# npm sets INIT_CWD to the directory npm was invoked from, unaffected by
# --prefix, and server/api.ts reads it to know which project to edit. Hence
# the cd: it is what tells Studio where it is pointed.
cd "$PROJECT_ROOT"
exec npm --prefix "$STUDIO_DIR" run dev -- "${VITE_ARGS[@]}"
