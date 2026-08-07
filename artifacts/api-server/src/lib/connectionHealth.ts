import { db, systemConnectionBaselinesTable } from "@workspace/db";
import { dbSource, isDevUsingProdDb } from "@workspace/db";
import { bucketStatus, storageProjectSource, BUCKETS, isDevUsingProdStorage } from "./supabaseStorage";
import { realtimeEnabled, realtimeProjectSource, isRealtimeNoop } from "./supabase";
import { logAudit } from "./auditLog";
import { sql } from "drizzle-orm";

const IS_DEV = process.env.NODE_ENV === "development";

export type ConnectionStatus = "healthy" | "warning" | "error" | "changed" | "unavailable" | "unchecked";

export interface ConnectionResult {
  key: string;
  name: string;
  type: string;
  status: ConnectionStatus;
  environment: string;
  projectRef: string | null;
  configSource: string | null;
  responseTimeMs: number | null;
  message: string;
  riskNote: string | null;
  lastChecked: string;
  details?: Record<string, unknown>;
}

function getProjectRefFromUrl(url: string): string | null {
  return (
    url.match(/\/\/([^.]+)\.supabase/)?.[1] ||
    url.match(/postgres\.([^:@.]+)/)?.[1] ||
    null
  );
}

function getProjectRefFromJwt(jwt: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    return payload.ref ?? null;
  } catch {
    return null;
  }
}

