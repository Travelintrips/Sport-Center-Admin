export const MINA_SESSION_COOKIE = "mina_web_session";
export const MAX_MESSAGE_LENGTH = 2_000;
export const MAX_PAGE_URL_LENGTH = 2_048;
export const MAX_FACILITY_NAME_LENGTH = 160;
export const RATE_WINDOW_MS = 60_000;
export const MAX_REQUESTS_PER_WINDOW = 20;

export function isValidMinaSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export function readCookieHeader(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const pair = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
}

export function cleanMinaText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeMinaPagePath(rawUrl: string, host = "sport-center.local"): string {
  try {
    return new URL(rawUrl, `https://${host}`).pathname;
  } catch {
    return "";
  }
}

export function createMinaRateLimiter(
  now: () => number = Date.now,
): (key: string) => boolean {
  const entries = new Map<string, { count: number; resetAt: number }>();

  return (key: string): boolean => {
    const currentTime = now();
    const current = entries.get(key);
    if (!current || current.resetAt <= currentTime) {
      entries.set(key, { count: 1, resetAt: currentTime + RATE_WINDOW_MS });
      if (entries.size > 10_000) {
        for (const [entryKey, entry] of entries) {
          if (entry.resetAt <= currentTime) entries.delete(entryKey);
        }
      }
      return false;
    }
    current.count += 1;
    return current.count > MAX_REQUESTS_PER_WINDOW;
  };
}