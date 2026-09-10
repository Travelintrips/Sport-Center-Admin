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
 * Sanitize a source label to strip any embedded URLs, project refs, or secrets.
 * Only retain the env var name and environment tag.
 */
function sanitizeSourceLabel(label: string): string {
  return label
    .replace(/ref=[^\s,)]+/g, "ref=<redacted>")
    .replace(/https?:\/\/[^\s,)]+/g, "<url-redacted>");
}

/**
 * GET /api/admin/system/supabase-status
 *
 * Production-safe diagnostic endpoint.
 * - Never exposes DB connection strings, service role keys, or anon keys.
 * - Never exposes Supabase project refs or URLs.
 * - Only returns source label (env var name) and status booleans.
 */
router.get("/admin/system/supabase-status", adminMiddleware, (_req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  const storageConfigured = isStorageConfigured();

  const dbWarning = isDevUsingProdDb
    ? "DANGER: Development is connected to the PRODUCTION database."
    : null;

  const storageWarning = isDevUsingProdStorage
    ? "DANGER: Development is uploading to PRODUCTION Supabase storage. " +
      "ALLOW_DEV_ON_PROD_STORAGE=true is active. Remove immediately and set SUPABASE_SERVICE_ROLE_KEY_DEV."
    : null;

  res.json({
    generatedAt: new Date().toISOString(),
    environment: dbEnvironment,

    database: {
      configured: true,
      environment: dbEnvironment,
      source: sanitizeSourceLabel(dbSource),
      isDevUsingProdDb,
      allowDevOnProdDb,
      prodDbConfigured: Boolean(process.env.SUPABASE_DATABASE_URL),
      devDbConfigured: Boolean(process.env.SUPABASE_DATABASE_URL_DEV),
      warning: dbWarning,
    },

    storage: {
      configured: storageConfigured,
      source: sanitizeSourceLabel(storageProjectSource),
      isDevUsingProdStorage,
      allowDevOnProdStorage,
      buckets: storageConfigured
        ? Object.fromEntries(
            Object.values(BUCKETS).map((b) => [
              b,
              {
                ok: bucketStatus[b]?.ok ?? false,
                checkedAt: bucketStatus[b]?.checkedAt ?? null,
                error: bucketStatus[b]?.error ?? "Not checked yet",
              },
            ])
          )
        : null,
      prodKeyConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      devKeyConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY_DEV),
      warning: storageWarning,
    },

    realtime: {
      enabled: realtimeEnabled,
      isNoop: isRealtimeNoop,
      source: sanitizeSourceLabel(realtimeProjectSource),
      prodUrlConfigured: Boolean(process.env.SUPABASE_URL),
      prodAnonConfigured: Boolean(process.env.SUPABASE_ANON_KEY),
      devUrlConfigured: Boolean(process.env.SUPABASE_URL_DEV),
      devAnonConfigured: Boolean(process.env.SUPABASE_ANON_KEY_DEV),
      note: realtimeEnabled
        ? "Active"
        : "Disabled (no-op) — availability broadcasts are silently skipped",
    },

    bizportalSync: {
      pushConfigured: bizportalSyncConfigured,
      pullConfigured: Boolean(process.env.BIZPORTAL_SYNC_API_KEY),
      lastBookingSync: lastSyncState.booking,
      lastMembershipSync: lastSyncState.membership,
      lastStatusSync: lastSyncState.status,
      note: bizportalSyncConfigured
        ? "Push sync active (Sport Center → BizPortal)"
        : "Push sync DISABLED — SUPABASE_DATABASE_URL not set in push target",
    },

    deprecatedEnvVars: [
      {
        name: "SUPABASE_PG_URL",
        status: process.env.SUPABASE_PG_URL ? "set-but-unused" : "not-set",
        note: "Redundant alias of SUPABASE_DATABASE_URL. Safe to remove.",
      },
    ],

    safeMode: isProd
      ? "ACTIVE — no URLs, keys, or project refs are returned in production"
      : "INACTIVE — development environment, sanitized labels only",
  });
});

export default router;
