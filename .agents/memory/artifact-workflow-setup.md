---
name: Artifact workflow setup
description: How the Sport Center managed artifact workflows are configured and what to watch for after merges.
---

## Managed artifact workflows (do NOT duplicate)
After import, Replit auto-creates managed workflows from each artifact's `.replit-artifact/artifact.toml`:
- `artifacts/sport-center: web` — Vite frontend
- `artifacts/api-server: API Server` — Express backend (needs PORT=8080)
- `artifacts/mockup-sandbox: Component Preview Server` — mockup sandbox

**Critical:** If manual workflows (e.g. `Start application`, `API server`) are created for the same packages during initial setup, remove them after managed ones appear — they cause `EADDRINUSE` port conflicts.

## API server workflow configuration
The `artifact.toml` dev stanza does not set PORT, so `configureWorkflow` must be called:
```
configureWorkflow({
  name: "artifacts/api-server: API Server",
  command: "PORT=8080 NODE_ENV=development pnpm --filter @workspace/api-server run dev",
  waitForPort: 8080,
  outputType: "console"
})
```

## Availability endpoint
- Correct path: `GET /api/availability?facilityId=X&date=YYYY-MM-DD`
- Do NOT confuse with `GET /api/bookings/availability` — that hits the bookings `/:id` handler (NaN error).
- The generated API client (`@workspace/api-client-react`) correctly uses `/api/availability`.

## Post-merge setup timeout
- Script: `scripts/post-merge.sh`
- `pnpm install + migrate:dev` takes ~27s on a warm cache.
- Timeout set to 120000ms. Use `setPostMergeConfig({ timeoutMs: 120000 })` if it resets.

## db-migrate.ts CUSTOM_MIGRATION_SQL handling
- Modified to apply statements one-by-one with error skipping ($$-aware splitter).
- Required because heliumdb lacks `public.companies`, `paylabs_transactions`, etc.
- On Supabase dev DB (SUPABASE_DATABASE_URL_DEV), all 126 statements apply cleanly.

**Why:** The single `client.query(CUSTOM_MIGRATION_SQL)` call aborts on first error; statement-by-statement skipping ensures idempotent migrations work on both heliumdb and Supabase.

## Artifact production entry point
For an artifact deployment, the registered artifact production command takes precedence over the root deployment command. Its startup entry must preserve the secret-bootstrap sequence before importing the API.

**Why:** Launching the API module directly bypasses runtime secret loading, so health checks can return 500 even though the build itself succeeded.

**How to apply:** When changing the API build output or production entry point, validate the exact artifact command and its health endpoint, not only the root `.replit` deployment command.
