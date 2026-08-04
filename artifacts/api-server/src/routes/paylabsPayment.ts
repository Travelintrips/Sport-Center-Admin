/**
 * Paylabs Payment routes
 *
 * POST /api/paylabs/create-payment   — create Paylabs order for a booking
 * POST /api/paylabs/webhook          — receive payment notification from Paylabs
 * GET  /api/paylabs/status/:tradeNo  — poll payment status
 * GET  /api/paylabs/config           — public config (sandbox mode, active methods)
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { db, bookingsTable, paymentsTable, bookingHistoryTable, paylabsSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getBaseUrl } from "../lib/appUrl";
import {
  loadPaylabsConfigFromDb,
  getPaylabsConfig,
  verifyPaylabsSignature,
  createQris,
  createVa,
  createEwallet,
  statusInquiry,
  resolvePaymentMethod,
  type ProductInfo,
} from "../lib/paylabs";
import { notifyPaymentConfirmed } from "../lib/notifications";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureTransactionsTable() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS sport_center.paylabs_transactions (
      id                SERIAL PRIMARY KEY,
      booking_id        INTEGER,
      order_number      TEXT NOT NULL,
      merchant_trade_no TEXT NOT NULL UNIQUE,
      paylabs_trade_no  TEXT,
      payment_method    TEXT NOT NULL,
      amount            NUMERIC(12,2) NOT NULL,
      status            TEXT NOT NULL DEFAULT 'PENDING',
      qr_code_url       TEXT,
      qr_content        TEXT,
      va_number         TEXT,
      pay_url           TEXT,
      raw_request       JSONB,
      raw_response      JSONB,
      raw_notification  JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
}

// ─── GET /api/paylabs/config — public config (for checkout page) ─────────────
// No auth required — just tells the frontend if Paylabs is configured + active methods

router.get("/paylabs/config", async (_req, res) => {
  try {
    const [row] = await db.select().from(paylabsSettingsTable).limit(1);
    const cfg = await loadPaylabsConfigFromDb();

    res.json({
      sandboxMode         : cfg.sandboxMode,
      configured          : Boolean(cfg.merchantId),
      paymentMethodsConfig: (row?.paymentMethodsConfig as unknown[] | null) ?? null,
      title               : row?.title ?? "Online Payment",
    });
  } catch (err) {
    logger.warn({ err }, "[paylabs] config endpoint error");
    // Graceful fallback
    const cfg = getPaylabsConfig();
    res.json({
      sandboxMode         : cfg.sandboxMode,
      configured          : Boolean(cfg.merchantId),
      paymentMethodsConfig: null,
      title               : "Online Payment",
    });
  }
});

// ─── POST /api/paylabs/create-payment ────────────────────────────────────────
// No auth required — booking status validation is the security guard

router.post("/paylabs/create-payment", async (req, res) => {
  const { bookingId, paymentMethod = "qris" } = req.body as {
    bookingId: number;
    paymentMethod?: string;
  };

  if (!bookingId) {
    res.status(400).json({ error: "bookingId is required" });
    return;
  }

  // Load booking
  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.id, Number(bookingId))).limit(1);

  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!["pending_payment", "waiting_confirmation"].includes(booking.status ?? "")) {
    res.status(409).json({ error: `Booking status "${booking.status}" tidak memerlukan pembayaran gateway` });
    return;
  }

  const cfg          = await loadPaylabsConfigFromDb();
  const amount       = Number(booking.grandTotal ?? booking.totalPrice);
  const tradeNo      = `SC-${booking.orderNumber}-${Date.now()}`.slice(0, 32);
  const requestId    = randomUUID();
  const notifyUrl    = `${await getBaseUrl()}/api/paylabs/webhook`;
  const productName  = `Booking ${booking.orderNumber}`;
  const productInfo: ProductInfo[] = [{
    id      : String(booking.facilityId),
    name    : productName,
    price   : amount,
    type    : "lapangan",
    quantity: 1,
  }];

  const method = resolvePaymentMethod(paymentMethod);
  if (method.type === "unknown") {
    res.status(400).json({ error: `Payment method "${paymentMethod}" tidak didukung` });
    return;
  }

  let paylabsRes: Awaited<ReturnType<typeof createQris>>;

  try {
    // payer = nama pembayar (v4.8.1 docs: "Nama orang yang melakukan pembayaran")
    const payer = (booking as any).bookerName ?? booking.customerName ?? "Pelanggan";

    if (method.type === "qris") {
      paylabsRes = await createQris({
        requestId, merchantTradeNo: tradeNo,
        amount, payer,
        notifyUrl, productName, productInfo,
      }, cfg);
    } else if (method.type === "va") {
      paylabsRes = await createVa({
        requestId, merchantTradeNo: tradeNo,
        paymentType: method.code!, amount, payer,
        notifyUrl, productName, productInfo,
      }, cfg);
    } else {
      paylabsRes = await createEwallet({
        requestId, merchantTradeNo: tradeNo,
        ewalletCode: method.code!, amount, payer,
        notifyUrl, productName, productInfo,
      }, cfg);
    }
  } catch (err) {
    logger.error({ err, bookingId }, "[paylabs] create-payment error");
    res.status(500).json({ error: "Gagal membuat order Paylabs" });
    return;
  }

  if (!paylabsRes.ok) {
    const displayMsg =
      paylabsRes.errMsg ??
      (paylabsRes.errCode ? `errCode: ${paylabsRes.errCode}` : null) ??
      `HTTP ${paylabsRes.httpStatus} — tidak ada detail error dari Paylabs`;
    logger.warn({ errCode: paylabsRes.errCode, errMsg: paylabsRes.errMsg, httpStatus: paylabsRes.httpStatus, raw: paylabsRes.data }, "[paylabs] create-payment failed");
    res.status(502).json({
      error  : displayMsg,
      errCode: paylabsRes.errCode,
      errMsg : paylabsRes.errMsg,
    });
    return;
  }

  // Extract gateway response fields — v4.8.1 field names:
  //   VA:   vaCode, platformTradeNo
  //   QRIS: qrCode, platformTradeNo
  //   Ewallet: payUrl, platformTradeNo
  const d              = paylabsRes.data as Record<string, unknown>;
  const paylabsTradeNo = String(d.platformTradeNo ?? d.paylabsTradeNo ?? d.tradeNo ?? "");
  const qrContent      = String(d.qrCode      ?? d.qrContent ?? d.qrCodeUrl ?? "");
  const qrCodeUrl      = qrContent ? "" : String(d.qrCodeUrl ?? d.qrUrl ?? "");
  const vaNumber       = String(d.vaCode      ?? d.vaNumber  ?? d.virtualAccountNo ?? "");
  const payUrl         = String(d.payUrl      ?? d.paymentUrl ?? "");

  // Persist to paylabs_transactions
  try {
    await ensureTransactionsTable();
    await db.execute(sql.raw(`
      INSERT INTO sport_center.paylabs_transactions
        (booking_id, order_number, merchant_trade_no, paylabs_trade_no,
         payment_method, amount, status,
         qr_code_url, qr_content, va_number, pay_url,
         raw_request, raw_response)
      VALUES (
        ${booking.id},
        '${booking.orderNumber}',
        '${tradeNo}',
        '${paylabsTradeNo}',
        '${paymentMethod}',
        ${amount},
        'PENDING',
        '${qrCodeUrl}',
        '${qrContent}',
        '${vaNumber}',
        '${payUrl}',
        '${JSON.stringify({ requestId, amount, paymentMethod }).replace(/'/g, "''")}',
        '${JSON.stringify(d).replace(/'/g, "''")}'
      )
      ON CONFLICT (merchant_trade_no) DO UPDATE SET
        paylabs_trade_no = EXCLUDED.paylabs_trade_no,
        raw_response     = EXCLUDED.raw_response,
        updated_at       = NOW()
    `));
  } catch (dbErr) {
    logger.warn({ dbErr }, "[paylabs] failed to persist transaction (non-fatal)");
  }

  res.json({
    ok            : true,
    merchantTradeNo: tradeNo,
    paylabsTradeNo,
    paymentMethod,
    amount,
    qrCodeUrl,
    qrContent,
    vaNumber,
    payUrl,
    sandboxMode   : cfg.sandboxMode,
    raw           : cfg.debugMode ? d : undefined,
  });
});

// ─── POST /api/paylabs/webhook ────────────────────────────────────────────────

router.post("/paylabs/webhook", async (req, res) => {
  const timestamp = String(req.headers["x-timestamp"] ?? "");
  const signature = String(req.headers["x-signature"] ?? "");
  const rawBody   = JSON.stringify(req.body);

  const cfg = await loadPaylabsConfigFromDb();

  // Verify signature if public key is configured
  if (cfg.paylabsPublicKey) {
    const valid = verifyPaylabsSignature(cfg.paylabsPublicKey, timestamp, rawBody, signature);
    if (!valid) {
      logger.warn({ timestamp, signature }, "[paylabs] webhook signature invalid");
      res.status(200).json({ errCode: "SIGNATURE_INVALID" });
      return;
    }
  }

  const body = req.body as Record<string, unknown>;
  logger.info({ body }, "[paylabs] webhook received");

  const merchantTradeNo = String(body.merchantTradeNo ?? "");
  const status          = String(body.status ?? body.tradeState ?? "");
  const paylabsTradeNo  = String(body.paylabsTradeNo ?? body.tradeNo ?? "");

  // status "02" or "SUCCESS" = paid
  const isPaid = status === "02" || status === "SUCCESS" || status === "PAID";

  // Update paylabs_transactions
  try {
    await ensureTransactionsTable();
    await db.execute(sql.raw(`
      UPDATE sport_center.paylabs_transactions
      SET status           = '${isPaid ? "SUCCESS" : status}',
          paylabs_trade_no = '${paylabsTradeNo}',
          raw_notification = '${JSON.stringify(body).replace(/'/g, "''")}',
          updated_at       = NOW()
      WHERE merchant_trade_no = '${merchantTradeNo}'
    `));
  } catch (err) {
    logger.warn({ err }, "[paylabs] webhook DB update non-fatal");
  }

  if (!isPaid) {
    res.status(200).json({ errCode: "0", errMsg: "received" });
    return;
  }

  // Find booking by orderNumber extracted from merchantTradeNo (format: SC-{orderNumber}-{ts})
  const orderNumberMatch = merchantTradeNo.match(/^SC-(.+)-\d+$/);
  const orderNumber = orderNumberMatch ? orderNumberMatch[1] : null;

  if (!orderNumber) {
    logger.warn({ merchantTradeNo }, "[paylabs] cannot extract orderNumber from merchantTradeNo");
    res.status(200).json({ errCode: "0" });
    return;
  }

  try {
    const [booking] = await db.select().from(bookingsTable)
      .where(eq(bookingsTable.orderNumber, orderNumber)).limit(1);

    if (!booking) {
      logger.warn({ orderNumber }, "[paylabs] booking not found for webhook");
      res.status(200).json({ errCode: "0" });
      return;
    }

    if (booking.status === "confirmed") {
      res.status(200).json({ errCode: "0", errMsg: "already confirmed" });
      return;
    }

    // Auto-confirm booking
    await db.update(bookingsTable)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(eq(bookingsTable.id, booking.id));

    // Insert payment record
    const amountPaid = Number(body.amount ?? booking.grandTotal ?? booking.totalPrice);
    await db.insert(paymentsTable).values({
      bookingId  : booking.id,
      amount     : String(amountPaid),
      proofUrl   : `paylabs:${paylabsTradeNo}`,
      notes      : `Auto-confirmed via Paylabs webhook (${merchantTradeNo})`,
      status     : "confirmed",
      paymentType: "full_payment",
    } as Parameters<typeof paymentsTable._.inferInsert>[0] as any).onConflictDoNothing();

    // Booking history
    await db.insert(bookingHistoryTable).values({
      bookingId : booking.id,
      action    : "confirmed",
      notes     : `Paylabs payment confirmed (tradeNo: ${paylabsTradeNo})`,
      changedBy : "paylabs-webhook",
    } as any).catch(() => {});

    // WhatsApp notification
    notifyPaymentConfirmed(booking.id).catch(() => {});

    logger.info({ bookingId: booking.id, orderNumber, paylabsTradeNo }, "[paylabs] booking confirmed");
  } catch (err) {
    logger.error({ err, orderNumber }, "[paylabs] webhook booking-confirm error");
  }

  res.status(200).json({ errCode: "0", errMsg: "ok" });
});

// ─── GET /api/paylabs/status/:tradeNo ────────────────────────────────────────

router.get("/paylabs/status/:tradeNo", async (req, res) => {
  const { tradeNo } = req.params;
  try {
    await ensureTransactionsTable();
    const rows = await db.execute(sql.raw(
      `SELECT * FROM sport_center.paylabs_transactions WHERE merchant_trade_no = '${tradeNo}' LIMIT 1`
    ));
    const local = (rows as any).rows?.[0] ?? (rows as any)[0];

    const paylabsRes = await statusInquiry(tradeNo);

    res.json({
      local      : local ?? null,
      paylabs    : paylabsRes.data,
      paylabsOk  : paylabsRes.ok,
    });
  } catch (err) {
    logger.error({ err }, "[paylabs] status inquiry error");
    res.status(500).json({ error: "Status inquiry failed" });
  }
});

export default router;
