import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

process.env.NODE_ENV = "production";
process.env.APP_ENV = "production";

const PROD_REF = "nzdweipzckfszczzqtuw";
const PORT = Number(process.env.QRIS_PROD_PORT || "3218");
const HOST = "127.0.0.1";

function e(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function json(res: any, code: number, body: any): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function base64url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64").toString("utf8");
}

function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .trim();
}

function collect(part: any, plain: string[], html: string[]): void {
  if (!part) return;
  if (part.body?.data && part.mimeType === "text/plain") plain.push(base64url(part.body.data));
  if (part.body?.data && part.mimeType === "text/html") html.push(htmlToText(base64url(part.body.data)));
  for (const child of part.parts ?? []) collect(child, plain, html);
}

function bodyText(message: any): string {
  const plain: string[] = [];
  const html: string[] = [];
  collect(message.payload, plain, html);
  const direct = message.payload?.body?.data ? base64url(message.payload.body.data) : "";
  return (plain.join("\n").trim() || html.join("\n").trim() || direct.trim()).replace(/\r/g, "").trim();
}

function header(payload: any, name: string): string {
  return payload?.headers?.find((item: any) => String(item.name ?? "").toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

function addr(value: string): string {
  const match = value.match(/<([^<>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

function field(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp("^\\s*" + escaped + "\\s*:\\s*(.*?)\\s*$", "im"))?.[1]?.trim() ?? null;
}

function money(value: string | null): number | null {
  if (!value || !/^\d{1,3}(?:,\d{3})*(?:\.\d{2})?$|^\d+(?:\.\d{2})?$/.test(value)) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null;
}

async function oauthToken(): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: e("QRIS_GMAIL_CLIENT_ID_PROD"),
      client_secret: e("QRIS_GMAIL_CLIENT_SECRET_PROD"),
      refresh_token: e("QRIS_GMAIL_REFRESH_TOKEN_PROD"),
      grant_type: "refresh_token",
    }),
  });
  const payload: any = await response.json();
  if (!response.ok || !payload.access_token) throw new Error("GMAIL_OAUTH_REFRESH_FAILED");
  return String(payload.access_token);
}

async function gmailJson(token: string, url: string): Promise<any> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`GMAIL_API_HTTP_${response.status}`);
  return await response.json();
}

let pool: pg.Pool;

// A single process owns polling. The runtime does not change booking/payment
// state, and credentials are required in the PROD-only environment file.
const pollEnabled = e("QRIS_GMAIL_PROD_POLL_ENABLED").toLowerCase() === "true";
const rawPollMinutes = Number(e("QRIS_GMAIL_PROD_POLL_MINUTES") || "5");
const pollMinutes = Number.isFinite(rawPollMinutes) &&
  Number.isInteger(rawPollMinutes) && rawPollMinutes >= 5 && rawPollMinutes <= 60
  ? rawPollMinutes : 5;
let syncInProgress = false;
let lastAttemptAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastFailureCode: string | null = null;
let lastSummary: { scanned: number; inserted: number; reconciled: number; invalid: number; autoConfirmed: 0 } | null = null;

async function runSyncSafely(): Promise<{ busy?: boolean; scanned?: number; inserted?: number; reconciled?: number; duplicateOrExisting?: number; invalid?: number; autoConfirmed: 0; decisions?: any[] }> {
  if (syncInProgress) return { busy: true, autoConfirmed: 0 };
  syncInProgress = true;
  lastAttemptAt = new Date().toISOString();
  try {
    const result = await sync();
    lastSuccessAt = new Date().toISOString();
    lastFailureCode = null;
    lastSummary = {
      scanned: result.scanned,
      inserted: result.inserted,
      reconciled: result.reconciled,
      invalid: result.invalid,
      autoConfirmed: 0,
    };
    return result;
  } catch (err) {
    // Sanitized errors only; OAuth tokens, message bodies and DB URLs never
    // appear in status or are logged.
    const raw = err instanceof Error ? err.message : "";
    lastFailureCode = /^GMAIL_API_HTTP_\d+$/.test(raw) ? raw
      : raw === "GMAIL_OAUTH_REFRESH_FAILED" ? raw
      : raw.startsWith("PROD_DB_TARGET_MISMATCH") ? "PROD_DB_TARGET_MISMATCH"
      : "SYNC_FAILED";
    console.error("[qris-prod] detection sync failed:", lastFailureCode);
    throw new Error(lastFailureCode);
  } finally {
    syncInProgress = false;
  }
}

