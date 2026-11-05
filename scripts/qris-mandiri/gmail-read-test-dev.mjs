const clientId = String(process.env.QRIS_GMAIL_CLIENT_ID_DEV ?? "").trim();
const clientSecret = String(process.env.QRIS_GMAIL_CLIENT_SECRET_DEV ?? "").trim();
const refreshToken = String(process.env.QRIS_GMAIL_REFRESH_TOKEN_DEV ?? "").trim();
const mailbox = String(process.env.QRIS_GMAIL_MAILBOX_DEV ?? "").trim();
const allowedFrom = String(process.env.QRIS_GMAIL_ALLOWED_FROM ?? "").trim().toLowerCase();

for (const [name, value] of [
  ["QRIS_GMAIL_CLIENT_ID_DEV", clientId],
  ["QRIS_GMAIL_CLIENT_SECRET_DEV", clientSecret],
  ["QRIS_GMAIL_REFRESH_TOKEN_DEV", refreshToken],
  ["QRIS_GMAIL_MAILBOX_DEV", mailbox],
  ["QRIS_GMAIL_ALLOWED_FROM", allowedFrom],
]) {
  if (!value) {
    console.error(`ERROR: ${name} belum diisi.`);
    process.exit(1);
  }
}

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error(`OAuth refresh gagal: HTTP ${r.status} ${JSON.stringify(j)}`);
  }
  return j.access_token;
}

function header(payload, name) {
  return payload?.headers?.find((h) => String(h?.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractAddress(value) {
  const m = String(value).match(/<([^<>]+)>/);
  return (m?.[1] ?? value).trim().toLowerCase();
}

const accessToken = await token();

const query = encodeURIComponent(`from:${allowedFrom} newer_than:30d`);
const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${query}`;
const listResponse = await fetch(listUrl, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const list = await listResponse.json();

if (!listResponse.ok) {
  throw new Error(`Gmail list gagal: HTTP ${listResponse.status} ${JSON.stringify(list)}`);
}

const ids = Array.isArray(list.messages) ? list.messages.map((m) => m.id).filter(Boolean) : [];

console.log("");
console.log("======================================================");
console.log("GMAIL QRIS DEV - READ ONLY TEST");
console.log("======================================================");
console.log("");
console.log("Mailbox configured :", mailbox);
console.log("Allowed sender     :", allowedFrom);
console.log("Messages found     :", ids.length);
console.log("");

for (const id of ids) {
  const metaUrl =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
  const r = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const message = await r.json();
  if (!r.ok) {
    console.log("- metadata read failed for one message");
    continue;
  }

  const from = header(message.payload, "From");
  const subject = header(message.payload, "Subject");
  const date = header(message.payload, "Date");
  const senderMatches = extractAddress(from) === allowedFrom;

  console.log("- Subject       :", subject || "(no subject)");
  console.log("  From          :", from || "(no from)");
  console.log("  Sender match  :", senderMatches ? "YES" : "NO");
  console.log("  Date          :", date || "(no date)");
  console.log("");
}

console.log("PASS jika:");
console.log("1. OAuth refresh berhasil.");
console.log("2. Ada email Yokke yang ditemukan.");
console.log("3. Sender match = YES.");
console.log("");
console.log("Script ini hanya memakai Gmail GET/read-only.");
