import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { adminMiddleware } from "../lib/auth";
import {
  isMandiriGmailDevConfigured,
  listMandiriQrisGmailMessages,
} from "../lib/gmailMandiriQrisDevSource";
import { ingestMandiriQrisGmailMessage } from "../lib/qrisEmailDevIngest";

const router = Router();

function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  return true;
}

router.get("/admin/qris-email/dev/status", adminMiddleware, async (req, res) => {
  if (!devOnly(req, res)) return;
  res.json({
    environment: process.env.NODE_ENV ?? "development",
    enabled: String(process.env.QRIS_GMAIL_DEV_INGEST_ENABLED ?? "").toLowerCase() === "true",
    configured: isMandiriGmailDevConfigured(),
    mailboxConfigured: Boolean(String(process.env.QRIS_GMAIL_MAILBOX_DEV ?? "").trim()),
    allowedSenderConfigured: Boolean(String(process.env.QRIS_GMAIL_ALLOWED_FROM ?? "").trim()),
    mode: "read_only_detection",
    autoConfirm: false,
  });
});

router.post("/admin/qris-email/dev/sync", adminMiddleware, async (req, res) => {
  if (!devOnly(req, res)) return;
  try {
    const mailbox = String(process.env.QRIS_GMAIL_MAILBOX_DEV ?? "").trim();
    const messages = await listMandiriQrisGmailMessages({ maxResults: Number(req.body?.maxResults) || 25 });
    const results = [];
    for (const message of messages) {
      results.push(await ingestMandiriQrisGmailMessage(message, mailbox));
    }
    res.json({
      scanned: messages.length,
      inserted: results.filter((result) => result.inserted).length,
      reconciled: results.filter((result) => result.reconciled).length,
      duplicateOrExisting: results.filter((result) => !result.inserted && !result.reconciled).length,
      autoConfirmed: 0,
      results,
    });
  } catch (err) {
    req.log.error({ err }, "DEV QRIS Gmail sync failed");
    res.status(503).json({
      error: err instanceof Error ? err.message : "DEV QRIS Gmail sync failed",
      autoConfirmed: 0,
    });
  }
});

router.get("/admin/qris-email/dev/transactions", adminMiddleware, async (req, res) => {
  if (!devOnly(req, res)) return;
  const result = await db.execute(sql`
    SELECT
      id, gmail_message_id, merchant_name, acquirer, provider_reference,
      transaction_at, amount, tip, total, parse_status, match_status,
      candidate_payment_ids, created_at
    FROM sport_center.qris_email_transactions_dev
    ORDER BY id DESC
    LIMIT 100
  `);
  res.json((result as any).rows ?? result);
});

export default router;