async function sync(): Promise<any> {
  const token = await oauthToken();
  const allowed = e("QRIS_GMAIL_ALLOWED_FROM").toLowerCase();
  const mailbox = e("QRIS_GMAIL_MAILBOX_PROD");
  const query = encodeURIComponent(`from:${allowed} newer_than:14d "BERHASIL"`);
  const list = await gmailJson(
    token,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${query}`,
  );

  let scanned = 0;
  let inserted = 0;
  let reconciled = 0;
  let duplicateOrExisting = 0;
  let invalid = 0;
  const decisions: any[] = [];

  for (const item of list.messages ?? []) {
    if (!item.id) continue;
    const message = await gmailJson(
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`,
    );
    const from = header(message.payload, "From");
    if (addr(from) !== allowed) continue;

    const body = bodyText(message);
    if (!/(?:TRASAKSI|TRANSAKSI)\s+BERHASIL/i.test(body)) continue;
    scanned++;

    const merchant = field(body, "Nama Toko");
    const acquirer = field(body, "Nama Acquirer");
    const reference = field(body, "Nomor Referensi");
    const date = field(body, "Tanggal Transaksi");
    const time = field(body, "Waktu Transaksi");
    const issuerRrn = field(body, "Issuer RRN");
    const payerBank = field(body, "Pembayaran dari");
    const payerName = field(body, "Nama Customer");
    const amount = money(field(body, "Nominal Transaksi"));
    const tip = money(field(body, "TIP"));
    const total = money(field(body, "Total"));

    const validDate = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + "T00:00:00Z"));
    const validTime = !!time && /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time);
    const valid =
      !!merchant &&
      String(acquirer).toUpperCase() === "MANDIRI" &&
      !!reference &&
      /^[A-Za-z0-9-]{6,64}$/.test(reference) &&
      validDate &&
      validTime &&
      amount != null &&
      tip != null &&
      total != null &&
      Math.abs(amount + tip - total) < 0.005;

    if (!valid) {
      invalid++;
      decisions.push({ gmailMessageId: item.id, decision: "invalid" });
      continue;
    }

    const candidateResult = await pool.query(
      `select id,amount,provider_reference,merchant_trade_no,provider_trade_no,paid_at,created_at
       from sport_center.sport_payments
       where payment_method='QRIS'
         and payment_provider::text='mandiri_direct'
         and status::text not in ('confirmed','rejected')
         and (
           abs(amount::numeric-$1::numeric)<0.005
           or provider_reference=$2
           or merchant_trade_no=$2
           or provider_trade_no=$2
         )
       order by id desc
       limit 25`,
      [total, reference],
    );

    const normalizedReference = String(reference).trim().toUpperCase();
    const referenced = candidateResult.rows.filter((payment: any) =>
      [payment.provider_reference, payment.merchant_trade_no, payment.provider_trade_no]
        .some((value: any) => String(value ?? "").trim().toUpperCase() === normalizedReference),
    );
    const exact = referenced.filter((payment: any) => Math.abs(Number(payment.amount) - total) < 0.005);
    const transactionAt = new Date(`${date}T${time}+07:00`).getTime();
    const amountMatches = candidateResult.rows.filter((payment: any) => {
      if (Math.abs(Number(payment.amount) - total) >= 0.005) return false;
      const anchor = payment.paid_at ?? payment.created_at;
      const anchorMs = anchor ? new Date(anchor).getTime() : Number.NaN;
      if (!Number.isFinite(transactionAt) || !Number.isFinite(anchorMs)) return false;
      return Math.abs(transactionAt - anchorMs) <= 3 * 24 * 60 * 60 * 1000;
    });

    let status = "unmatched";
    let ids: number[] = [];
    if (exact.length === 1) {
      status = "reference_match_review";
      ids = [Number(exact[0].id)];
    } else if (referenced.length > 0) {
      status = "ambiguous";
      ids = referenced.map((payment: any) => Number(payment.id));
    } else if (amountMatches.length > 0) {
      status = "ambiguous";
      ids = amountMatches.map((payment: any) => Number(payment.id));
    }

    const fingerprint = crypto.createHash("sha256").update(item.id).update("\n").update(body).digest("hex");
    const insert = await pool.query(
      `insert into sport_center.qris_email_transactions
       (gmail_message_id,source_mailbox,merchant_name,acquirer,provider_reference,issuer_rrn,payer_bank,payer_name,
        transaction_at,amount,tip,total,parse_status,match_status,candidate_payment_ids,fingerprint_sha256)
       values ($1,$2,$3,$4,$5,$6,$7,$8,($9||' '||$10)::timestamp at time zone 'Asia/Jakarta',
               $11,$12,$13,'parsed',$14,$15,$16)
       on conflict do nothing
       returning id`,
      [item.id, mailbox, merchant, acquirer, reference, issuerRrn, payerBank, payerName, date, time, amount, tip, total, status, ids, fingerprint],
    );

    if (insert.rowCount === 1) {
      inserted++;
    } else {
      const update = await pool.query(
        `update sport_center.qris_email_transactions
         set match_status=$1, candidate_payment_ids=$2, updated_at=now()
         where gmail_message_id=$3
           and (match_status is distinct from $1 or candidate_payment_ids is distinct from $2::integer[])
         returning id`,
        [status, ids, item.id],
      );
      if (update.rowCount === 1) reconciled++;
      else duplicateOrExisting++;
    }

    decisions.push({ gmailMessageId: item.id, decision: status, candidatePaymentIds: ids });
  }

  return { scanned, inserted, reconciled, duplicateOrExisting, invalid, autoConfirmed: 0, decisions };
}

