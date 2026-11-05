type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  headers?: GmailHeader[];
  parts?: GmailPart[];
};
type GmailMessage = { id?: string; internalDate?: string; payload?: GmailPart };

export type MandiriGmailMessage = {
  id: string;
  from: string;
  subject: string;
  internalDate: string | null;
  bodyText: string;
};

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

export function isMandiriGmailDevConfigured(): boolean {
  return Boolean(
    env("QRIS_GMAIL_CLIENT_ID_DEV") &&
    env("QRIS_GMAIL_CLIENT_SECRET_DEV") &&
    env("QRIS_GMAIL_REFRESH_TOKEN_DEV") &&
    env("QRIS_GMAIL_ALLOWED_FROM") &&
    env("QRIS_GMAIL_MAILBOX_DEV")
  );
}

export function assertMandiriGmailDevAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("QRIS Gmail DEV ingestion is disabled in production");
  }
  if (env("QRIS_GMAIL_DEV_INGEST_ENABLED").toLowerCase() !== "true") {
    throw new Error("QRIS Gmail DEV ingestion is disabled");
  }
  if (!isMandiriGmailDevConfigured()) {
    throw new Error("QRIS Gmail DEV credentials/sender/mailbox are incomplete");
  }
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function header(payload: GmailPart | undefined, name: string): string {
  return payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectTextParts(part: GmailPart | undefined, plain: string[], html: string[]): void {
  if (!part) return;
  const data = part.body?.data;
  if (data && part.mimeType === "text/plain") plain.push(decodeBase64Url(data));
  if (data && part.mimeType === "text/html") html.push(htmlToText(decodeBase64Url(data)));
  for (const child of part.parts ?? []) collectTextParts(child, plain, html);
}

export function extractGmailBodyText(message: GmailMessage): string {
  const plain: string[] = [];
  const html: string[] = [];
  collectTextParts(message.payload, plain, html);
  const direct = message.payload?.body?.data ? decodeBase64Url(message.payload.body.data) : "";
  const selected = plain.join("\n").trim() || html.join("\n").trim() || direct.trim();
  return selected.replace(/\r/g, "").trim();
}

function extractAddress(value: string): string {
  const angle = value.match(/<([^<>]+)>/);
  return (angle?.[1] ?? value).trim().toLowerCase();
}

async function accessToken(fetchImpl: typeof fetch): Promise<string> {
  const params = new URLSearchParams({
    client_id: env("QRIS_GMAIL_CLIENT_ID_DEV"),
    client_secret: env("QRIS_GMAIL_CLIENT_SECRET_DEV"),
    refresh_token: env("QRIS_GMAIL_REFRESH_TOKEN_DEV"),
    grant_type: "refresh_token",
  });
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!response.ok) throw new Error(`Gmail OAuth refresh failed: HTTP ${response.status}`);
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Gmail OAuth refresh returned no access token");
  return payload.access_token;
}

async function gmailJson<T>(fetchImpl: typeof fetch, token: string, url: string): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Gmail API failed: HTTP ${response.status}`);
  return await response.json() as T;
}

export async function listMandiriQrisGmailMessages(
  options: { maxResults?: number; fetchImpl?: typeof fetch } = {},
): Promise<MandiriGmailMessage[]> {
  assertMandiriGmailDevAllowed();
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = await accessToken(fetchImpl);
  const allowedFrom = env("QRIS_GMAIL_ALLOWED_FROM").toLowerCase();
  const maxResults = Math.max(1, Math.min(50, options.maxResults ?? 25));
  const query = encodeURIComponent(`from:${allowedFrom} newer_than:14d "BERHASIL"`);
  const list = await gmailJson<{ messages?: Array<{ id?: string }> }>(
    fetchImpl,
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${query}`,
  );
  const results: MandiriGmailMessage[] = [];
  for (const item of list.messages ?? []) {
    if (!item.id) continue;
    const message = await gmailJson<GmailMessage>(
      fetchImpl,
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`,
    );
    const from = header(message.payload, "From");
    if (extractAddress(from) !== allowedFrom) continue;
    const bodyText = extractGmailBodyText(message);
    if (!/(?:TRASAKSI|TRANSAKSI)\s+BERHASIL/i.test(bodyText)) continue;
    results.push({
      id: item.id,
      from,
      subject: header(message.payload, "Subject"),
      internalDate: message.internalDate ?? null,
      bodyText,
    });
  }
  return results;
}
