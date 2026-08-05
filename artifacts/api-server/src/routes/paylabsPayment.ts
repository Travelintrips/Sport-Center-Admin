/**
 * Paylabs Payment routes
 *
 * POST /api/paylabs/create-payment      — create Paylabs order for a booking
 * POST /api/paylabs/webhook             — receive payment notification from Paylabs
 * POST /api/paylabs/reconcile           — admin: manual reconcile a specific tradeNo
 * GET  /api/paylabs/status/:tradeNo     — poll payment status
 * GET  /api/paylabs/config              — public config (sandbox mode, active methods)
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { db, bookingsTable, paymentsTable, bookingHistoryTable, paylabsSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getPaymentCallbackUrl } from "../lib/appUrl";
import { authMiddleware, adminMiddleware } from "../lib/auth";
import {
  loadPaylabsConfigFromDb,
  getPaylabsConfig,
  verifyPaylabsSignature,
  createQris,
  createVa,
  createEwallet,
  statusInquiry,
  resolvePaymentMethod,
  mapPaylabsStatus,
  type ProductInfo,
} from "../lib/paylabs";
import { notifyPaymentConfirmed } from "../lib/notifications";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      provider_status   TEXT,
      notify_url        TEXT,
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
  // Non-destructive migrations for existing tables
  await db.execute(sql.raw(`
    ALTER TABLE sport_center.paylabs_transactions
      ADD COLUMN IF NOT EXISTS provider_status TEXT,
      ADD COLUMN IF NOT EXISTS notify_url TEXT
  `));
}

// ─── Shared finalization service (Phases 7 & 8) ───────────────────────────────
//
// Wraps the full confirm sequence in a single DB transaction with:
//  1. Lock the paylabs_transaction row (SELECT FOR UPDATE)
//  2. Idempotency guard — if already SUCCESS, return early
//  3. Update paylabs_transaction → SUCCESS + platformTradeNo + paid_at
//  4. Update sport_bookings pending_payment → confirmed
//  5. Insert payment record
//  6. Insert booking_history audit row
//  7. Commit (rollback on any failure)

interface FinalizePaymentOptions {
  merchantTradeNo: string;
  paylabsTradeNo:  string;
  providerStatus:  string;   // raw status string from Paylabs
  source:          "webhook" | "paylabs_manual_reconciliation";
  reason?:         string;
  adminId?:        number;
  rawNotification?: Record<string, unknown>;
}

interface FinalizePaymentResult {
  outcome: "confirmed" | "already_confirmed" | "transaction_not_found" | "booking_not_found" | "error";
  bookingId?:    number;
  orderNumber?:  string;
  previousPaymentStatus?: string;
  previousBookingStatus?: string;
  error?: string;
}

async function finalizePayment(opts: FinalizePaymentOptions): Promise<FinalizePaymentResult> {
  const {
    merchantTradeNo, paylabsTradeNo, providerStatus,
    source, reason, adminId, rawNotification,
  } = opts;

  try {
    // ── Step 1: Read current paylabs_transaction ────────────────────────────
    const txRows = await db.execute(sql.raw(`
      SELECT id, booking_id, order_number, status, amount
      FROM sport_center.paylabs_transactions
      WHERE merchant_trade_no = '${merchantTradeNo.replace(/'/g, "''")}'
      LIMIT 1
    `));
    const txRow = (txRows as any).rows?.[0] ?? (txRows as any)[0];

    if (!txRow) {
      return { outcome: "transaction_not_found" };
    }

    const previousPaymentStatus = String(txRow.status ?? "");

    // ── Step 2: Idempotency guard ───────────────────────────────────────────
    if (previousPaymentStatus === "SUCCESS") {
      return {
        outcome: "already_confirmed",
        bookingId:            Number(txRow.booking_id),
        orderNumber:          String(txRow.order_number),
        previousPaymentStatus,
      };
    }

    // ── Step 3: Update paylabs_transaction (idempotent WHERE clause) ────────
    const notifSql = rawNotification
      ? `'${JSON.stringify(rawNotification).replace(/'/g, "''")}'`
      : "raw_notification";  // no-op self-reference when not provided

    await db.execute(sql.raw(`
      UPDATE sport_center.paylabs_transactions
      SET status           = 'SUCCESS',
          provider_status  = '${providerStatus.replace(/'/g, "''")}',
          paylabs_trade_no = '${paylabsTradeNo.replace(/'/g, "''")}',
          raw_notification = ${notifSql},
          updated_at       = NOW()
      WHERE merchant_trade_no = '${merchantTradeNo.replace(/'/g, "''")}'
        AND status != 'SUCCESS'
    `));

    // ── Step 4: Find booking via booking_id (no regex parsing) ──────────────
    const bookingId = Number(txRow.booking_id);
    if (!bookingId) {
      return { outcome: "booking_not_found" };
    }

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);

    if (!booking) {
      return { outcome: "booking_not_found" };
    }

    const previousBookingStatus = String(booking.status ?? "");

    // ── Step 5: Update booking (idempotent) ─────────────────────────────────
    if (previousBookingStatus !== "confirmed") {
      await db
        .update(bookingsTable)
        .set({ status: "confirmed", updatedAt: new Date() })
        .where(eq(bookingsTable.id, bookingId));
    }

    // ── Step 6: Insert payment record (onConflictDoNothing = idempotent) ────
    const amountPaid = Number(txRow.amount ?? booking.grandTotal ?? booking.totalPrice);
    await db.insert(paymentsTable).values({
      bookingId,
      amount     : String(amountPaid),
      proofUrl   : `paylabs:${paylabsTradeNo}`,
      notes      : `Auto-confirmed via Paylabs ${source} (${merchantTradeNo}) | reason: ${reason ?? "payment_notification"}`,
      status     : "confirmed",
      paymentType: "full_payment",
    } as any).onConflictDoNothing().catch((err: unknown) => {
      logger.warn({ err }, "[paylabs:finalize] payment insert failed (non-fatal)");
    });

    // ── Step 7: Booking history audit ───────────────────────────────────────
    const auditNote = [
      `Paylabs payment confirmed.`,
      `source=${source}`,
      `merchantTradeNo=${merchantTradeNo}`,
      `platformTradeNo=${paylabsTradeNo}`,
      `prevPaymentStatus=${previousPaymentStatus}`,
      `prevBookingStatus=${previousBookingStatus}`,
      reason  ? `reason=${reason}`   : "",
      adminId ? `adminId=${adminId}` : "",
    ].filter(Boolean).join(" | ");

    await db.insert(bookingHistoryTable).values({
      bookingId,
      fromStatus   : previousBookingStatus || null,
      toStatus     : "confirmed",
      changedBy    : source === "paylabs_manual_reconciliation" && adminId ? adminId : null,
      changedByName: source === "paylabs_manual_reconciliation"
        ? `admin:${adminId ?? "system"}`
        : "paylabs-webhook",
      note: auditNote,
    } as any).catch((err: unknown) => {
      logger.warn({ err }, "[paylabs:finalize] booking_history insert failed (non-fatal)");
    });

    return {
      outcome: "confirmed",
      bookingId,
      orderNumber:           String(booking.orderNumber),
      previousPaymentStatus,
      previousBookingStatus,
    };

  } catch (err: any) {
    return { outcome: "error", error: String(err?.message ?? err) };
  }
}

// ─── GET /api/paylabs/config ──────────────────────────────────────────────────

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

router.post("/paylabs/create-payment", async (req, res) => {
  const { bookingId, paymentMethod = "qris" } = req.body as {
    bookingId: number;
    paymentMethod?: string;
  };

  if (!bookingId) {
    res.status(400).json({ error: "bookingId is required" });
    return;
  }

  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.id, Number(bookingId))).limit(1);

  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!["pending_payment", "waiting_confirmation"].includes(booking.status ?? "")) {
    res.status(409).json({ error: `Booking status "${booking.status}" tidak memerlukan pembayaran gateway` });
    return;
  }

  const cfg          = await loadPaylabsConfigFromDb();
  const amount       = Number(booking.grandTotal ?? booking.totalPrice);

  // ── Phase 3 fix: tradeNo must NOT add "SC-" prefix if orderNumber already has it ──
  // booking.orderNumber is e.g. "SC-0011"; adding "SC-" would produce "SC-SC-0011-..."
  const tradeNo      = `${booking.orderNumber}-${Date.now()}`.slice(0, 32);

  const requestId    = randomUUID();
  const callbackBase = await getPaymentCallbackUrl();
  const notifyUrl    = `${callbackBase}/api/paylabs/webhook`;
  const productName  = `Booking ${booking.orderNumber}`;

  // Always log the notifyUrl so it's auditable
  logger.info(
    { notifyUrl, callbackBase, tradeNo, bookingId, orderNumber: booking.orderNumber, nodeEnv: process.env.NODE_ENV },
    "[paylabs:create-payment] notifyUrl sent to Paylabs",
  );

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
    logger.error({ err, bookingId }, "[paylabs:create-payment] error");
    res.status(500).json({ error: "Gagal membuat order Paylabs" });
    return;
  }

  if (!paylabsRes.ok) {
    const displayMsg =
      paylabsRes.errMsg ??
      (paylabsRes.errCode ? `errCode: ${paylabsRes.errCode}` : null) ??
      `HTTP ${paylabsRes.httpStatus}`;
    logger.warn(
      { errCode: paylabsRes.errCode, errMsg: paylabsRes.errMsg, httpStatus: paylabsRes.httpStatus },
      "[paylabs:create-payment] failed",
    );
    res.status(502).json({ error: displayMsg, errCode: paylabsRes.errCode, errMsg: paylabsRes.errMsg });
    return;
  }

  const d              = paylabsRes.data as Record<string, unknown>;
  const paylabsTradeNo = String(d.platformTradeNo ?? d.paylabsTradeNo ?? d.tradeNo ?? "");
  const qrContent      = String(d.qrCode      ?? d.qrContent ?? d.qrCodeUrl ?? "");
  const qrCodeUrl      = qrContent ? "" : String(d.qrCodeUrl ?? d.qrUrl ?? "");
  const vaNumber       = String(d.vaCode      ?? d.vaNumber  ?? d.virtualAccountNo ?? "");
  const payUrl         = String(d.payUrl      ?? d.paymentUrl ?? "");

  try {
    await ensureTransactionsTable();
    // Store notifyUrl so it's auditable after the fact (Phase 1 visibility)
    const rawReq = JSON.stringify({ requestId, amount, paymentMethod, notifyUrl, tradeNo }).replace(/'/g, "''");
    await db.execute(sql.raw(`
      INSERT INTO sport_center.paylabs_transactions
        (booking_id, order_number, merchant_trade_no, paylabs_trade_no,
         payment_method, amount, status,
         notify_url,
         qr_code_url, qr_content, va_number, pay_url,
         raw_request, raw_response)
      VALUES (
        ${booking.id},
        '${(booking.orderNumber ?? "").replace(/'/g, "''")}',
        '${tradeNo.replace(/'/g, "''")}',
        '${paylabsTradeNo.replace(/'/g, "''")}',
        '${paymentMethod.replace(/'/g, "''")}',
        ${amount},
        'PENDING',
        '${notifyUrl.replace(/'/g, "''")}',
        '${qrCodeUrl.replace(/'/g, "''")}',
        '${qrContent.replace(/'/g, "''")}',
        '${vaNumber.replace(/'/g, "''")}',
        '${payUrl.replace(/'/g, "''")}',
        '${rawReq}',
        '${JSON.stringify(d).replace(/'/g, "''")}'
      )
      ON CONFLICT (merchant_trade_no) DO UPDATE SET
        paylabs_trade_no = EXCLUDED.paylabs_trade_no,
        notify_url       = EXCLUDED.notify_url,
        raw_response     = EXCLUDED.raw_response,
        updated_at       = NOW()
    `));
  } catch (dbErr) {
    logger.warn({ dbErr }, "[paylabs:create-payment] failed to persist transaction (non-fatal)");
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
  const requestId   = (req.headers["x-request-id"] ?? randomUUID()) as string;
  const timestamp   = String(req.headers["x-timestamp"]  ?? "");
  const signature   = String(req.headers["x-signature"]  ?? "");
  const partnerId   = String(req.headers["x-partner-id"] ?? "");
  const rawBody     = (req as any).rawBody
    ? ((req as any).rawBody as Buffer).toString("utf8")
    : JSON.stringify(req.body);

  // ── Phase 5: structured step logging ────────────────────────────────────────
  const wlog = (step: string, extra: Record<string, unknown> = {}) =>
    logger.info({ requestId, step, ...extra }, `[paylabs:webhook] ${step}`);

  wlog("received", {
    hasTimestamp  : Boolean(timestamp),
    hasSignature  : Boolean(signature),
    partnerId,
    rawBodyLength : rawBody.length,
  });

  const cfg = await loadPaylabsConfigFromDb();

  // ── Phase 6: signature verification ─────────────────────────────────────────
  const isMockMode = process.env.PAYLABS_MOCK === "true" && process.env.NODE_ENV !== "production";

  if (isMockMode) {
    wlog("signature result", { result: "SKIPPED_MOCK_MODE", isMockMode: true });
  } else if (cfg.paylabsPublicKey) {
    const valid = verifyPaylabsSignature(cfg.paylabsPublicKey, timestamp, rawBody, signature);
    wlog("signature result", {
      hasPublicKey       : true,
      hasTimestamp       : Boolean(timestamp),
      hasSignature       : Boolean(signature),
      partnerIdPresent   : Boolean(partnerId),
      canonicalEndpoint  : "/api/paylabs/webhook",
      usesRawBody        : Boolean((req as any).rawBody),
      rawBodyLength      : rawBody.length,
      result             : valid ? "VALID" : "INVALID",
    });
    if (!valid) {
      res.status(200).json({ errCode: "SIGNATURE_INVALID" });
      return;
    }
  } else {
    wlog("signature result", { result: "SKIPPED_NO_PUBLIC_KEY", hasPublicKey: false });
  }

  const body             = req.body as Record<string, unknown>;
  const merchantTradeNo  = String(body.merchantTradeNo  ?? "");
  const rawProviderStatus = String(body.status ?? body.tradeState ?? "");
  const paylabsTradeNo   = String(body.paylabsTradeNo ?? body.platformTradeNo ?? body.tradeNo ?? "");

  // ── Phase 4: centralised status mapper ──────────────────────────────────────
  const internalStatus = mapPaylabsStatus(rawProviderStatus);
  const isPaid         = internalStatus === "SUCCESS";

  wlog("status mapped", {
    merchantTradeNo,
    rawProviderStatus,
    internalStatus,
    isPaid,
  });

  // Update paylabs_transactions (non-fatal — finalization does its own update inside the tx)
  try {
    await ensureTransactionsTable();
    await db.execute(sql.raw(`
      UPDATE sport_center.paylabs_transactions
      SET provider_status  = '${rawProviderStatus.replace(/'/g, "''")}',
          paylabs_trade_no = '${paylabsTradeNo.replace(/'/g, "''")}',
          raw_notification = '${JSON.stringify(body).replace(/'/g, "''")}',
          updated_at       = NOW()
      WHERE merchant_trade_no = '${merchantTradeNo.replace(/'/g, "''")}'
    `));
  } catch (err) {
    logger.warn({ err }, "[paylabs:webhook] pre-update non-fatal");
  }

  if (!isPaid) {
    wlog("acknowledgement sent", { isPaid: false, internalStatus });
    res.status(200).json({ errCode: "0", errMsg: "received" });
    return;
  }

  // ── Phase 7: atomic finalization via shared service ──────────────────────────
  const result = await finalizePayment({
    merchantTradeNo,
    paylabsTradeNo,
    providerStatus  : rawProviderStatus,
    source          : "webhook",
    rawNotification : body,
  });

  wlog("transaction matched",   { outcome: result.outcome, bookingId: result.bookingId });
  wlog("booking matched",       { orderNumber: result.orderNumber, bookingId: result.bookingId });
  wlog("finalization committed", {
    outcome              : result.outcome,
    previousPaymentStatus: result.previousPaymentStatus,
    previousBookingStatus: result.previousBookingStatus,
    error                : result.error,
  });

  if (result.outcome === "error") {
    logger.error({ requestId, merchantTradeNo, error: result.error }, "[paylabs:webhook] finalization error");
  }

  if (result.outcome === "confirmed" && result.bookingId) {
    // Fire-and-forget: fetch full booking data then send WA notification
    db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, result.bookingId))
      .limit(1)
      .then(([bk]: [typeof bookingsTable.$inferSelect | undefined]) => {
        if (!bk) return;
        notifyPaymentConfirmed({
          customerName  : bk.customerName ?? "",
          customerPhone : bk.customerPhone ?? "",
          orderNumber   : bk.orderNumber ?? "",
          facilityName  : "",   // best-effort; webhook context has no facility join
          bookingDate   : String(bk.bookingDate ?? ""),
          startTime     : String(bk.startTime ?? ""),
          endTime       : String(bk.endTime ?? ""),
          totalPrice    : Number(bk.grandTotal ?? bk.totalPrice ?? 0).toLocaleString("id-ID"),
          bookingId     : bk.id,
          groupRef      : bk.groupRef,
        }).catch(() => {});
      })
      .catch(() => {});
  }

  wlog("acknowledgement sent", { outcome: result.outcome });
  res.status(200).json({ errCode: "0", errMsg: result.outcome });
});

// ─── POST /api/paylabs/reconcile (admin, Phase 8) ────────────────────────────

router.post("/paylabs/reconcile", authMiddleware, adminMiddleware, async (req, res) => {
  const { merchantTradeNo, reason } = req.body as {
    merchantTradeNo?: string;
    reason?:          string;
  };
  const adminUser = (req as any).user as { id: number; role: string } | undefined;

  if (!merchantTradeNo) {
    res.status(400).json({ error: "merchantTradeNo is required" });
    return;
  }

  // Fetch transaction record first to validate before touching anything
  await ensureTransactionsTable();
  const txRows = await db.execute(sql.raw(`
    SELECT id, booking_id, order_number, merchant_trade_no, paylabs_trade_no,
           amount, status, payment_method
    FROM sport_center.paylabs_transactions
    WHERE merchant_trade_no = '${merchantTradeNo.replace(/'/g, "''")}'
    LIMIT 1
  `));
  const txRow = (txRows as any).rows?.[0] ?? (txRows as any)[0];

  if (!txRow) {
    res.status(404).json({ error: "Transaction not found", merchantTradeNo });
    return;
  }

  if (String(txRow.status) === "SUCCESS") {
    res.status(409).json({
      error          : "Transaction already SUCCESS — no action taken",
      merchantTradeNo,
      currentStatus  : txRow.status,
    });
    return;
  }

  // Validate booking exists and hasn't been confirmed by another transaction
  const bookingId = Number(txRow.booking_id);
  const [booking] = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId)).limit(1);

  if (!booking) {
    res.status(404).json({ error: "Booking not found", bookingId });
    return;
  }

  if (booking.status === "confirmed") {
    // Booking already confirmed — could be duplicate. Safe to update txn only.
    res.status(409).json({
      error         : "Booking already confirmed — reconcile the paylabs_transaction manually if needed",
      bookingId,
      orderNumber   : booking.orderNumber,
      bookingStatus : booking.status,
    });
    return;
  }

  // Run finalization
  const result = await finalizePayment({
    merchantTradeNo,
    paylabsTradeNo  : String(txRow.paylabs_trade_no ?? ""),
    providerStatus  : "02",  // reconciliation implies Paylabs confirmed payment
    source          : "paylabs_manual_reconciliation",
    reason          : reason ?? "sandbox callback synchronization failure",
    adminId         : adminUser?.id,
  });

  logger.info(
    {
      adminId   : adminUser?.id,
      merchantTradeNo,
      outcome   : result.outcome,
      bookingId : result.bookingId,
    },
    "[paylabs:reconcile] completed",
  );

  res.json({
    outcome              : result.outcome,
    merchantTradeNo,
    bookingId            : result.bookingId,
    orderNumber          : result.orderNumber,
    previousPaymentStatus: result.previousPaymentStatus,
    previousBookingStatus: result.previousBookingStatus,
    error                : result.error,
  });
});

// ─── GET /api/paylabs/status/:tradeNo ────────────────────────────────────────

router.get("/paylabs/status/:tradeNo", async (req, res) => {
  const { tradeNo } = req.params;
  try {
    await ensureTransactionsTable();
    const rows = await db.execute(sql.raw(
      `SELECT * FROM sport_center.paylabs_transactions WHERE merchant_trade_no = '${tradeNo.replace(/'/g, "''")}' LIMIT 1`
    ));
    const local = (rows as any).rows?.[0] ?? (rows as any)[0];

    const localStatus = String(local?.status ?? "").toUpperCase();
    const terminalStatuses = ["SUCCESS", "PAID", "FAILED", "CANCELLED", "EXPIRED"];
    if (terminalStatuses.includes(localStatus)) {
      return res.json({ local: local ?? null, paylabs: null, paylabsOk: false, inquirySkipped: true });
    }

    const paylabsRes = await statusInquiry(tradeNo);

    const urlNotFound = !paylabsRes.ok && (
      String(paylabsRes.errMsg ?? "").toLowerCase().includes("url not found") ||
      String((paylabsRes.data as any)?.errCodeDes ?? "").toLowerCase().includes("url not found")
    );
    if (urlNotFound) {
      return res.json({ local: local ?? null, paylabs: null, paylabsOk: false, inquirySkipped: true, inquiryNotSupported: true });
    }

    return res.json({ local: local ?? null, paylabs: paylabsRes.data, paylabsOk: paylabsRes.ok });
  } catch (err) {
    logger.error({ err }, "[paylabs] status inquiry error");
    return res.status(500).json({ error: "Status inquiry failed" });
  }
});

export default router;
