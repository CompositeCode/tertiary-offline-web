#!/usr/bin/env bash
#
# run.sh — launch the Offline Web desktop app in development mode.
#
# This starts the Vite dev server and the Tauri shell together
# (`npm run tauri dev`), rebuilding the Rust backend as needed.
#
# Usage:
#   ./scripts/run.sh          # run the app (dev mode)
#   ./scripts/run.sh --build  # produce a production build instead
#
set -euo pipefail

# Resolve the project root (the parent of this script's directory) so the
# script works no matter where it is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Tauri needs Rust's `cargo` on PATH. When launched from a GUI or a terminal
# whose shell config hasn't loaded it, add the standard rustup location.
if ! command -v cargo >/dev/null 2>&1; then
  if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: 'cargo' not found. Install Rust from https://rustup.rs" >&2
  exit 1
fi

# Ensure JS dependencies are present.
if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (npm install)..."
  npm install
fi

if [ "${1:-}" = "--build" ]; then
  echo "==> Building Offline Web (production)..."
  exec npm run tauri build
fi

echo "==> Starting Offline Web (dev mode)..."
exec npm run tauri dev
