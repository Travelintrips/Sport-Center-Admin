/**
 * Paylabs Payment routes
 *
 * POST /api/paylabs/create-payment      — create Paylabs order for a booking
 * POST /api/paylabs/webhook             — receive payment notification from Paylabs
 * POST /api/paylabs/reconcile           — admin: manual reconcile a specific tradeNo
 * GET  /api/paylabs/status/:tradeNo     — poll payment status
 * GET  /api/paylabs/config              — public config (sandbox mode, active methods)
 */

import { Router, type Response } from "express";
import { createHash, randomUUID } from "crypto";
import { db, bookingsTable, paymentsTable, bookingHistoryTable, paylabsSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getPaymentCallbackUrl } from "../lib/appUrl";
import { authMiddleware, adminMiddleware } from "../lib/auth";
import {
  loadPaylabsConfigFromDb,
  getPaylabsConfig,
  getPaylabsSignatureTrace,
  getPaylabsKeyOwnershipTrace,
  isPrivateKeyValid,
  normalizePaylabsPublicKey,
  createPaylabsSignature,
  createPaylabsTimestamp,
  paylabsEndpointFromNotifyUrl,
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
import { extractBookingDpp, postConfirmedPaymentAccounting } from "../lib/accounting";
import { logAccountingError } from "../lib/auditLog";
import {
  isTerminalBookingStatus,
  resolvePaylabsPaidAt,
  resolvePaylabsProviderReference,
} from "../lib/paymentProvider";
import { resolveRequiredPaymentEnrichment, paymentEffectiveDate } from "../lib/paymentEnrichment";
import { requirePaymentProviderId, createPaymentProviderOrderId, normalizeProviderName } from "../lib/paymentMetadata";

const router = Router();
const PAYLABS_WEBHOOK_PATH = "/api/paylabs/webhook";

type PaylabsAckFinalizeResult = "success" | "already_confirmed" | "failed";

/**
 * Send the signed acknowledgement required by Paylabs v4.8.1.
 *
 * The response is deliberately built from the exact three fields Paylabs
 * expects. Its signature uses the merchant private key selected by the active
 * environment (sandbox or production); the Paylabs public key is only used
 * for inbound webhook verification.
 */
function sendPaylabsAck(
  res: Response,
  cfg: Awaited<ReturnType<typeof loadPaylabsConfigFromDb>>,
  requestId: string,
  finalizeResult: PaylabsAckFinalizeResult,
): void {
  const timestamp = createPaylabsTimestamp();
  const ackBody = {
    merchantId: cfg.merchantId,
    requestId,
    errCode: "0",
  };
  const ackBodyStr = JSON.stringify(ackBody);

  let signature: string;
  try {
    if (!cfg.merchantId || !cfg.privateKey) {
      throw new Error("Paylabs ACK signing credentials are not configured");
    }
    signature = createPaylabsSignature(
      cfg.privateKey,
      timestamp,
      ackBodyStr,
      PAYLABS_WEBHOOK_PATH,
    );
  } catch (err) {
    logger.error(
      {
        sandboxMode: cfg.sandboxMode,
        environment: cfg.environment,
        requestId,
        partnerId: cfg.merchantId || "(missing)",
        hasMerchantId: Boolean(cfg.merchantId),
        hasPrivateKey: Boolean(cfg.privateKey),
        inboundSignatureValid: true,
        finalizeResult,
        responseStatus: 503,
        responseSigned: false,
        error: String(err).slice(0, 500),
      },
      "[PAYLABS-ACK] unable to sign response",
    );
    res.status(503).json({
      errCode: "CONFIGURATION_ERROR",
      errMsg: "ack_signature_not_configured",
    });
    return;
  }

  res.set({
    "Content-Type": "application/json;charset=utf-8",
    "X-TIMESTAMP": timestamp,
    "X-PARTNER-ID": cfg.merchantId,
    "X-REQUEST-ID": requestId,
    "X-SIGNATURE": signature,
  });

  logger.info(
    {
      inboundSignatureValid: true,
      finalizeResult,
      responseStatus: 200,
      responseSigned: true,
      requestId,
      partnerId: cfg.merchantId,
      sandboxMode: cfg.sandboxMode,
      environment: cfg.environment,
    },
    "[PAYLABS-ACK] response sent",
  );

  // Send the exact signed JSON bytes; do not add errMsg or other fields.
  res.status(200).send(ackBodyStr);
}

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
      ADD COLUMN IF NOT EXISTS notify_url TEXT,
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ
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
  requestId?:      string;
  reason?:         string;
  adminId?:        number;
  rawNotification?: Record<string, unknown>;
  paidAt?: Date;
  providerReference?: string | null;
}

interface FinalizePaymentResult {
  outcome: "confirmed" | "already_confirmed" | "terminal_booking_manual_review" | "transaction_not_found" | "booking_not_found" | "error";
  bookingId?:    number;
  paymentId?:    number;
  transactionId?: number;
  orderNumber?:  string;
  previousPaymentStatus?: string;
  previousBookingStatus?: string;
  paymentMethod?: string;
  error?: string;
}

