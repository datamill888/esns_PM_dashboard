#!/usr/bin/env bash
#
# run.sh — set up and run the app with one command.
#
# Usage:
#   ./run.sh          # install deps (if needed), start the dev server
#   ./run.sh build    # install deps and build the Node artifact, then exit
#   ./run.sh prod     # execute the existing artifact; never install/build
#
# Uses bun (this project's package manager). The dev server loads the
# workspace .env (platform-managed, mirroring the app's secrets) into the
# environment automatically, so those values are picked up without any
# extra step.

set -euo pipefail

# Always run from the script's own directory, no matter where it's invoked from.
cd "$(dirname "$0")"

MODE="${1:-dev}"
# Dev server port. The --port flag below overrides server.port in
# vite.config.ts, and --strictPort makes vite fail loudly instead of drifting
# to another port. Override with PORT=…
PORT="${PORT:-3000}"

# --- require bun -------------------------------------------------------------
if [ "$MODE" != "prod" ] && ! command -v bun >/dev/null 2>&1; then
  echo "Error: 'bun' is not installed. Install it: https://bun.sh" >&2
  exit 1
fi
if [ "$MODE" = "prod" ] && ! command -v node >/dev/null 2>&1; then
  echo "Error: 'node' is required to run the production server." >&2
  exit 1
fi

# --- install dependencies (development/build only) --------------------------
# Gated on the RUNNER, not on the directory. `node_modules` existing does not
# mean the install FINISHED: an interrupted `bun install` (a killed preview
# build, a lost connection, an OOM) leaves a partial tree, and the old
# `[ ! -d node_modules ]` check would skip the repair and go straight to
# `bun run dev` — which then dies with `vite: command not found` and never
# self-heals.
#
# Once the runner IS present the refresh is best-effort: reconciling against
# bun.lock costs ~10ms, but this script runs under `set -e`, so a transient
# registry failure (or a sandbox resumed without egress) must not turn a working
# tree into a dead dev server.
if [ "$MODE" != "prod" ]; then
  if [ -x node_modules/.bin/vite ]; then
    bun install || echo "==> Warning: dependency refresh failed; continuing with the existing node_modules." >&2
  else
    echo "==> Installing dependencies (bun install)..."
    bun install
  fi
fi

# --- Free the port ------------------------------------------------------
if [ "$MODE" != "build" ] && lsof -ti "tcp:${PORT}" >/dev/null 2>&1; then
  echo "Port ${PORT} is in use — stopping the existing process..."
  lsof -ti "tcp:${PORT}" | xargs kill -9 2>/dev/null || true
fi

# --- run ---------------------------------------------------------------------
case "$MODE" in
  dev)
    echo "==> Starting dev server (bun run dev on port ${PORT})..."
    # Scope NODE_ENV=development to just the dev server. The sandbox runs with
    # NODE_ENV=production (the agent-host default); inherited, it puts `vite dev`
    # into React production mode ("dead code elimination has not been applied"
    # + a `process is not defined` hydration crash). `env` overrides it for this
    # process only, leaving the platform in production.
    exec env NODE_ENV=development bun run dev -- --port "${PORT}" --host --strictPort
    ;;
  build)
    echo "==> Building the production Node server..."
    NITRO_PRESET=node-server bun run build
    echo "==> Production server artifact is ready in dist/."
    ;;
  prod)
    echo "==> Starting the bundled production server on port ${PORT}..."
    exec env NODE_ENV=production PORT="${PORT}" HOST=0.0.0.0 \
      NITRO_PORT="${PORT}" NITRO_HOST=0.0.0.0 node dist/server/index.mjs
    ;;
  *)
    echo "Error: unknown mode '$MODE'. Use 'dev' (default), 'build', or 'prod'." >&2
    exit 1
    ;;
esac
