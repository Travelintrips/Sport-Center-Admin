import { Router } from "express";
import { adminMiddleware } from "../lib/auth";
import {
  isStorageConfigured,
  bucketStatus,
  BUCKETS,
  storageProjectSource,
  isDevUsingProdStorage,
  allowDevOnProdStorage,
} from "../lib/supabaseStorage";
import {
  realtimeEnabled,
  realtimeProjectSource,
  isRealtimeNoop,
} from "../lib/supabase";
import { bizportalSyncConfigured, lastSyncState } from "../lib/bizportalSync";
import { dbSource, isDevUsingProdDb, dbEnvironment, allowDevOnProdDb } from "@workspace/db";

const router = Router();

/**
 * GET /api/admin/system/supabase-status
 * Diagnostic endpoint — shows full integration status without exposing secrets or URLs.
 */
router.get("/admin/system/supabase-status", adminMiddleware, (_req, res) => {
  const storageConfigured = isStorageConfigured();

  const dbWarning = isDevUsingProdDb
    ? "⚠️ DANGER: Development is connected to the PRODUCTION database. " +
      "ALLOW_DEV_ON_PROD_DB=true is active. Remove immediately and set SUPABASE_DATABASE_URL_DEV."
    : null;

  const storageWarning = isDevUsingProdStorage
    ? "⚠️ DANGER: Development is uploading to PRODUCTION Supabase storage. " +
      "ALLOW_DEV_ON_PROD_STORAGE=true is active. Remove immediately and set SUPABASE_SERVICE_ROLE_KEY_DEV."
    : null;

  res.json({
    generatedAt: new Date().toISOString(),

    database: {
      dbEnvironment,
      dbSource,
      configured: true,
      isDevUsingProdDb,
      allowDevOnProdDb,
      devDbConfigured: Boolean(process.env.SUPABASE_DATABASE_URL_DEV),
      prodDbConfigured: Boolean(process.env.SUPABASE_DATABASE_URL),
      warning: dbWarning,
    },

    storage: {
      configured: storageConfigured,
      storageProjectSource,
      isDevUsingProdStorage,
      allowDevOnProdStorage,
      buckets: storageConfigured
        ? Object.fromEntries(
            Object.values(BUCKETS).map((b) => [
              b,
              bucketStatus[b] ?? { ok: false, checkedAt: null, error: "Not checked" },
            ])
          )
        : null,
      warning: storageWarning,
      note: "SUPABASE_STORAGE_BUCKET env var is DEPRECATED — buckets are addressed by explicit constant",
    },

    realtime: {
      enabled: realtimeEnabled,
      realtimeProjectSource,
      isRealtimeNoop,
      note: realtimeEnabled
        ? `Active — source: ${realtimeProjectSource}`
        : `Disabled (no-op) — source: ${realtimeProjectSource}`,
    },

    bizportalSync: {
      pushConfigured: bizportalSyncConfigured,
      pullConfigured: Boolean(process.env.BIZPORTAL_SYNC_API_KEY),
      lastBookingSync: lastSyncState.booking,
      lastMembershipSync: lastSyncState.membership,
      lastStatusSync: lastSyncState.status,
      note: bizportalSyncConfigured
        ? "Push sync active (Sport Center → BizPortal via SUPABASE_DATABASE_URL)"
        : "Push sync DISABLED — SUPABASE_DATABASE_URL not set",
    },

    deprecatedEnvVars: [
      {
        name: "SUPABASE_PG_URL",
        status: process.env.SUPABASE_PG_URL ? "set-but-unused" : "not-set",
        note: "Redundant alias of SUPABASE_DATABASE_URL. Can be removed.",
      },
      {
        name: "SUPABASE_STORAGE_BUCKET",
        status: process.env.SUPABASE_STORAGE_BUCKET ? "set-but-unused" : "not-set",
        note: "Storage buckets are addressed by explicit name in code. This var is ignored.",
      },
    ],
  });
});

export default router;
