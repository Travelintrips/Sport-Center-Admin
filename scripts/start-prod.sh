#!/bin/bash
set -e

echo "[start-prod] Starting production API server on port 8080..."
exec PORT=8080 NODE_ENV=production node --enable-source-maps ./artifacts/api-server/dist/index.mjs
