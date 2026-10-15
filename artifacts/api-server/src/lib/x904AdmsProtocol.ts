/**
 * Solution X904 Push Service 2.0.33S protocol screening.
 * Pure checks only: no acknowledgments, writes, or device commands.
 * Expected values must be confirmed from a live device handshake before activation.
 */
export type X904AdmsClassification =
  | { kind: "handshake" | "poll" | "attendance" | "device_options"; serial: string }
  | { kind: "reject"; reason: string };

export function classifyX904AdmsRequest(method: string, requestUrl: string): X904AdmsClassification {
  let url: URL;
  try { url = new URL(requestUrl, "https://localhost"); }
  catch { return { kind: "reject", reason: "invalid_url" }; }
  // Legacy firmware varies query-key casing. Reject conflicting duplicates instead of guessing.\n  const queryValue = (key: string): string | null => {\n    const matches = [...url.searchParams.entries()].filter(([k]) => k.toLowerCase() === key.toLowerCase()).map(([,v]) => v);\n    return matches.length === 0 ? null : matches.every(v => v === matches[0]) ? matches[0] : null;\n  };\n  const serial = queryValue("SN") ?? "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(serial)) return { kind: "reject", reason: "serial_invalid" };
  // Some Push firmware appends .aspx, and query keys may have different casing.
  // Only accept known, read-only diagnostic operations. Never authorize by serial alone.
  const route = url.pathname.toLowerCase().replace(/\.aspx$/, "");
  const options = url.searchParams.get("options") ?? url.searchParams.get("Options");
  const table = url.searchParams.get("table") ?? url.searchParams.get("Table");
  if (method === "GET" && route === "/iclock/cdata" && options === "all")
    return { kind: "handshake", serial };
  if (method === "GET" && route === "/iclock/getrequest")
    return { kind: "poll", serial };
  if (method === "POST" && route === "/iclock/cdata" && table?.toUpperCase() === "OPTIONS")
    return { kind: "device_options", serial };
  if (method === "POST" && route === "/iclock/cdata" && table?.toUpperCase() === "ATTLOG")
    return { kind: "attendance", serial };
  return { kind: "reject", reason: "unsupported" };
}
