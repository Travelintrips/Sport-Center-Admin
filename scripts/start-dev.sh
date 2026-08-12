#!/bin/bash
set -e

# If port 8080 is already open (e.g. managed artifact workflow already started
# the API server), just keep this workflow alive without conflicting.
if curl -s http://localhost:8080/api/health > /dev/null 2>&1; then
  echo "[start-dev] API server already running on port 8080 (managed workflow). Standing by."
  exec sleep infinity
fi

# Kill any stale API server process on port 8080 before starting
pkill -f "artifacts/api-server/dist/index.mjs" 2>/dev/null || true
fuser -k 8080/tcp 2>/dev/null || true
sleep 1

# Build the API server first
echo "[start-dev] Building API server..."
pnpm --filter @workspace/api-server run build

# Start API server (foreground — this is what Replit monitors)
echo "[start-dev] Starting API server on port 8080..."
PORT=8080 NODE_ENV=development node --enable-source-maps ./artifacts/api-server/dist/index.mjs
