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
 * BERBEDA dari getBaseUrl():
 * - getBaseUrl() di dev pakai REPLIT_DEV_DOMAIN (ephemeral, berubah setiap restart)
 * - getPaymentCallbackUrl() SELALU prioritaskan APP_URL atau paymentDomain dari DB
 *   karena Paylabs menyimpan notifyUrl per-transaksi — jika domain berubah,
 *   callback tidak akan pernah diterima.
 *
 * Priority: DB paymentDomain → ENV APP_URL → REPLIT_DEV_DOMAIN (terakhir, fallback saja)
 */
export async function getPaymentCallbackUrl(): Promise<string> {
  const now = Date.now();
  if (_cachedPaymentUrl !== null && now < _paymentCacheExpiry) return _cachedPaymentUrl;

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

  // Fallback: APP_URL (stabil, tidak berubah saat restart), baru REPLIT_DEV_DOMAIN
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