async function checkDatabase(): Promise<ConnectionResult> {
  const start = Date.now();
  const env = IS_DEV ? "development" : "production";
  const connUrl = IS_DEV
    ? process.env.SUPABASE_DATABASE_URL_DEV || process.env.DATABASE_URL || ""
    : process.env.SUPABASE_DATABASE_URL || "";
  const projectRef = getProjectRefFromUrl(connUrl);

  try {
    await db.execute(sql`SELECT 1`);

    const { rows: schemaRows } = await db.execute(sql`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name = 'sport_center'
    `);
    if ((schemaRows as any[]).length === 0) {
      return {
        key: "db_primary", name: "PostgreSQL Database", type: "database",
        status: "error", environment: env, projectRef, configSource: dbSource,
        responseTimeMs: Date.now() - start,
        message: "Schema sport_center tidak ditemukan di database",
        riskNote: "⚠️ Schema utama hilang — semua fitur booking tidak bisa diakses.",
        lastChecked: new Date().toISOString(),
      };
    }

    const REQUIRED_TABLES = [
      "users", "sport_facilities", "sport_bookings", "sport_payments", "blocked_schedules",
      "sport_settings", "company_invoices", "accounting_journals",
    ];
    const tableList = REQUIRED_TABLES.map((t) => `'${t}'`).join(",");
    const { rows: tableRows } = await db.execute(
      sql.raw(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'sport_center'
          AND table_name IN (${tableList})
      `)
    );
    const foundTables = (tableRows as any[]).map((r: any) => r.table_name as string);
    const missingTables = REQUIRED_TABLES.filter((t) => !foundTables.includes(t));

    let status: ConnectionStatus = "healthy";
    let message = IS_DEV
      ? `Connected to isolated DEV database (${projectRef})`
      : `Connected to PRODUCTION database (${projectRef})`;
    let riskNote: string | null = null;

    if (isDevUsingProdDb) {
      status = "warning";
      message = "DEV terhubung ke database PRODUCTION (ALLOW_DEV_ON_PROD_DB=true)";
      riskNote = "⚠️ Setiap write dari dev AKAN mempengaruhi data produksi!";
    } else if (missingTables.length > 0) {
      status = "warning";
      message = `Tabel tidak ditemukan: ${missingTables.join(", ")}`;
      riskNote = "Tabel schema mungkin belum dimigrasikan.";
    }

    return {
      key: "db_primary", name: "PostgreSQL Database", type: "database",
      status, environment: env, projectRef, configSource: dbSource,
      responseTimeMs: Date.now() - start,
      message, riskNote, lastChecked: new Date().toISOString(),
      details: {
        schema: "sport_center",
        tablesFound: foundTables.length,
        tablesMissing: missingTables.length > 0 ? missingTables : "none",
      },
    };
  } catch (err: any) {
    return {
      key: "db_primary", name: "PostgreSQL Database", type: "database",
      status: "error", environment: env, projectRef, configSource: dbSource,
      responseTimeMs: Date.now() - start,
      message: `Koneksi DB gagal: ${(err?.message ?? "unknown").slice(0, 100)}`,
      riskNote: "⚠️ Database tidak bisa diakses — semua fitur booking terdampak.",
      lastChecked: new Date().toISOString(),
    };
  }
}

function checkStorageBucket(bucketName: string, key: string, displayName: string): ConnectionResult {
  const env = IS_DEV ? "development" : "production";
  const replitAvailable = !!(process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN);
  const serviceKey = IS_DEV
    ? process.env.SUPABASE_SERVICE_ROLE_KEY_DEV
    : process.env.SUPABASE_SERVICE_ROLE_KEY;
  const projectRef = serviceKey ? getProjectRefFromJwt(serviceKey) : null;
  const bStatus = bucketStatus[bucketName];
  const supabaseOk = bStatus?.ok ?? false;

  let status: ConnectionStatus;
  let message: string;
  let riskNote: string | null = null;

  // Replit Object Storage adalah PRIMARY — jika tersedia, storage selalu sehat
  if (replitAvailable) {
    status = "healthy";
    if (supabaseOk) {
      message = `${displayName}: Replit Object Storage (primary) + Supabase (fallback) — keduanya siap`;
    } else {
      const supabaseErr = bStatus?.error ?? "tidak dapat diakses";
      message = `${displayName}: Replit Object Storage (primary) aktif. Supabase fallback error: ${supabaseErr.slice(0, 80)}`;
      riskNote = "Supabase Storage melebihi kuota egress — Replit Object Storage digunakan sebagai primary.";
    }
  } else if (isDevUsingProdStorage) {
    status = "warning";
    message = "DEV menggunakan Storage PRODUCTION (ALLOW_DEV_ON_PROD_STORAGE=true)";
    riskNote = "⚠️ Upload dari dev akan masuk ke bucket produksi!";
  } else if (!serviceKey) {
    status = "unavailable";
    message = `SUPABASE_SERVICE_ROLE_KEY${IS_DEV ? "_DEV" : ""} tidak di-set, Replit Object Storage juga tidak tersedia`;
    riskNote = "Upload file tidak akan berfungsi.";
  } else if (supabaseOk) {
    status = "healthy";
    message = `Bucket ${bucketName} tersedia (${IS_DEV ? "dev" : "prod"})`;
  } else {
    status = "error";
    message = bStatus?.error
      ? `Bucket error: ${bStatus.error}`
      : `Bucket ${bucketName} tidak ditemukan / tidak bisa diakses`;
    riskNote = "Upload gambar fasilitas / bukti pembayaran tidak bisa dilakukan.";
  }

  return {
    key, name: displayName, type: "storage",
    status, environment: env, projectRef,
    configSource: replitAvailable ? "Replit Object Storage (primary) + Supabase (fallback)" : storageProjectSource,
    responseTimeMs: null,
    message, riskNote, lastChecked: bStatus?.checkedAt ?? new Date().toISOString(),
    details: { bucketName, replitPrimary: replitAvailable, supabaseOk },
  };
}

function checkRealtime(): ConnectionResult {
  const env = IS_DEV ? "development" : "production";
  const urlKey = IS_DEV ? process.env.SUPABASE_URL_DEV : process.env.SUPABASE_URL;
  const projectRef = urlKey ? getProjectRefFromUrl(urlKey) : null;

  if (isRealtimeNoop) {
    return {
      key: "realtime", name: "Supabase Realtime", type: "realtime",
      status: "warning", environment: env, projectRef, configSource: realtimeProjectSource,
      responseTimeMs: null,
      message: `Realtime no-op: ${realtimeProjectSource}`,
      riskNote: "Update ketersediaan slot tidak akan broadcast ke frontend secara realtime.",
      lastChecked: new Date().toISOString(),
    };
  }

  return {
    key: "realtime", name: "Supabase Realtime", type: "realtime",
    status: realtimeEnabled ? "healthy" : "unavailable",
    environment: env, projectRef, configSource: realtimeProjectSource,
    responseTimeMs: null,
    message: realtimeEnabled
      ? `Realtime aktif: ${realtimeProjectSource}`
      : "Supabase Realtime tidak dikonfigurasi",
    riskNote: realtimeEnabled ? null : "Frontend akan fallback ke polling 30 detik.",
    lastChecked: new Date().toISOString(),
  };
}

function checkFrontendRealtime(): ConnectionResult {
  const env = IS_DEV ? "development" : "production";
  const urlKey = IS_DEV ? process.env.SUPABASE_URL_DEV : process.env.SUPABASE_URL;
  const projectRef = urlKey ? getProjectRefFromUrl(urlKey) : null;
  const hasKey = IS_DEV
    ? !!process.env.SUPABASE_ANON_KEY_DEV
    : !!process.env.SUPABASE_ANON_KEY;
  const hasUrl = !!urlKey;

  return {
    key: "frontend_realtime", name: "Frontend Realtime (VITE)", type: "frontend-realtime",
    status: (hasUrl && hasKey) ? "healthy" : "warning",
    environment: env, projectRef,
    configSource: `VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY`,
    responseTimeMs: null,
    message: (hasUrl && hasKey)
      ? `VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY tersedia (ref=${projectRef ?? "unknown"})`
      : "VITE_SUPABASE_URL atau VITE_SUPABASE_ANON_KEY tidak di-set",
    riskNote: (hasUrl && hasKey) ? null : "Frontend tidak bisa subscribe Realtime — fallback ke polling.",
    lastChecked: new Date().toISOString(),
  };
}

function checkWhatsApp(): ConnectionResult {
  const token = process.env.FONNTE_TOKEN;
  const hasToken = !!token;
  return {
    key: "fonnte_wa", name: "WhatsApp (Fonnte)", type: "messaging",
    status: hasToken ? "healthy" : "warning",
    environment: IS_DEV ? "development" : "production",
    projectRef: null, configSource: "FONNTE_TOKEN",
    responseTimeMs: null,
    message: hasToken
      ? "FONNTE_TOKEN dikonfigurasi — WA notifikasi aktif"
      : "FONNTE_TOKEN tidak di-set — WA notifikasi dinonaktifkan",
    riskNote: hasToken ? null : "Notifikasi booking ke customer via WhatsApp tidak berfungsi.",
    lastChecked: new Date().toISOString(),
    details: token ? { tokenMasked: `${token.slice(0, 8)}...***masked***` } : { tokenMasked: "[not set]" },
  };
}

function checkApiServer(): ConnectionResult {
  return {
    key: "api_server", name: "API Server (Express)", type: "api",
    status: "healthy",
    environment: IS_DEV ? "development" : "production",
    projectRef: null,
    configSource: `PORT=${process.env.PORT ?? 8099}`,
    responseTimeMs: 0,
    message: `API Server aktif — PORT=${process.env.PORT ?? 8099}, NODE_ENV=${process.env.NODE_ENV}`,
    riskNote: null,
    lastChecked: new Date().toISOString(),
    details: { port: process.env.PORT ?? "8099", nodeEnv: process.env.NODE_ENV },
  };
}

function checkSessionSecret(): ConnectionResult {
  const hasSecret = !!process.env.SESSION_SECRET;
  return {
    key: "session_secret", name: "Auth (SESSION_SECRET)", type: "auth",
    status: hasSecret ? "healthy" : "error",
    environment: IS_DEV ? "development" : "production",
    projectRef: null, configSource: "SESSION_SECRET",
    responseTimeMs: null,
    message: hasSecret
      ? "SESSION_SECRET dikonfigurasi — HMAC password hashing aktif"
      : "SESSION_SECRET tidak di-set — login admin akan gagal",
    riskNote: hasSecret ? null : "⚠️ Admin login tidak bisa berfungsi tanpa SESSION_SECRET.",
    lastChecked: new Date().toISOString(),
  };
}

async function persistBaseline(conn: ConnectionResult): Promise<void> {
  try {
    await db
      .insert(systemConnectionBaselinesTable)
      .values({
        connectionKey: conn.key,
        connectionName: conn.name,
        connectionType: conn.type,
        expectedEnvironment: conn.environment,
        expectedProjectRef: conn.projectRef,
        currentProjectRef: conn.projectRef,
        status: conn.status,
        responseTimeMs: conn.responseTimeMs ?? null,
        lastMessage: conn.message,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemConnectionBaselinesTable.connectionKey,
        set: {
          currentProjectRef: conn.projectRef,
          status: conn.status,
          responseTimeMs: conn.responseTimeMs ?? null,
          lastMessage: conn.message,
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  } catch {
    // Non-critical — table may not exist yet on first boot before migration
  }
}

// Track previous statuses to detect changes (avoid spamming audit log)
const prevStatuses: Record<string, ConnectionStatus> = {};

export async function runConnectionHealthCheck(source = "scheduler"): Promise<ConnectionResult[]> {
  const [dbResult] = await Promise.all([checkDatabase()]);

  const connections: ConnectionResult[] = [
    dbResult,
    checkStorageBucket(BUCKETS.facility, "storage_facility_images", "Storage - facility-images"),
    checkStorageBucket(BUCKETS.proof, "storage_payment_proofs", "Storage - payment-proofs"),
    checkRealtime(),
    checkFrontendRealtime(),
    checkApiServer(),
    checkWhatsApp(),
    checkSessionSecret(),
  ];

  // Persist baselines (non-blocking)
  Promise.all(connections.map(persistBaseline)).catch(() => {});

  // Only audit log when status changes (suppress spam)
  const changed = connections.filter((c) => {
    const prev = prevStatuses[c.key];
    const didChange = prev !== undefined && prev !== c.status;
    prevStatuses[c.key] = c.status;
    return didChange;
  });

  if (changed.length > 0) {
    const hasError = changed.some((c) => c.status === "error" || c.status === "changed");
    logAudit({
      action: hasError ? "CONNECTION_FAILED" : "CONNECTION_RECOVERED",
      entity: "system_connections",
      after: {
        source,
        checkedAt: new Date().toISOString(),
        changes: changed.map((c) => ({
          key: c.key,
          from: prevStatuses[c.key],
          to: c.status,
          message: c.message,
        })),
      },
    }).catch(() => {});
  }

  // First-run: seed prev statuses
  if (Object.keys(prevStatuses).length === 0) {
    for (const c of connections) prevStatuses[c.key] = c.status;
  }

  return connections;
}
