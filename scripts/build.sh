#!/bin/bash
set -e

echo "[build] Installing dependencies..."
pnpm install --frozen-lockfile

echo "[build] Running full build..."
pnpm run build

echo "[build] Build complete."
