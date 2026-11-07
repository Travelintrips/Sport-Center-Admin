/**
 * A browser tab can keep an older Vite entry after Hostinger installs a new
 * release. Lazy import URLs from that entry may no longer exist on the server.
 * Reload once per entry bundle and route; never retry forever.
 */
let reloadScheduled = false;

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|Expected a JavaScript-or-Wasm module script/i.test(message);
}

export function recoverStaleChunk(error: unknown): boolean {
  if (!isStaleChunkError(error)) return false;
  if (typeof window === "undefined" || reloadScheduled) return false;

  const entry = Array.from(document.scripts)
    .map((script) => script.src)
    .find((src) => /\/assets\/index-[\w-]+\.js(?:\?|$)/.test(src)) ?? "unknown-entry";
  const key = `sc-stale-chunk-retry:${entry}:${window.location.pathname}`;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Session storage can be disabled; don't risk an infinite reload loop.
    return false;
  }

  reloadScheduled = true;
  window.location.reload();
  return true;
}