/** Petakan kode channel Paylabs ke label metode pembayaran yang mudah dibaca. */
function resolvePaylabsPaymentMethod(rawMethod?: string, rawChannel?: string): string {
  const m = (rawMethod ?? rawChannel ?? "").toUpperCase();
  if (m.includes("QRIS"))                        return "QRIS";
  if (m.includes("OVO") || m.includes("GOPAY") || m.includes("DANA") || m.includes("SHOPEEPAY") || m.includes("EWALLET")) return "E-Wallet";
  if (m.startsWith("VA") || m.includes("VIRTUAL_ACCOUNT") || m.includes("VIRTUAL ACCOUNT"))  return "Virtual Account";
  if (m.includes("CC") || m.includes("CREDIT"))  return "Kartu Kredit";
  if (m === "")                                   return "Transfer Bank";
  return rawMethod ?? rawChannel ?? "Transfer Bank";
}

async function finalizePayment(opts: FinalizePaymentOptions): Promise<FinalizePaymentResult> {
  const {
    merchantTradeNo, paylabsTradeNo, providerStatus,
    source, requestId, reason, adminId, rawNotification, paidAt,
  } = opts;

  try {
    return await db.transaction(async (tx: any) => {
      // Exact merchantTradeNo lookup is the only entry point into the relation.
      const txRows = await tx.execute(sql`
        SELECT id, booking_id, order_number, status, amount, payment_method,
               paylabs_trade_no, merchant_trade_no, paid_at
        FROM sport_center.paylabs_transactions
        WHERE merchant_trade_no = ${merchantTradeNo}
        LIMIT 1
        FOR UPDATE
      `);
      const txRow = (txRows as any).rows?.[0] ?? (txRows as any)[0];

      if (!txRow) {
        logger.warn(
          { merchantTradeNo, booking_id: null, transaction_id: null, requestId },
          "[paylabs] transaction not found",
        );
        return { outcome: "transaction_not_found" as const };
      }

      const transactionId = Number(txRow.id);
      const bookingId = Number(txRow.booking_id);
      const previousPaymentStatus = String(txRow.status ?? "");

      logger.info(
        { merchantTradeNo, booking_id: bookingId, transaction_id: transactionId, requestId },
        "[paylabs] transaction found",
      );

      if (!bookingId) {
        throw new Error(`Payment transaction ${transactionId} has no booking_id`);
      }

      const [booking] = await tx
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId))
        .limit(1);

      if (!booking) {
        throw new Error(`Booking ${bookingId} not found for payment transaction ${transactionId}`);
      }

      // Lock the parent row before changing the booking or inserting the
      // payment mirror. The Paylabs transaction table intentionally keeps a
      // nullable/unconstrained booking_id for legacy recovery, so the
      // payment FK is the last line of defence. Locking here prevents an
      // admin delete or another cleanup transaction from making the relation
      // disappear between the read above and the payment insert.
      const lockedBookingRows = await tx.execute(sql`
        SELECT id
        FROM sport_center.sport_bookings
        WHERE id = ${bookingId}
        FOR UPDATE
      `);
      const lockedBooking = (lockedBookingRows as any).rows?.[0] ?? (lockedBookingRows as any)[0];
      if (!lockedBooking) {
        throw new Error(`Booking ${bookingId} disappeared during Paylabs finalization`);
      }

      logger.info(
        { merchantTradeNo, booking_id: bookingId, transaction_id: transactionId, requestId },
        "[paylabs] booking found",
      );

      if (previousPaymentStatus === "SUCCESS") {
        const existingBookingStatus = String(booking.status ?? "");
        const paymentProof = `paylabs:${paylabsTradeNo || String(txRow.paylabs_trade_no ?? "")}`;
        const existingPaymentRows = await tx.execute(sql`
          SELECT id, payment_method
          FROM sport_center.sport_payments
          WHERE merchant_trade_no = ${merchantTradeNo}
             OR proof_url = ${paymentProof}
          ORDER BY id
          LIMIT 1
        `);
        const existingPayment = (existingPaymentRows as any).rows?.[0] ?? (existingPaymentRows as any)[0];
        if (isTerminalBookingStatus(existingBookingStatus) && !existingPayment) {
          return {
            outcome: "terminal_booking_manual_review" as const,
            bookingId,
            transactionId,
            orderNumber: String(txRow.order_number),
            previousPaymentStatus,
            previousBookingStatus: existingBookingStatus,
          };
        }
        return {
          outcome: "already_confirmed" as const,
          bookingId,
          paymentId: existingPayment?.id ? Number(existingPayment.id) : undefined,
          transactionId,
          orderNumber: String(txRow.order_number),
          previousPaymentStatus,
          previousBookingStatus: String(booking.status ?? ""),
          paymentMethod: existingPayment?.payment_method
            ? String(existingPayment.payment_method)
            : resolvePaylabsPaymentMethod(String(txRow.payment_method ?? "")),
        };
      }

      const previousBookingStatus = String(booking.status ?? "");
      if (isTerminalBookingStatus(previousBookingStatus)) {
        const rawNotificationJson = rawNotification ? JSON.stringify(rawNotification) : null;
        await tx.execute(sql`
          UPDATE sport_center.paylabs_transactions
             SET provider_status = ${providerStatus},
                 raw_notification = ${rawNotificationJson}::jsonb,
                 updated_at = NOW()
           WHERE id = ${transactionId}
        `);
        logger.warn(
          {
            merchantTradeNo,
            booking_id: bookingId,
            transaction_id: transactionId,
            bookingStatus: previousBookingStatus,
            requestId,
          },
          "[paylabs] successful callback requires manual review because booking is terminal",
        );
        return {
          outcome: "terminal_booking_manual_review" as const,
          bookingId,
          transactionId,
          orderNumber: String(txRow.order_number),
          previousPaymentStatus,
          previousBookingStatus,
        };
      }

      const rawNotificationJson = rawNotification ? JSON.stringify(rawNotification) : null;
      await tx.execute(sql`
        UPDATE sport_center.paylabs_transactions
        SET status           = 'SUCCESS',
            provider_status  = ${providerStatus},
            paylabs_trade_no = ${paylabsTradeNo},
            paid_at          = COALESCE(paid_at, ${paidAt ?? new Date()}),
            raw_notification = ${rawNotificationJson}::jsonb,
            updated_at       = NOW()
        WHERE id = ${transactionId}
          AND status != 'SUCCESS'
      `);

      if (isTerminalBookingStatus(previousBookingStatus)) {
        await tx.insert(bookingHistoryTable).values({
          bookingId,
          fromStatus: previousBookingStatus || null,
          toStatus: previousBookingStatus,
          changedByName: "paylabs-webhook",
          note: `Paylabs sukses ditahan untuk manual review karena booking berstatus terminal. merchantTradeNo=${merchantTradeNo}`,
        } as any);
        logger.warn(
          { merchantTradeNo, booking_id: bookingId, transaction_id: transactionId, bookingStatus: previousBookingStatus },
          "[paylabs] successful payment requires manual review for terminal booking",
        );
        return {
          outcome: "terminal_booking_manual_review" as const,
          bookingId,
          transactionId,
          orderNumber: String(booking.orderNumber),
          previousPaymentStatus,
          previousBookingStatus,
        };
      }
      const canonicalPaidAt = opts.paidAt ?? new Date();
      if (previousBookingStatus !== "confirmed") {
        await tx
          .update(bookingsTable)
          .set({ status: "confirmed", paidAt: canonicalPaidAt, updatedAt: new Date() })
          .where(eq(bookingsTable.id, bookingId));
      }

      logger.info(
        { merchantTradeNo, booking_id: bookingId, transaction_id: transactionId, requestId },
        "[paylabs] booking confirmed",
      );

      const amountPaid = Number(txRow.amount ?? booking.grandTotal ?? booking.totalPrice);
      const paymentEnrichment = await resolveRequiredPaymentEnrichment(booking, "paylabs", canonicalPaidAt, {
        // The booking relation is authoritative; this explicit context is
        // only a fallback for company bookings whose relation is still being
        // finalized during the provider callback.
        explicitCompanyId: booking.payerType === "company" ? booking.companyCustomerId : null,
        effectiveDate: paymentEffectiveDate(canonicalPaidAt),
      });
      const [insertedPayment] = await tx.insert(paymentsTable).values({
        bookingId,
        amount     : String(amountPaid),
        proofUrl   : `paylabs:${paylabsTradeNo}`,
        notes      : `Auto-confirmed via Paylabs ${source} (${merchantTradeNo}) | reason: ${reason ?? "payment_notification"}`,
        paymentMethod: resolvePaylabsPaymentMethod(String(txRow.payment_method ?? "")),
        paymentProvider: "paylabs",
        providerName: normalizeProviderName("paylabs"),
        providerReference: (opts.providerReference ?? paylabsTradeNo) || null,
        providerId: requirePaymentProviderId("paylabs", paylabsTradeNo || opts.providerReference || merchantTradeNo),
         providerOrderId: createPaymentProviderOrderId("paylabs", merchantTradeNo),
        merchantTradeNo,
        providerTradeNo: paylabsTradeNo || null,
        companyId: paymentEnrichment.companyId,
        bankAccountId: paymentEnrichment.bankAccountId,
         mdrRate: "0",
         mdrAmount: "0",
         settlementStatus: "unsettled",
        expectedSettlementDate: paymentEnrichment.expectedSettlementDate,
         grossTaxInclusive: true,
        status     : "confirmed",
        paymentType: "full_payment",
        confirmedAt: canonicalPaidAt,
        paidAt: canonicalPaidAt,
      } as any).returning({ id: paymentsTable.id });

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

      await tx.insert(bookingHistoryTable).values({
        bookingId,
        fromStatus   : previousBookingStatus || null,
        toStatus     : "confirmed",
        changedBy    : source === "paylabs_manual_reconciliation" && adminId ? adminId : null,
        changedByName: source === "paylabs_manual_reconciliation"
          ? `admin:${adminId ?? "system"}`
          : "paylabs-webhook",
        note: auditNote,
      } as any);

      logger.info(
        { merchantTradeNo, booking_id: bookingId, transaction_id: transactionId, requestId },
        "[paylabs] commit success",
      );

      const resolvedMethod = resolvePaylabsPaymentMethod(String(txRow.payment_method ?? ""));

      return {
        outcome: "confirmed" as const,
        bookingId,
        paymentId: insertedPayment?.id,
        transactionId,
        orderNumber: String(booking.orderNumber),
        previousPaymentStatus,
        previousBookingStatus,
        paymentMethod: resolvedMethod,
      };
    });
  } catch (err: any) {
    return { outcome: "error", error: String(err?.message ?? err) };
  }
}