async function boot(): Promise<void> {
  const db = e("SUPABASE_DATABASE_URL_PROD");
  if (!db || !db.includes(PROD_REF)) throw new Error("PROD_DB_TARGET_MISMATCH");
  if (e("QRIS_GMAIL_PROD_DETECTION_ENABLED").toLowerCase() !== "true") throw new Error("DETECTION_DISABLED");

  for (const key of [
    "QRIS_GMAIL_CLIENT_ID_PROD",
    "QRIS_GMAIL_CLIENT_SECRET_PROD",
    "QRIS_GMAIL_REFRESH_TOKEN_PROD",
    "QRIS_GMAIL_ALLOWED_FROM",
    "QRIS_GMAIL_MAILBOX_PROD",
  ]) {
    if (!e(key)) throw new Error(`MISSING_${key}`);
  }

  pool = new pg.Pool({ connectionString: db, max: 2, ssl: { rejectUnauthorized: false } });
  // Fail closed if PROD is pointed at the regular Sport Center app user or
  // a privileged database owner. The runtime must use a dedicated LOGIN role
  // that INHERITs ONLY qris_gmail_prod_runtime. Its RLS permits reading
  // pending QRIS payment candidates and writing detection-only records.
  // Never print the database username, URL or secrets in startup logs.
  const scope = await pool.query(`
    select
      pg_has_role(current_user, 'qris_gmail_prod_runtime', 'USAGE') as dedicated_role_inherited,
      has_table_privilege(current_user, 'sport_center.sport_payments', 'SELECT') as can_read_payments,
      has_table_privilege(current_user, 'sport_center.sport_payments', 'INSERT') as can_insert_payments,
      has_table_privilege(current_user, 'sport_center.sport_payments', 'UPDATE') as can_update_payments,
      has_table_privilege(current_user, 'sport_center.sport_payments', 'DELETE') as can_delete_payments,
      has_table_privilege(current_user, 'sport_center.qris_email_transactions', 'SELECT') as can_read_detection,
      has_table_privilege(current_user, 'sport_center.qris_email_transactions', 'INSERT') as can_insert_detection,
      has_column_privilege(current_user, 'sport_center.qris_email_transactions', 'match_status', 'UPDATE') as can_update_detection_status,
      has_column_privilege(current_user, 'sport_center.qris_email_transactions', 'candidate_payment_ids', 'UPDATE') as can_update_detection_candidates
  `);
  const access = scope.rows[0] ?? {};
  const safeRole =
    access.dedicated_role_inherited === true &&
    access.can_read_payments === true &&
    access.can_insert_payments === false &&
    access.can_update_payments === false &&
    access.can_delete_payments === false &&
    access.can_read_detection === true &&
    access.can_insert_detection === true &&
    access.can_update_detection_status === true &&
    access.can_update_detection_candidates === true;
  if (!safeRole) throw new Error("QRIS_PROD_DB_ROLE_NOT_LEAST_PRIVILEGED");

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
      if (req.method === "GET" && url.pathname === "/status") {
        return json(res, 200, {
          environment: "production",
          service: "qris-gmail-prod-detection",
          dbTarget: PROD_REF,
          enabled: true,
          configured: true,
          mailboxConfigured: true,
          allowedSenderConfigured: true,
          mode: "read_only_detection",
          autoConfirm: false,
          pollEnabled,
          pollMinutes,
          syncInProgress,
          lastAttemptAt,
          lastSuccessAt,
          lastFailureCode,
          lastSummary,
        });
      }
      if (req.method === "POST" && url.pathname === "/sync") {
        const result = await runSyncSafely();
        return json(res, result.busy ? 409 : 200, result);
      }
      if (req.method === "GET" && url.pathname === "/transactions") {
        const result = await pool.query(
          "select id,gmail_message_id,merchant_name,acquirer,provider_reference,transaction_at,amount,tip,total,parse_status,match_status,candidate_payment_ids,created_at from sport_center.qris_email_transactions order by id desc limit 100",
        );
        return json(res, 200, result.rows);
      }
      return json(res, 404, { error: "not_found" });
    } catch (err: any) {
      console.error("[qris-prod]", err?.message || "error");
      return json(res, 503, { error: err?.message || "runtime_error", autoConfirmed: 0 });
    }
  });

  server.listen(PORT, HOST, () =>
    console.log(`[qris-prod] listening ${HOST}:${PORT}; DB=${PROD_REF}; autoConfirm=false; poll=${pollEnabled}`),
  );

  // Explicit opt-in only. This doesn't activate PROD without the separate
  // service configuration and OAuth read-only credentials.
  if (pollEnabled) {
    void runSyncSafely().catch(() => {});
    const poll = setInterval(() => {
      void runSyncSafely().catch(() => {});
    }, pollMinutes * 60 * 1000);
    poll.unref?.();
  }
}

boot().catch((error) => {
  console.error("[qris-prod] boot failed:", error.message);
  process.exit(1);
});
