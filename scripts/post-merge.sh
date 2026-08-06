#!/bin/bash
# post-merge.sh — runs after every task merge
# DO NOT use drizzle-kit push here; it hangs on the shared Supabase instance.
# All schema changes are applied via the idempotent custom migration script instead.
set -e

echo "=== post-merge: installing packages ==="
pnpm install --frozen-lockfile

echo "=== post-merge: applying dev schema migrations ==="
# Applies drizzle baseline + all custom ALTER TABLE / CREATE TABLE migrations
# to the DEV database. Uses SUPABASE_DATABASE_URL_DEV (falls back to SUPABASE_DATABASE_URL).
pnpm --filter scripts migrate:dev

echo "=== post-merge: done ==="
