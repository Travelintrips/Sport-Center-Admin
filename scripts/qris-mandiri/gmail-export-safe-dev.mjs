import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const clientId = String(process.env.QRIS_GMAIL_CLIENT_ID_DEV ?? "").trim();
const clientSecret = String(process.env.QRIS_GMAIL_CLIENT_SECRET_DEV ?? "").trim();
const refreshToken = String(process.env.QRIS_GMAIL_REFRESH_TOKEN_DEV ?? "").trim();
const mailbox = String(process.env.QRIS_GMAIL_MAILBOX_DEV ?? "").trim();
const allowedFrom = String(process.env.QRIS_GMAIL_ALLOWED_FROM ?? "").trim().toLowerCase();
const outputPath = new URL("./qris-gmail-dev-export.json", import.meta.url);

for (const [name, value] of [
  ["QRIS_GMAIL_CLIENT_ID_DEV", clientId],
  ["QRIS_GMAIL_CLIENT_SECRET_DEV", clientSecret],
  ["QRIS_GMAIL_REFRESH_TOKEN_DEV", refreshToken],
  ["QRIS_GMAIL_MAILBOX_DEV", mailbox],
  ["QRIS_GMAIL_ALLOWED_FROM", allowedFrom],
]) {
  if (!value) {
    console.error(`ERROR: ${name} belum diisi pada PowerShell ini.`);
    process.exit(1);
  }
}

async function getAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`OAuth refresh gagal: HTTP ${response.status}`);
  }
  return data.access_token;
}

function decode(data) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .trim();
}

function collect(part, plain, html) {
  if (!part) return;
  if (part.body?.data && part.mimeType === "text/plain") plain.push(decode(part.body.data));
  if (part.body?.data && part.mimeType === "text/html") html.push(htmlToText(decode(part.body.data)));
  for (const child of part.parts ?? []) collect(child, plain, html);
}

function bodyText(message) {
  const plain = [], html = [];
  collect(message.payload, plain, html);
  return (plain.join("\n").trim() || html.join("\n").trim()).replace(/\r/g, "").trim();
}

function header(payload, name) {
  return payload?.headers?.find((h) => String(h.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractAddress(value) {
  const match = String(value).match(/<([^<>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function field(body, label) {
  const escaped = label.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp("^\\s*" + escaped + "\\s*:\\s*(.*?)\\s*$", "im"))?.[1]?.trim() ?? null;
}

const token = await getAccessToken();
const q = encodeURIComponent(`from:${allowedFrom} newer_than:30d subject:"Status Transaksi BERHASIL"`);
const listResponse = await fetch(
  `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${q}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const list = await listResponse.json();
if (!listResponse.ok) throw new Error(`Gmail list gagal: HTTP ${listResponse.status}`);

const rows = [];
for (const item of list.messages ?? []) {
  if (!item.id) continue;
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const message = await response.json();
  if (!response.ok) continue;

  const from = header(message.payload, "From");
  const subject = header(message.payload, "Subject");
  if (subject !== "Status Transaksi BERHASIL" || extractAddress(from) !== allowedFrom) continue;

  const body = bodyText(message);
  const row = {
    gmailMessageId: item.id,
    sourceMailbox: mailbox,
    from: allowedFrom,
    subject,
    merchant: field(body, "Nama Toko"),
    acquirer: field(body, "Nama Acquirer"),
    reference: field(body, "Nomor Referensi"),
    transactionDate: field(body, "Tanggal Transaksi"),
    transactionTime: field(body, "Waktu Transaksi"),
    payerBank: field(body, "Pembayaran dari"),
    payerName: field(body, "Nama Customer"),
    issuerRrn: field(body, "Issuer RRN"),
    amount: field(body, "Nominal Transaksi"),
    tip: field(body, "TIP"),
    total: field(body, "Total"),
    fingerprintSha256: createHash("sha256").update(item.id).update("\n").update(body).digest("hex"),
  };
  rows.push(row);
}

await writeFile(outputPath, JSON.stringify({ exportedAt: new Date().toISOString(), rows }, null, 2), "utf8");

console.log("");
console.log("QRIS Gmail DEV export berhasil.");
console.log("Jumlah transaksi :", rows.length);
console.log("Output            :", outputPath.pathname.replace(/^\//, ""));
console.log("Tidak ada Client Secret, refresh token, PAN, atau raw email di file export.");
