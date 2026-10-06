import { db, settingsTable } from "@workspace/db";

let _cachedUrl: string | null = null;
let _cacheExpiry = 0;
let _cachedPaymentUrl: string | null = null;
let _paymentCacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_PRODUCTION_APP_URL = "https://sc.travelintrips.co.id";

function envFallback(): string {
  const isProd = process.env.NODE_ENV === "production";
  const explicit = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (explicit) return explicit;

  // Sport Center has a single canonical production domain. DB settings remain
  // the primary source in getBaseUrl(); this is only the fail-safe used when
  // settings cannot be read during a transient DB outage.
  return isProd ? DEFAULT_PRODUCTION_APP_URL : "";
}

function normalizePaymentCallbackBase(value: string): string {
  return value
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
}

export async function getBaseUrl(): Promise<string> {
  const now = Date.now();
  if (_cachedUrl !== null && now < _cacheExpiry) return _cachedUrl;

  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    _cachedUrl = (process.env.DEV_APP_URL ?? process.env.APP_URL ?? "http://localhost:5000").replace(/\/$/, "");
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
 *  3. Dev mode  → DEV_APP_URL, otherwise empty unless explicitly configured
 *  4. Prod mode → APP_URL override → canonical Sport Center domain as fail-safe
 */
export async function getPaymentCallbackUrl(): Promise<string> {
  const now = Date.now();
  if (_cachedPaymentUrl !== null && now < _paymentCacheExpiry) return _cachedPaymentUrl;

  // 1. Explicit env override — selalu menang di semua mode
  const explicitOverride = normalizePaymentCallbackBase(process.env.PAYLABS_CALLBACK_BASE_URL ?? "");
  if (explicitOverride) {
    _cachedPaymentUrl = explicitOverride;
    _paymentCacheExpiry = now + CACHE_TTL_MS;
    return _cachedPaymentUrl;
  }

  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    // Dev callbacks must use an explicitly reachable DEV URL. Never reuse
    // the production domain implicitly.
    _cachedPaymentUrl = normalizePaymentCallbackBase(process.env.DEV_APP_URL ?? "");
    _paymentCacheExpiry = now + CACHE_TTL_MS;
    return _cachedPaymentUrl;
  }

  // 3. Production: DB paymentDomain/appUrl (admin panel) remains authoritative
  try {
    const [s] = await db
      .select({ paymentDomain: settingsTable.paymentDomain, appUrl: settingsTable.appUrl })
      .from(settingsTable)
      .limit(1);
    const dbOverride = normalizePaymentCallbackBase(s?.paymentDomain || s?.appUrl || "");
    if (dbOverride) {
      _cachedPaymentUrl = dbOverride;
      _paymentCacheExpiry = now + CACHE_TTL_MS;
      return _cachedPaymentUrl;
    }
  } catch {
    // fall through
  }

  // 4. Production fail-safe: optional APP_URL override, otherwise the canonical
  // Sport Center domain. This keeps payment callbacks valid even if Hostinger
  // does not inject APP_URL and the settings lookup is temporarily unavailable.
  _cachedPaymentUrl = normalizePaymentCallbackBase(envFallback());

  _paymentCacheExpiry = now + CACHE_TTL_MS;
  return _cachedPaymentUrl!;
}

export function invalidateBaseUrlCache(): void {
  _cachedUrl = null;
  _cacheExpiry = 0;
  _cachedPaymentUrl = null;
  _paymentCacheExpiry = 0;
}
