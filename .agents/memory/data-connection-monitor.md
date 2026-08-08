---
name: Data Connection Monitor
description: Health check module for all system connections — key implementation decisions.
---

## Key decisions

- Health check logic lives in `artifacts/api-server/src/lib/connectionHealth.ts` (NOT in the route file), so scheduler can import it without circular deps.
- Route: `GET /api/admin/system/connections/health` in `artifacts/api-server/src/routes/dataConnections.ts`.
- Frontend page: `/admin/data-connections` → `artifacts/sport-center/src/pages/admin/DataConnections.tsx`.

## DB table name gotcha
- The blocked schedules table is named `blocked_schedules`, NOT `schedules` (defined in `lib/db/src/schema/schedules.ts` as `blockedSchedulesTable`).

## Drizzle sql template gotcha
- `sql\`... AND table_name = ANY(${array})\`` does NOT work in Drizzle for information_schema queries.
- Use `sql.raw(\`... AND table_name IN (${list})\`)` instead where list = `REQUIRED_TABLES.map(t => \`'${t}'\`).join(",")`.

## Status spam prevention
- `prevStatuses` in-memory map in connectionHealth.ts prevents audit log spam — only logs when status actually changes.
- Baselines table (`system_connection_baselines`) persisted via `onConflictDoUpdate` — safe to call repeatedly.

## Alert banner
- AdminLayout polls health endpoint every 5 min (only when user is authenticated).
- Red banner for error/changed status, amber for warning, no banner if all healthy.
- Sidebar badge count shown on "Data Connections" menu item.

**Why:**
- Separating check logic from route prevents circular imports (scheduler → route → scheduler would be bad).
- sql.raw() is needed because Drizzle can't bind JS arrays to SQL ANY() for raw query operations.
