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
  // In dev mode, ALWAYS use the Replit dev domain — never let a prod
  // domain saved in settings (paymentDomain/appUrl) leak into dev-generated links.
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd && process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }

  const now = Date.now();
  if (_cachedUrl !== null && now < _cacheExpiry) return _cachedUrl;
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
