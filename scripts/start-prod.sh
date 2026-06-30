#!/bin/bash
set -e

echo "[start-prod] Building API server..."
pnpm --filter @workspace/api-server run build

echo "[start-prod] Starting production API server on port 8080..."
exec PORT=8080 NODE_ENV=production node --enable-source-maps ./artifacts/api-server/dist/index.mjs
