import { Router } from "express";
import { adminMiddleware } from "../lib/auth";
import { isStorageConfigured, bucketStatus, BUCKETS } from "../lib/supabaseStorage";
import { realtimeEnabled } from "../lib/supabase";
import { bizportalSyncConfigured, lastSyncState } from "../lib/bizportalSync";
import { dbSource } from "@workspace/db";

const router = Router();

/**
 * GET /api/admin/system/supabase-status
 * Diagnostic endpoint — shows integration status without exposing secrets.
 */
router.get("/admin/system/supabase-status", adminMiddleware, (_req, res) => {
  const storageConfigured = isStorageConfigured();

  res.json({
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "unknown",

    database: {
      source: dbSource,
      configured: true,
    },

    storage: {
      configured: storageConfigured,
      buckets: storageConfigured
        ? Object.fromEntries(
            Object.values(BUCKETS).map((b) => [b, bucketStatus[b] ?? { ok: false, checkedAt: null, error: "Not checked" }])
          )
        : null,
      note: "SUPABASE_STORAGE_BUCKET env var is set but DEPRECATED — buckets are addressed by explicit name",
    },

    realtime: {
      enabled: realtimeEnabled,
      note: realtimeEnabled
        ? "Active — availability broadcasts are live"
        : "Disabled (no-op) — set SUPABASE_URL + SUPABASE_ANON_KEY to enable",
    },

    bizportalSync: {
      pushConfigured: bizportalSyncConfigured,
      pullConfigured: Boolean(process.env.BIZPORTAL_SYNC_API_KEY),
      lastBookingSync: lastSyncState.booking,
      lastMembershipSync: lastSyncState.membership,
      lastStatusSync: lastSyncState.status,
      note: bizportalSyncConfigured
        ? "Push sync active (Sport Center → BizPortal)"
        : "Push sync DISABLED — SUPABASE_DATABASE_URL not set or BizPortal table not reachable",
    },

    deprecatedEnvVars: [
      {
        name: "SUPABASE_URL_DEV",
        status: process.env.SUPABASE_URL_DEV ? "set-but-unused" : "not-set",
        note: "Set but not used in any code path. Document only.",
      },
      {
        name: "SUPABASE_PG_URL",
        status: process.env.SUPABASE_PG_URL ? "set-but-unused" : "not-set",
        note: "Points to same Supabase DB as SUPABASE_DATABASE_URL. Redundant.",
      },
      {
        name: "SUPABASE_STORAGE_BUCKET",
        status: process.env.SUPABASE_STORAGE_BUCKET ? "set-but-unused" : "not-set",
        note: "Buckets are addressed explicitly in code. This var is not read.",
      },
    ],
  });
});

export default router;
