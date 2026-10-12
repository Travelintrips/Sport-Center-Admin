/**
 * Solution X904 Push Service 2.0.33S protocol screening.
 * Pure checks only: no acknowledgments, writes, or device commands.
 * Expected values must be confirmed from a live device handshake before activation.
 */
export type X904AdmsClassification =
  | { kind: "handshake" | "poll" | "attendance"; serial: string }
  | { kind: "reject"; reason: string };

export function classifyX904AdmsRequest(method: string, requestUrl: string): X904AdmsClassification {
  let url: URL;
  try { url = new URL(requestUrl, "https://localhost"); }
  catch { return { kind: "reject", reason: "invalid_url" }; }
  const serial = url.searchParams.get("SN") ?? "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(serial)) return { kind: "reject", reason: "serial_invalid" };
  if (method === "GET" && url.pathname === "/iclock/cdata" && url.searchParams.get("options") === "all")
    return { kind: "handshake", serial };
  if (method === "GET" && url.pathname === "/iclock/getrequest")
    return { kind: "poll", serial };
  if (method === "POST" && url.pathname === "/iclock/cdata" && url.searchParams.get("table") === "ATTLOG")
    return { kind: "attendance", serial };
  return { kind: "reject", reason: "unsupported" };
}
