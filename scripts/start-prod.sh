#!/bin/bash
set -e

echo "[start-prod] Starting production API server on port 8080..."

export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--trace-deprecation"

exec env \
  PORT=8080 \
  NODE_ENV=production \
  node --enable-source-maps ./artifacts/api-server/dist/bootstrap.mjs
