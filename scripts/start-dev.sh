#!/bin/bash
set -e

# Kill any stale processes on ports 5000 and 8080 before starting
pkill -f "artifacts/api-server/dist/index.mjs" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
fuser -k 5000/tcp 8080/tcp 2>/dev/null || true
sleep 1

# Build the API server first
echo "[start-dev] Building API server..."
pnpm --filter @workspace/api-server run build

# Start API server in background
echo "[start-dev] Starting API server on port 8080..."
PORT=8080 NODE_ENV=development node --enable-source-maps ./artifacts/api-server/dist/index.mjs &
API_PID=$!

# Wait for API server to be ready
echo "[start-dev] Waiting for API server..."
for i in $(seq 1 30); do
  if curl -s http://localhost:8080/api/health > /dev/null 2>&1; then
    echo "[start-dev] API server ready."
    break
  fi
  sleep 1
done

# Start frontend dev server (foreground, this is what Replit monitors)
echo "[start-dev] Starting frontend on port 5000..."
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/sport-center run dev
