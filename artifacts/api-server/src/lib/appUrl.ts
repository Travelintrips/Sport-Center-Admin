import { db, settingsTable } from "@workspace/db";

let _cachedUrl: string | null = null;
let _cacheExpiry = 0;
let _cachedPaymentUrl: string | null = null;
let _paymentCacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function envFallback(): string {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd && process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}

export async function getBaseUrl(): Promise<string> {
  const now = Date.now();
  if (_cachedUrl !== null && now < _cacheExpiry) return _cachedUrl;

  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    // Di dev: selalu gunakan REPLIT_DEV_DOMAIN sehingga link WA/email bisa diakses
    // (domain prod belum tentu live, apalagi selama testing)
    _cachedUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : (process.env.APP_URL ?? "").replace(/\/$/, "");
    _cacheExpiry = now + CACHE_TTL_MS;
    return _cachedUrl!;
  }

  // Di production: DB settings (paymentDomain/appUrl) diprioritaskan jika di-set
  try {
    const [s] = await db
      .select({ paymentDomain: settingsTable.paymentDomain, appUrl: settingsTable.appUrl })
      .from(settingsTable)
      .limit(1);
    const override = (s?.paymentDomain || s?.appUrl || "").replace(/\/$/, "");
    _cachedUrl = override || envFallback();
  } catch {
    _cachedUrl = envFallback();
  }
  _cacheExpiry = now + CACHE_TTL_MS;
  return _cachedUrl!;
}

/**
 * URL stabil untuk payment gateway callback/webhook.
 *
 * Priority:
 *  1. Env var PAYLABS_CALLBACK_BASE_URL — explicit override untuk semua mode
 *  2. DB settings.paymentDomain atau settings.appUrl — dikonfigurasi via admin panel
 *  3. Dev mode  → REPLIT_DEV_DOMAIN (frontend Vite yang mem-proxy /api → localhost:8080)
 *     PENTING: APP_URL di dev mode TIDAK digunakan karena kemungkinan menunjuk ke URL
 *     produksi (GAE/Cloud Run) sehingga Paylabs akan mengirim callback ke prod, bukan
 *     ke dev server ini.
 *  4. Prod mode → APP_URL → REPLIT_DEV_DOMAIN sebagai last resort
 */
export async function getPaymentCallbackUrl(): Promise<string> {
  const now = Date.now();
  if (_cachedPaymentUrl !== null && now < _paymentCacheExpiry) return _cachedPaymentUrl;

  // 1. Explicit env override — selalu menang di semua mode
  const explicitOverride = (process.env.PAYLABS_CALLBACK_BASE_URL ?? "").replace(/\/$/, "");
  if (explicitOverride) {
    _cachedPaymentUrl = explicitOverride;
    _paymentCacheExpiry = now + CACHE_TTL_MS;
    return _cachedPaymentUrl;
  }

  // 2. DB settings — admin panel override
  try {
    const [s] = await db
      .select({ paymentDomain: settingsTable.paymentDomain, appUrl: settingsTable.appUrl })
      .from(settingsTable)
      .limit(1);
    const dbOverride = (s?.paymentDomain || s?.appUrl || "").replace(/\/$/, "");
    if (dbOverride) {
      _cachedPaymentUrl = dbOverride;
      _paymentCacheExpiry = now + CACHE_TTL_MS;
      return _cachedPaymentUrl;
    }
  } catch {
    // fall through
  }

  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    // 3. Dev: gunakan REPLIT_DEV_DOMAIN — ini adalah domain Vite (port 5000) yang
    //    mem-proxy semua /api/* ke localhost:8080 (API server). Paylabs callback ke
    //    domain ini akan melewati proxy Vite dan tiba di /api/paylabs/webhook dengan benar.
    //    JANGAN gunakan APP_URL di sini — APP_URL kemungkinan adalah URL produksi GAE/Cloud Run.
    _cachedPaymentUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : (process.env.APP_URL ?? "").replace(/\/$/, "");
    _paymentCacheExpiry = now + CACHE_TTL_MS;
    return _cachedPaymentUrl;
  }

  // 4. Production: APP_URL adalah URL stabil prod (GAE, Cloud Run, custom domain)
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  _cachedPaymentUrl = appUrl
    ? appUrl
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "";

  _paymentCacheExpiry = now + CACHE_TTL_MS;
  return _cachedPaymentUrl;
}

export function invalidateBaseUrlCache(): void {
  _cachedUrl = null;
  _cacheExpiry = 0;
  _cachedPaymentUrl = null;
  _paymentCacheExpiry = 0;
}