function isCommittedPaymentOutcome(
  outcome: FinalizePaymentResult["outcome"] | undefined,
): boolean {
  return outcome === "confirmed" || outcome === "already_confirmed";
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
  if (!callbackBase) {
    res.status(503).json({ error: "Paylabs callback URL is not configured for this environment" });
    return;
  }
  const notifyUrl    = `${callbackBase}/api/paylabs/webhook`;
  const productName  = `Booking ${booking.orderNumber}`;

  // Always log the notifyUrl so it's auditable
  logger.info(
    { notifyUrl, callbackBase, tradeNo, requestId, bookingId, orderNumber: booking.orderNumber, nodeEnv: process.env.NODE_ENV },
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

  const providerPaymentType = method.type === "qris"
    ? "QRIS"
    : method.code ?? paymentMethod.toUpperCase();
  const rawReq = JSON.stringify({
    requestId,
    merchantTradeNo: tradeNo,
    amount,
    paymentMethod,
    paymentType: providerPaymentType,
    notifyUrl,
    redirectUrl: null,
  });

  // Save the relation before calling Paylabs so a fast callback can resolve
  // merchantTradeNo -> booking_id immediately.
  try {
    await ensureTransactionsTable();
    await db.execute(sql`
      INSERT INTO sport_center.paylabs_transactions
        (booking_id, order_number, merchant_trade_no, paylabs_trade_no,
         payment_method, amount, status, notify_url, raw_request)
      VALUES (
        ${booking.id},
        ${booking.orderNumber ?? ""},
        ${tradeNo},
        NULL,
        ${paymentMethod},
        ${amount},
        'PENDING',
        ${notifyUrl},
        ${rawReq}::jsonb
      )
      ON CONFLICT (merchant_trade_no) DO UPDATE SET
        booking_id  = EXCLUDED.booking_id,
        notify_url  = EXCLUDED.notify_url,
        raw_request = EXCLUDED.raw_request,
        updated_at  = NOW()
    `);
  } catch (dbErr) {
    logger.error(
      { dbErr, merchantTradeNo: tradeNo, booking_id: booking.id, transaction_id: null, requestId },
      "[paylabs:create-payment] failed to persist transaction",
    );
    res.status(500).json({ error: "Gagal menyiapkan transaksi Paylabs" });
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
    await db.execute(sql`
      UPDATE sport_center.paylabs_transactions
      SET paylabs_trade_no = ${paylabsTradeNo},
          qr_code_url      = ${qrCodeUrl},
          qr_content       = ${qrContent},
          va_number        = ${vaNumber},
          pay_url          = ${payUrl},
          raw_response     = ${JSON.stringify(d)}::jsonb,
          updated_at       = NOW()
      WHERE merchant_trade_no = ${tradeNo}
    `);
  } catch (dbErr) {
    logger.error(
      { dbErr, merchantTradeNo: tradeNo, booking_id: booking.id, transaction_id: null, requestId },
      "[paylabs:create-payment] failed to update provider response",
    );
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
  // The signature must be calculated from the original HTTP bytes captured by
  // express.json(). Never fall back to JSON.stringify(req.body): that loses the
  // provider's whitespace/key representation and is not the callback Paylabs
  // signed.
  const rawBodyBuffer = (req as any).rawBody;
  const hasOriginalRawBody = Buffer.isBuffer(rawBodyBuffer);
  const rawBody     = hasOriginalRawBody
    ? (rawBodyBuffer as Buffer).toString("utf8")
    : "";
  const body              = req.body as Record<string, unknown>;
  const callbackMerchantId = String(body.merchantId ?? "");
  const merchantTradeNo   = String(body.merchantTradeNo ?? body.merchant_trade_no ?? "");
  const rawProviderStatus = String(
    body.tradeStatus ??
    body.tradeState ??
    body.status ??
    body.paymentStatus ??
    body.orderStatus ??
    body.resultStatus ??
    "",
  );
  const paylabsTradeNo    = String(body.paylabsTradeNo ?? body.platformTradeNo ?? body.tradeNo ?? "");
  let transactionId: number | null = null;
  let bookingId: number | null = null;
  let signatureEndpoint = "/api/paylabs/webhook";
  let notifyUrlForTrace = "";

  try {
    const txRows = await db.execute(sql`
      SELECT id, booking_id, notify_url
      FROM sport_center.paylabs_transactions
      WHERE merchant_trade_no = ${merchantTradeNo}
      LIMIT 1
    `);
    const txRow = (txRows as any).rows?.[0] ?? (txRows as any)[0];
    transactionId = txRow ? Number(txRow.id) : null;
    bookingId = txRow?.booking_id ? Number(txRow.booking_id) : null;
    notifyUrlForTrace = String(txRow?.notify_url ?? "").split(/[?#]/, 1)[0];
    signatureEndpoint = paylabsEndpointFromNotifyUrl(txRow?.notify_url);
  } catch {
    // finalizePayment performs the authoritative lookup inside its transaction.
  }

  // ── Phase 5: structured step logging ────────────────────────────────────────
  const wlog = (step: string, extra: Record<string, unknown> = {}) =>
    logger.info(
      {
        merchantTradeNo,
        booking_id: bookingId,
        transaction_id: transactionId,
        requestId,
        step,
        ...extra,
      },
      `[paylabs] ${step === "received" ? "callback received" : step}`,
    );

  wlog("received", {
    hasTimestamp  : Boolean(timestamp),
    hasSignature  : Boolean(signature),
    partnerId,
    rawBodyLength : rawBody.length,
  });

  const cfg = await loadPaylabsConfigFromDb();
  // Normalize stored public key — handles literal \n from secret managers / DB storage
  const normalizedPublicKey = cfg.paylabsPublicKey
    ? normalizePaylabsPublicKey(cfg.paylabsPublicKey)
    : "";
  const publicKeyValid = Boolean(normalizedPublicKey);
  const privateKeyValid = isPrivateKeyValid(cfg.privateKey);
  const signatureTrace = getPaylabsSignatureTrace(
    timestamp,
    rawBody,
    signatureEndpoint,
    "POST",
  );
  const runtimeEnvironment = cfg.environment ?? (cfg.sandboxMode ? "SANDBOX" : "PROD");
  const keyOwnershipTrace = getPaylabsKeyOwnershipTrace(cfg);
  const notifyPath = paylabsEndpointFromNotifyUrl(notifyUrlForTrace);
  const pathMatch = notifyPath === signatureEndpoint;
  // Paylabs identifies the merchant in the header. Require the header to
  // match the credential pair selected by the active mode; if the callback
  // body also includes merchantId, it must agree too.
  const merchantMatch = Boolean(
    cfg.merchantId &&
    partnerId === cfg.merchantId &&
    (!callbackMerchantId || callbackMerchantId === cfg.merchantId),
  );

  wlog("signature trace", {
    paylabsMode: runtimeEnvironment,
    merchantMatch,
    method: "POST",
    endpointPath: signatureEndpoint,
    notifyUrl: notifyUrlForTrace || "(not found)",
    notifyPath,
    verificationPath: signatureEndpoint,
    pathMatch,
    timestampFromHeader: timestamp,
    bodyHash: signatureTrace.bodyHash,
    minifiedBodyLength: signatureTrace.minifiedBodyLength,
    canonicalString: signatureTrace.stringToVerify,
    originalUrlPath: String(req.originalUrl ?? "").split("?", 1)[0],
    requestPath: req.path,
    signatureLength: signature.length,
    rawBodyLength: rawBody.length,
    publicKeyValid,
    ...keyOwnershipTrace,
    runtimeMode: process.env.NODE_ENV ?? "unknown",
    merchantEnvSelected: runtimeEnvironment,
    merchantId: cfg.merchantId || "(missing)",
    merchantIdSource: cfg.merchantIdSource ?? "NONE",
    privateKeySource: cfg.privateKeySource ?? "NONE",
    publicKeySource: cfg.publicKeySource ?? "NONE",
    privateKeyValid,
    hasOriginalRawBody,
  });

  // ── Phase 6: signature verification ─────────────────────────────────────────
  if (!merchantMatch) {
    wlog("signature result", {
      paylabsMode: runtimeEnvironment,
      merchantMatch,
      method: "POST",
      endpointPath: signatureEndpoint,
      timestampFromHeader: timestamp,
      bodyHash: signatureTrace.bodyHash,
      publicKeyValid,
      signatureValid: false,
      hasPublicKey: publicKeyValid,
      hasSignature: Boolean(signature),
      hasTimestamp: Boolean(timestamp),
      hasPartnerId: Boolean(partnerId),
      verificationResult: "ENVIRONMENT_MISMATCH",
    });
    logger.info(
      {
        inboundSignatureValid: false,
        finalizeResult: "failed",
        responseStatus: 400,
        responseSigned: false,
        requestId,
        partnerId,
      },
      "[PAYLABS-ACK] inbound signature rejected",
    );
    res.status(400).json({ errCode: "ENVIRONMENT_MISMATCH" });
    return;
  }

  if (normalizedPublicKey) {
    const valid = hasOriginalRawBody && verifyPaylabsSignature(
        normalizedPublicKey,
        timestamp,
        rawBody,
        signature,
        signatureEndpoint,
      );
    const verificationResult = valid ? "VALID" : "INVALID";
    wlog("signature result", {
      paylabsMode: runtimeEnvironment,
      merchantMatch,
      method: "POST",
      endpointPath: signatureEndpoint,
      timestampFromHeader: timestamp,
      bodyHash: signatureTrace.bodyHash,
      publicKeyValid,
      signatureValid: valid,
      hasPublicKey      : true,
      hasSignature      : Boolean(signature),
      hasTimestamp      : Boolean(timestamp),
      hasPartnerId      : Boolean(partnerId),
      hasOriginalRawBody,
      verificationResult,
    });
    if (!valid) {
      logger.info(
        {
          inboundSignatureValid: false,
          finalizeResult: "failed",
          responseStatus: 400,
          responseSigned: false,
          requestId,
          partnerId,
        },
        "[PAYLABS-ACK] inbound signature rejected",
      );
      // Persist raw_notification even on rejection so we can distinguish
      // "webhook never arrived" (raw_notification=null) from "webhook arrived
      // but rejected" (raw_notification has content, status stays PENDING).
      try {
        await ensureTransactionsTable();
        await db.execute(sql`
          UPDATE sport_center.paylabs_transactions
          SET raw_notification = ${JSON.stringify({ _rejected: true, _reason: "SIGNATURE_INVALID", body, timestamp, partnerId })}::jsonb,
              updated_at       = NOW()
          WHERE merchant_trade_no = ${merchantTradeNo}
        `);
      } catch { /* best-effort — don't block the response */ }
      // Paylabs retries notifications when the merchant response is not
      // successful. Returning 200 here would acknowledge a callback that we
      // deliberately rejected and would prevent recovery after the key or
      // signature configuration is corrected.
      res.status(400).json({ errCode: "SIGNATURE_INVALID" });
      return;
    }
  } else {
    // FAIL CLOSED — no Paylabs public key configured, cannot verify webhook authenticity.
    // There is no mock bypass: real callbacks must always be authenticated.
    wlog("signature result", {
      paylabsMode: runtimeEnvironment,
      merchantMatch,
      method: "POST",
      endpointPath: signatureEndpoint,
      timestampFromHeader: timestamp,
      bodyHash: signatureTrace.bodyHash,
      publicKeyValid,
      signatureValid: false,
      hasPublicKey      : false,
      hasSignature      : Boolean(signature),
      hasTimestamp      : Boolean(timestamp),
      hasPartnerId      : Boolean(partnerId),
      hasOriginalRawBody,
      verificationResult: cfg.paylabsPublicKey.trim()
        ? "PUBLIC_KEY_INVALID"
        : "PUBLIC_KEY_NOT_CONFIGURED",
      result            : cfg.paylabsPublicKey.trim()
        ? "PUBLIC_KEY_INVALID"
        : "PUBLIC_KEY_NOT_CONFIGURED",
    });
    logger.info(
      {
        inboundSignatureValid: false,
        finalizeResult: "failed",
        responseStatus: 503,
        responseSigned: false,
        requestId,
        partnerId,
      },
      "[PAYLABS-ACK] inbound signature could not be verified",
    );
    // Persist raw_notification so we know a webhook arrived (even if no public key)
    try {
      await ensureTransactionsTable();
      await db.execute(sql`
        UPDATE sport_center.paylabs_transactions
        SET raw_notification = ${JSON.stringify({ _rejected: true, _reason: "PUBLIC_KEY_NOT_CONFIGURED", body })}::jsonb,
            updated_at       = NOW()
        WHERE merchant_trade_no = ${merchantTradeNo}
      `);
    } catch { /* best-effort */ }
    // A missing verification key is a merchant configuration failure. Use a
    // non-2xx response so Paylabs can retry after the key is configured.
    res.status(503).json({
      errCode: "CONFIGURATION_ERROR",
      errMsg: cfg.paylabsPublicKey.trim() ? "public_key_invalid" : "signature_required",
    });
    return;
  }

  // ── Phase 4: centralised status mapper ──────────────────────────────────────
  const internalStatus = mapPaylabsStatus(rawProviderStatus);
  const isPaid         = internalStatus === "SUCCESS";

  wlog("status mapped", {
    merchantTradeNo,
    rawProviderStatus,
    internalStatus,
    isPaid,
  });

  if (!isPaid) {
    // Non-success provider states are recorded without finalizing the booking.
    try {
      await ensureTransactionsTable();
      await db.execute(sql`
        UPDATE sport_center.paylabs_transactions
        SET provider_status   = ${rawProviderStatus},
            paylabs_trade_no  = ${paylabsTradeNo},
            raw_notification  = ${JSON.stringify(body)}::jsonb,
            updated_at        = NOW()
        WHERE merchant_trade_no = ${merchantTradeNo}
      `);
    } catch (err) {
      logger.warn(
        { err, merchantTradeNo, booking_id: bookingId, transaction_id: transactionId, requestId },
        "[paylabs] non-success status persistence failed",
      );
      // Do not acknowledge a notification that was not persisted. Paylabs'
      // documented retry policy is the recovery mechanism for this case.
      logger.info(
        {
          inboundSignatureValid: true,
          finalizeResult: "failed",
          responseStatus: 500,
          responseSigned: false,
          requestId,
          partnerId,
        },
        "[PAYLABS-ACK] notification persistence failed",
      );
      res.status(500).json({ errCode: "PERSISTENCE_ERROR", errMsg: "notification_not_persisted" });
      return;
    }
    wlog("acknowledgement sent", { isPaid: false, internalStatus });
    sendPaylabsAck(res, cfg, requestId, "success");
    return;
  }

  // ── Phase 7: atomic finalization via shared service ──────────────────────────
  const result = await finalizePayment({
    merchantTradeNo,
    paylabsTradeNo,
    providerStatus  : rawProviderStatus,
    source          : "webhook",
    requestId,
    rawNotification : body,
    paidAt: resolvePaylabsPaidAt(body, new Date()),
    providerReference: resolvePaylabsProviderReference(body, paylabsTradeNo),
  });

  transactionId = result.transactionId ?? null;
  bookingId = result.bookingId ?? null;
  wlog("transaction found", { outcome: result.outcome });
  wlog("booking found", { orderNumber: result.orderNumber });
  wlog("finalization committed", {
    outcome              : result.outcome,
    previousPaymentStatus: result.previousPaymentStatus,
    previousBookingStatus: result.previousBookingStatus,
    error                : result.error,
  });

  if (result.outcome === "error") {
    logger.error({ requestId, merchantTradeNo, error: result.error }, "[paylabs:webhook] finalization error");
  }

  // A successful provider notification is not complete until the local
  // payment and booking transaction commits. Returning 200 for these outcomes
  // would stop Paylabs' retry policy while the booking remains unpaid locally.
  // Terminal bookings are different: the callback was safely recorded and
  // must be handled by an administrator rather than retried indefinitely.
  const retryableOutcomes = new Set<FinalizePaymentResult["outcome"]>([
    "error",
    "transaction_not_found",
    "booking_not_found",
  ]);
  if (retryableOutcomes.has(result.outcome)) {
    logger.info(
      {
        inboundSignatureValid: true,
        finalizeResult: "failed",
        responseStatus: 500,
        responseSigned: false,
        requestId,
        partnerId,
      },
      "[PAYLABS-ACK] finalization failed; success ACK withheld",
    );
    res.status(500).json({
      errCode: "FINALIZATION_ERROR",
      errMsg: result.error ?? result.outcome,
    });
    return;
  }

  if ((result.outcome === "confirmed" || result.outcome === "already_confirmed") && result.bookingId) {
    const confirmedBookingId = result.bookingId;
    const confirmedPaymentMethod = result.paymentMethod ?? "Transfer Bank";

    // Fire-and-forget: fetch full booking data then send WA notification + jurnal akuntansi
    db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, confirmedBookingId))
      .limit(1)
      .then((rows) => {
        const bk = rows[0];
        if (!bk) return;

        // WA notification
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

        // Jurnal akuntansi — wajib untuk semua pembayaran Paylabs
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
        const { dpp, ppnAmount } = extractBookingDpp(bk);
        postConfirmedPaymentAccounting({
          bookingId: bk.id,
          orderNumber: bk.orderNumber ?? "",
          dpp,
          ppnAmount,
          facilityId: bk.facilityId,
          journalDate: today,
          paymentMethod: confirmedPaymentMethod,
          paymentId: result.paymentId,
        }).catch((err) => logAccountingError({ operation: "postConfirmedPaymentAccounting", orderNumber: bk.orderNumber ?? "", bookingId: bk.id, error: err }));
      })
      .catch(() => {});
  }

  wlog("acknowledgement sent", { outcome: result.outcome });
  sendPaylabsAck(
    res,
    cfg,
    requestId,
    result.outcome === "already_confirmed" ? "already_confirmed" : "success",
  );
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
    paidAt          : new Date(),
    providerReference: String(txRow.paylabs_trade_no ?? "") || null,
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

  // Jurnal akuntansi untuk reconcile manual
  if ((result.outcome === "confirmed" || result.outcome === "already_confirmed") && result.bookingId) {
    const reconBookingId = result.bookingId;
    const reconPaymentMethod = result.paymentMethod ?? String(txRow.payment_method ?? "Transfer Bank");
    db.select().from(bookingsTable)
      .where(eq(bookingsTable.id, reconBookingId))
      .limit(1)
      .then((rows) => {
        const bk = rows[0];
        if (!bk) return;
        const today = new Date().toISOString().split("T")[0];
        const { dpp, ppnAmount } = extractBookingDpp(bk);
        postConfirmedPaymentAccounting({
          bookingId: bk.id,
          orderNumber: bk.orderNumber ?? "",
          dpp,
          ppnAmount,
          facilityId: bk.facilityId,
          journalDate: today,
          paymentMethod: reconPaymentMethod,
          paymentId: result.paymentId,
        }).catch((err) => logAccountingError({ operation: "postConfirmedPaymentAccounting", orderNumber: bk.orderNumber ?? "", bookingId: bk.id, error: err }));
      })
      .catch(() => {});
  }

  res.json({
    outcome              : result.outcome,
    merchantTradeNo,
    bookingId            : result.bookingId,
    orderNumber          : result.orderNumber,
    previousPaymentStatus: result.previousPaymentStatus,
    previousBookingStatus: result.previousBookingStatus,
    paymentMethod        : result.paymentMethod,
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

    // Use the same database-backed credentials as create-payment.  Calling
    // statusInquiry() without cfg silently fell back to env credentials, which
    // is usually empty when Paylabs settings are maintained in the admin UI.
    const cfg = await loadPaylabsConfigFromDb();
    const resolvedMethod = resolvePaymentMethod(String(local?.payment_method ?? ""));
    const inquiryPaymentType =
      resolvedMethod.type === "qris"
        ? "QRIS"
        : resolvedMethod.type === "va" || resolvedMethod.type === "ewallet"
          ? resolvedMethod.code
          : String(local?.payment_method ?? "VA");
    const paylabsRes = await statusInquiry(tradeNo, inquiryPaymentType, cfg);

    const urlNotFound = !paylabsRes.ok && (
      String(paylabsRes.errMsg ?? "").toLowerCase().includes("url not found") ||
      String((paylabsRes.data as any)?.errCodeDes ?? "").toLowerCase().includes("url not found")
    );
    if (urlNotFound) {
      return res.json({ local: local ?? null, paylabs: null, paylabsOk: false, inquirySkipped: true, inquiryNotSupported: true });
    }

    const providerData = paylabsRes.data as Record<string, unknown>;
    const rawProviderStatus = String(
      providerData.status ??
      providerData.tradeStatus ??
      providerData.tradeState ??
      providerData.paymentStatus ??
      providerData.orderStatus ??
      providerData.resultStatus ??
      "",
    );
    const internalStatus = mapPaylabsStatus(rawProviderStatus);

    // Inquiry is a recovery path for a missed/ rejected webhook.  A successful
    // status must be committed server-side, not merely shown optimistically in
    // the browser, otherwise the booking remains pending after a refresh.
    let reconciliation: FinalizePaymentResult | undefined;
    if (paylabsRes.ok && internalStatus === "SUCCESS") {
      const paylabsTradeNo = String(
        providerData.platformTradeNo ??
        providerData.paylabsTradeNo ??
        providerData.tradeNo ??
        local?.paylabs_trade_no ??
        "",
      );
      reconciliation = await finalizePayment({
        merchantTradeNo: tradeNo,
        paylabsTradeNo,
        providerStatus: rawProviderStatus || "02",
        source: "paylabs_manual_reconciliation",
        reason: "automatic status inquiry recovery",
        paidAt: resolvePaylabsPaidAt(providerData, new Date()),
        providerReference: resolvePaylabsProviderReference(providerData, paylabsTradeNo),
      });

      // Keep automatic inquiry recovery aligned with webhook/manual
      // reconciliation. The payment row is committed atomically above; the
      // accounting journal is posted idempotently after the transaction.
      if (isCommittedPaymentOutcome(reconciliation.outcome) && reconciliation.bookingId) {
        const recoveredBookingId = reconciliation.bookingId;
        db.select().from(bookingsTable)
          .where(eq(bookingsTable.id, recoveredBookingId))
          .limit(1)
          .then((rows) => {
            const bk = rows[0];
            if (!bk) return;
            const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
            const { dpp, ppnAmount } = extractBookingDpp(bk);
            postConfirmedPaymentAccounting({
              bookingId: bk.id,
              orderNumber: bk.orderNumber ?? "",
              dpp,
              ppnAmount,
              facilityId: bk.facilityId,
              journalDate: today,
              paymentMethod: reconciliation?.paymentMethod ?? "Transfer Bank",
              paymentId: reconciliation.paymentId,
            }).catch((accountingErr) =>
              logAccountingError({
                operation: "postConfirmedPaymentAccounting:autoInquiryRecovery",
                orderNumber: bk.orderNumber ?? "",
                bookingId: bk.id,
                error: accountingErr,
              }),
            );
          })
          .catch(() => {});
      }
    }

    // finalizePayment runs in a separate transaction from this inquiry. Re-read
    // the transaction after reconciliation so the browser receives the
    // committed SUCCESS state instead of the stale PENDING row loaded above.
    let committedLocal = local ?? null;
    if (reconciliation && isCommittedPaymentOutcome(reconciliation.outcome)) {
      const refreshedRows = await db.execute(sql`
        SELECT *
        FROM sport_center.paylabs_transactions
        WHERE merchant_trade_no = ${tradeNo}
        LIMIT 1
      `);
      committedLocal = (refreshedRows as any).rows?.[0] ?? (refreshedRows as any)[0] ?? committedLocal;
    }

    return res.json({
      local: committedLocal,
      paylabs: paylabsRes.data,
      paylabsOk: paylabsRes.ok,
      reconciliation: reconciliation
        ? {
            outcome: reconciliation.outcome,
            bookingId: reconciliation.bookingId,
            error: reconciliation.error,
          }
        : undefined,
    });
  } catch (err) {
    logger.error({ err }, "[paylabs] status inquiry error");
    return res.status(500).json({ error: "Status inquiry failed" });
  }
});

export default router;
