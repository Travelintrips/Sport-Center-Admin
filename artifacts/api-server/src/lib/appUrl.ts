import { db, settingsTable } from "@workspace/db";

let _cachedUrl: string | null = null;
let _cacheExpiry = 0;
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

export function invalidateBaseUrlCache(): void {
  _cachedUrl = null;
  _cacheExpiry = 0;
}
