#!/usr/bin/env bash
# =============================================================================
# A11y-Agent — one-shot setup & run script (macOS / Linux / WSL)
#
# Usage:
#   ./setup.sh                    # install deps + build engine
#   ./setup.sh scan 42 owner/repo # scan a GitHub PR (dry-run)
#   ./setup.sh local <file>       # scan a local file
#   ./setup.sh ext                # build the VS Code extension
#   ./setup.sh clean              # remove all build artifacts
# =============================================================================

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/a11y-agent" && pwd)"
EXT_DIR="$AGENT_DIR/vscode-extension"
ENGINE="$AGENT_DIR/dist/index.js"

_info()  { printf "\033[1;34m[a11y]\033[0m %s\n" "$*"; }
_ok()    { printf "\033[1;32m[a11y]\033[0m %s\n" "$*"; }
_err()   { printf "\033[1;31m[a11y]\033[0m %s\n" "$*" >&2; exit 1; }

# ── Require node ──────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || _err "Node.js not found. Install from https://nodejs.org (v20+)."
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[ "$NODE_MAJOR" -ge 20 ] || _err "Node.js 20+ required (found $NODE_MAJOR)."

CMD="${1:-install}"

case "$CMD" in

  install|"")
    _info "Installing engine dependencies…"
    (cd "$AGENT_DIR" && npm install --silent)
    _info "Building a11y-agent engine…"
    (cd "$AGENT_DIR" && npm run build --silent)
    _ok "Engine ready at $ENGINE"
    _ok ""
    _ok "Quick-start commands:"
    _ok "  ./setup.sh local a11y-agent/test-sample.html   # scan local file"
    _ok "  ./setup.sh ext                                  # build VS Code extension"
    _ok "  ./setup.sh scan <PR#> <owner/repo>              # scan GitHub PR (needs GITHUB_TOKEN)"
    ;;

  local)
    [ -f "$ENGINE" ] || { _info "Engine not built — running install first…"; bash "$0" install; }
    FILE="${2:-}" ; [ -n "$FILE" ] || _err "Usage: ./setup.sh local <file> [--jira <spec.md>]"
    shift 2 || true
    _info "Scanning $FILE…"
    node "$ENGINE" local "$FILE" "$@"
    ;;

  scan)
    [ -f "$ENGINE" ] || { _info "Engine not built — running install first…"; bash "$0" install; }
    PR="${2:-}"   ; [ -n "$PR"   ] || _err "Usage: ./setup.sh scan <PR-number> <owner/repo> [--dry-run]"
    REPO="${3:-}" ; [ -n "$REPO" ] || _err "Usage: ./setup.sh scan <PR-number> <owner/repo> [--dry-run]"
    shift 3 || true
    [ -n "${GITHUB_TOKEN:-}" ] || _err "GITHUB_TOKEN is not set. Export it first:\n  export GITHUB_TOKEN=ghp_..."
    _info "Scanning PR #$PR in $REPO…"
    node "$ENGINE" scan "$PR" --repo "$REPO" "$@"
    ;;

  ext)
    _info "Building VS Code extension…"
    (cd "$EXT_DIR" && node node_modules/typescript/bin/tsc -p tsconfig-ext.json)
    _ok "Extension built at $EXT_DIR/out/extension.js"
    _ok "Open $EXT_DIR in VS Code and press F5 to launch."
    ;;

  clean)
    _info "Removing build artifacts…"
    rm -rf "$AGENT_DIR/dist" "$EXT_DIR/out"
    _ok "Clean."
    ;;

  *)
    echo "Usage: ./setup.sh [install|local <file>|scan <PR> <repo>|ext|clean]"
    exit 1
    ;;
esac
