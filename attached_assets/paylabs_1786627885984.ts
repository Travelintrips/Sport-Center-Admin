import { Router, type IRouter, type Request } from "express";
import { and, eq, not } from "drizzle-orm";
import { db, orderAsuransiTable, settingsTable } from "@workspace/db";
import {
  createVAPayment,
  createQRISPayment,
  createH5Payment,
  verifyWebhookSignature,
  getMerchantPublicKey,
  inquirePayment,
  type PaylabsConfig,
} from "../services/paylabsService.js";
import { deliverCertificateAfterPayment } from "./send-certificate.js";
import { syncPaylabsPaymentToSupabase, syncPaylabsPaidToSupabase } from "../lib/supabase.js";

const router: IRouter = Router();

/**
 * Baca kredensial Paylabs dari tabel settings (admin dashboard).
 * Jika belum diisi di DB, kembalikan undefined → service fallback ke env vars.
 */
async function loadPaylabsConfig(): Promise<PaylabsConfig | undefined> {
  try {
    const rows = await db.select().from(settingsTable);
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));

    const isSandbox = s.paylabs_sandbox_mode !== "false";
    const merchantId = isSandbox
      ? (s.paylabs_merchant_id_sandbox?.trim() || s.paylabs_merchant_id?.trim() || process.env.PAYLABS_MERCHANT_ID_SANDBOX?.trim() || process.env.PAYLABS_MERCHANT_ID || "")
      : (s.paylabs_merchant_id?.trim() || process.env.PAYLABS_MERCHANT_ID || "");
    const storeId = s.paylabs_store_id?.trim() || undefined;

    const privateKey = isSandbox
      ? (s.paylabs_private_key_sandbox?.trim() || process.env.PAYLABS_PRIVATE_KEY_SANDBOX?.trim() || process.env.PAYLABS_PRIVATE_KEY || "")
      : (s.paylabs_private_key?.trim() || process.env.PAYLABS_PRIVATE_KEY || "");

    const publicKey = isSandbox
      ? (s.paylabs_public_key_sandbox?.trim() || process.env.PAYLABS_PUBLIC_KEY_SANDBOX?.trim() || process.env.PAYLABS_PUBLIC_KEY || "")
      : (s.paylabs_public_key?.trim() || process.env.PAYLABS_PUBLIC_KEY || "");

    if (!merchantId) return undefined;
    const merchantIdSrc = isSandbox
      ? (s.paylabs_merchant_id_sandbox?.trim() ? "DB sandbox" : s.paylabs_merchant_id?.trim() ? "DB prod" : "env")
      : (s.paylabs_merchant_id?.trim() ? "DB prod" : "env");
    const privateKeySrc = isSandbox
      ? (s.paylabs_private_key_sandbox?.trim() ? "DB sandbox" : "env")
      : (s.paylabs_private_key?.trim() ? "DB prod" : "env");
    console.log(`[Paylabs config] merchantId=${merchantId} (${merchantIdSrc}) | sandbox=${isSandbox} | privateKey src=${privateKeySrc}`);
    return { merchantId, privateKey, publicKey, isSandbox, storeId };
  } catch {
    return undefined;
  }
}

const VALID_PAYMENT_TYPES = ["QRIS", "VIRTUAL_ACCOUNT", "H5"] as const;
type PaymentType = (typeof VALID_PAYMENT_TYPES)[number];

/**
 * Derive the public-facing base URL from the incoming request.
 * With trust proxy=true, req.protocol and req.hostname reflect the
 * actual domain the user hit — works correctly in both dev and production.
 * Falls back to env vars if hostname looks like an internal address.
 */
function getBaseUrlFromReq(req: import("express").Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");

  const proto = req.protocol ?? "https";
  const host = req.hostname ?? "";

  // If trust proxy resolves a real public hostname, use it
  const isInternal = !host || host === "localhost" || host === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (!isInternal) return `${proto}://${host}`;

  // Fallback: env vars
  if (process.env.REPLIT_DOMAINS) {
    const first = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    if (first) return `https://${first}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "https://travelintrips.replit.app";
}

function getAppBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DOMAINS) {
    const first = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    if (first) return `https://${first}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "https://travelintrips.replit.app";
}

// ── Create payment ────────────────────────────────────────────────────────────

router.post("/paylabs/create-payment", async (req, res): Promise<void> => {
  try {
    const { orderId, paymentType, bankCode } = req.body as {
      orderId?: number;
      paymentType?: string;
      bankCode?: string;
    };

    if (!orderId || !paymentType) {
      res.status(400).json({ error: "orderId dan paymentType wajib diisi." });
      return;
    }

    if (!VALID_PAYMENT_TYPES.includes(paymentType as PaymentType)) {
      res.status(400).json({
        error: `paymentType tidak valid. Gunakan: ${VALID_PAYMENT_TYPES.join(", ")}.`,
      });
      return;
    }

    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const [order] = await db
      .select()
      .from(orderAsuransiTable)
      .where(eq(orderAsuransiTable.id, Number(orderId)));

    if (!order) {
      console.warn(`[create-payment] ORDER_NOT_FOUND requestId=${reqId} orderId=${orderId} table=order_asuransi`);
      res.status(404).json({
        error: "ORDER_NOT_FOUND",
        requestId: reqId,
        searchedBy: "id",
        orderId,
        table: "order_asuransi",
      });
      return;
    }

    if (order.status === "paid") {
      res.status(400).json({ error: "Order sudah dibayar." });
      return;
    }

    const amount = Number(order.harga ?? order.total);

    // FIX #4 — Idempotency: reuse existing merchantTradeNo if the same payment type
    // was already initiated. Avoids creating orphan transactions on Paylabs every retry.
    const existingTradeNo = order.paylabsMerchantTradeNo;
    const existingType = order.paylabsPaymentType;
    // For VA: compare by bankCode (stored as specific code e.g. "BNIVA"); for others by paymentType
    const samePayment = paymentType === "VIRTUAL_ACCOUNT"
      ? existingType === (bankCode ?? "VIRTUAL_ACCOUNT")
      : existingType === paymentType;
    const merchantTradeNo =
      existingTradeNo && samePayment
        ? existingTradeNo
        : `TIT-${order.id}-${Date.now()}`;

    const baseParams = {
      orderId: merchantTradeNo,
      amount,
      customerName: order.customerName,
      email: order.email ?? "",
      phone: order.customerPhone,
      productName: order.namaProduk ?? "Asuransi Perjalanan",
    };

    const appBaseUrl = getBaseUrlFromReq(req);
    console.log("[Paylabs create-payment] appBaseUrl:", appBaseUrl, "| paymentType:", paymentType);
    const paylabsConfig = await loadPaylabsConfig();

    if (paymentType === "QRIS") {
      const notifyUrl = `${appBaseUrl}/api/paylabs/webhook`;
      const result = await createQRISPayment({ ...baseParams, notifyUrl }, paylabsConfig);
      if (!result.success) {
        res.status(502).json({ error: result.error ?? "Gagal membuat QRIS.", raw: result.raw });
        return;
      }
      await db
        .update(orderAsuransiTable)
        .set({
          paylabsOrderId: result.paylabsOrderId,
          paylabsMerchantTradeNo: merchantTradeNo,
          paylabsQrCode: result.qrCode,
          paylabsPaymentType: "QRIS",
        })
        .where(eq(orderAsuransiTable.id, order.id));
      syncPaylabsPaymentToSupabase(order.id, {
        paylabsOrderId: result.paylabsOrderId,
        paylabsMerchantTradeNo: merchantTradeNo,
        paylabsQrCode: result.qrCode,
        paylabsPaymentType: "QRIS",
      }, {
        orderCode: order.orderCode,
      }).catch((err) => console.warn("[Paylabs QRIS] Supabase sync failed:", err));
      res.json({
        paymentType: "QRIS",
        qrCode: result.qrCode,
        paylabsOrderId: result.paylabsOrderId,
        amount,
        expiredTime: result.expiredTime,
      });
      return;
    }

    if (paymentType === "VIRTUAL_ACCOUNT") {
      const notifyUrl = `${appBaseUrl}/api/paylabs/webhook`;
      const result = await createVAPayment({ ...baseParams, bankCode, notifyUrl }, paylabsConfig);
      if (!result.success) {
        res.status(502).json({ error: result.error ?? "Gagal membuat Virtual Account.", raw: result.raw });
        return;
      }
      const storedBankCode = bankCode ?? "VIRTUAL_ACCOUNT";
      await db
        .update(orderAsuransiTable)
        .set({
          paylabsOrderId: result.paylabsOrderId,
          paylabsMerchantTradeNo: merchantTradeNo,
          paylabsVaNumber: result.vaNumber,
          paylabsPaymentType: storedBankCode,
        })
        .where(eq(orderAsuransiTable.id, order.id));
      syncPaylabsPaymentToSupabase(order.id, {
        paylabsOrderId: result.paylabsOrderId,
        paylabsMerchantTradeNo: merchantTradeNo,
        paylabsVaNumber: result.vaNumber,
        paylabsPaymentType: storedBankCode,
      }, {
        orderCode: order.orderCode,
      }).catch((err) => console.warn("[Paylabs VA] Supabase sync failed:", err));
      res.json({
        paymentType: "VIRTUAL_ACCOUNT",
        vaNumber: result.vaNumber,
        bank: result.bank,
        paylabsOrderId: result.paylabsOrderId,
        amount,
        expiredTime: result.expiredTime,
      });
      return;
    }

    if (paymentType === "H5") {
      const redirectUrl = `${appBaseUrl}/payment/success?orderId=${order.id}`;
      const notifyUrl = `${appBaseUrl}/api/paylabs/webhook`;
      console.log("[Paylabs H5] redirectUrl:", redirectUrl, "| notifyUrl:", notifyUrl);
      const result = await createH5Payment({
        orderId: merchantTradeNo,
        amount,
        customerName: order.customerName,
        phone: order.customerPhone,
        productName: order.namaProduk ?? "Asuransi Perjalanan",
        redirectUrl,
        notifyUrl,
      }, paylabsConfig);
      if (!result.success) {
        res.status(502).json({ error: result.error ?? "Gagal membuat H5 link.", raw: result.raw });
        return;
      }
      await db
        .update(orderAsuransiTable)
        .set({
          paylabsOrderId: result.paylabsOrderId,
          paylabsMerchantTradeNo: merchantTradeNo,
          paylabsPaymentUrl: result.paymentUrl,
          paylabsPaymentType: "H5",
        })
        .where(eq(orderAsuransiTable.id, order.id));
      syncPaylabsPaymentToSupabase(order.id, {
        paylabsOrderId: result.paylabsOrderId,
        paylabsMerchantTradeNo: merchantTradeNo,
        paylabsPaymentUrl: result.paymentUrl,
        paylabsPaymentType: "H5",
      }, {
        orderCode: order.orderCode,
      }).catch((err) => console.warn("[Paylabs H5] Supabase sync failed:", err));
      res.json({
        paymentType: "H5",
        paymentUrl: result.paymentUrl,
        paylabsOrderId: result.paylabsOrderId,
        amount,
      });
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Paylabs create-payment] Unhandled error:", msg);
    res.status(500).json({ error: `Gagal memproses pembayaran: ${msg}` });
  }
});

// ── Webhook ───────────────────────────────────────────────────────────────────

router.post("/paylabs/webhook", async (req, res): Promise<void> => {
  try {
    const rawBody: string = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    const payload = req.body as Record<string, unknown>;

    const signature = String(
      req.headers["x-signature"] ??
      req.headers["x-paylabs-signature"] ??
      req.headers["x-sign"] ??
      "",
    );

    console.log("[Webhook] Raw body length:", rawBody.length);
    console.log("[Webhook] Signature header:", signature || "(none)");
    console.log("[Webhook] Received payload:", JSON.stringify(payload, null, 2));

    // Signature verification: warn but don't reject in SIT mode,
    // since Paylabs SIT may omit or send incorrect signatures.
    // In production with PAYLABS_ENV=production, reject invalid signatures.
    const isProduction = process.env.PAYLABS_ENV === "production";
    const webhookConfig = await loadPaylabsConfig();
    if (isProduction) {
      if (!signature) {
        console.warn("[Webhook] Missing signature in production — rejecting");
        res.status(401).json({ error: "Missing signature" });
        return;
      }
      if (!verifyWebhookSignature(rawBody, signature, webhookConfig)) {
        console.warn("[Webhook] Signature verification FAILED in production — rejecting");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    } else {
      if (!signature) {
        console.warn("[Webhook] Missing signature (SIT mode) — processing anyway");
      } else if (!verifyWebhookSignature(rawBody, signature, webhookConfig)) {
        console.warn("[Webhook] Signature verification FAILED (SIT mode) — processing anyway");
      } else {
        console.log("[Webhook] Signature OK");
      }
    }

    const paylabsOrderId = String(
      payload.merchantTradeNo ??
      payload.merchantOrderNo ??
      payload.paymentId ??
      payload.referenceNo ??
      payload.tradeNo ??
      payload.orderNo ??
      "",
    );

    const statusRaw = String(
      payload.tradeStatus ??
      payload.tradeState ??
      payload.status ??
      payload.paymentStatus ??
      payload.orderStatus ??
      payload.resultCode ??
      "",
    ).toUpperCase().trim();

    const PAID_STATUSES = new Set(["02", "2", "SUCCESS", "PAID", "00", "0", "SETTLED", "COMPLETE", "COMPLETED", "TRADE_SUCCESS", "PAYMENT_SUCCESS"]);
    const isPaid = PAID_STATUSES.has(statusRaw);

    console.log("[Webhook] paylabsOrderId:", paylabsOrderId, "| statusRaw:", statusRaw, "| isPaid:", isPaid);
    if (isPaid) {
      console.log("[TRACE] Paylabs SUCCESS", JSON.stringify({
        paylabsOrderId,
        statusRaw,
        callbackPath: "POST /api/paylabs/webhook",
      }, null, 2));
    }

    if (!paylabsOrderId || !isPaid) {
      console.log("[Webhook] Not paid or no orderId — acknowledging without update");
      res.json({ resultCode: "00", resultMsg: "OK" });
      return;
    }

    let [order] = await db
      .select()
      .from(orderAsuransiTable)
      .where(eq(orderAsuransiTable.paylabsOrderId, paylabsOrderId));

    if (!order) {
      [order] = await db
        .select()
        .from(orderAsuransiTable)
        .where(eq(orderAsuransiTable.paylabsMerchantTradeNo, paylabsOrderId));
    }

    // Extract bank channel — Paylabs sends paymentType in VA/QRIS webhooks.
    const channelFromPayload = String(
      payload.paymentType ??
      payload.channelType ??
      payload.bankCode ??
      payload.channel ??
      payload.paymentChannel ??
      payload.bankChannel ??
      payload.subPayType ??
      "",
    ).toUpperCase().trim();

    // Map Paylabs channel names to our bank codes.
    const CHANNEL_MAP: Record<string, string> = {
      BNIVA: "BNIVA", BNI: "BNIVA",
      MANDIRIVA: "MandiriVA", MANDIRI: "MandiriVA",
      PERMATAVA: "PERMATAVA", PERMATA: "PERMATAVA",
      MAYBANKVA: "MAYBANKVA", MAYBANK: "MAYBANKVA",
      CIMBVA: "CIMBVA", CIMB: "CIMBVA", CIMBNIAGA: "CIMBVA",
      BRIVA: "BRIVA", BRI: "BRIVA",
      BCAVA: "BCAVA", BCA: "BCAVA",
      BTNVA: "BTNVA", BTN: "BTNVA",
      DANAMONVA: "DanamonVA", DANAMON: "DanamonVA",
      BSIVA: "BSIVA", BSI: "BSIVA",
      MUAMALATVA: "MUAMALATVA", MUAMALAT: "MUAMALATVA",
      SINARMASVA: "SINARMASVA", SINARMAS: "SINARMASVA",
      INAVA: "INAVA", INA: "INAVA",
    };
    const resolvedBank = channelFromPayload ? (CHANNEL_MAP[channelFromPayload] ?? channelFromPayload) : null;

    // Extract VA number — Paylabs v2.1 nests it in paymentMethodInfo.vaCode.
    const vaNumber = String(
      (payload.paymentMethodInfo as Record<string, unknown> | undefined)?.vaCode ??
      payload.vaNumber ??
      payload.vaAccount ??
      payload.accountNo ??
      payload.virtualAccountNumber ??
      payload.bankVaNo ??
      payload.paymentCode ??
      "",
    ).trim() || null;

    if (!order) {
      // The payment callback can reach a different API instance/database than
      // the one that created the order. Do not acknowledge a paid callback
      // before updating the canonical Supabase insurance row.
      const merchantTradeNo = String(
        payload.merchantTradeNo ??
        payload.merchantOrderNo ??
        payload.tradeNo ??
        payload.orderNo ??
        "",
      ).trim() || null;
      const paymentId = String(payload.paymentId ?? "").trim() || null;
      const transactionId = String(
        payload.paymentId ?? payload.tradeNo ?? payload.transactionId ?? "",
      ).trim() || null;
      const inferredLocalId = merchantTradeNo?.match(/^TIT-(\d+)-/)?.[1];

      const syncResult = await syncPaylabsPaidToSupabase(
        inferredLocalId ? Number(inferredLocalId) : 0,
        new Date().toISOString(),
        transactionId,
        resolvedBank,
        vaNumber,
        {
          paylabsOrderId: paymentId,
          paylabsMerchantTradeNo: merchantTradeNo ?? paylabsOrderId,
        },
      );
      console.warn(
        "[Webhook] Local order not found; Supabase fallback sync:",
        JSON.stringify({
          paylabsOrderId,
          merchantTradeNo,
          paymentId,
          matched: syncResult.matched,
          targetId: syncResult.targetId ?? null,
        }),
      );
      res.json({ resultCode: "00", resultMsg: "OK" });
      return;
    }

    console.log("[Webhook] Found order id:", order.id, "status:", order.status);

    console.log("[Webhook] channelFromPayload:", channelFromPayload, "| resolvedBank:", resolvedBank, "| vaNumber:", vaNumber);

    let shouldDeliverCertificate = false;

    if (order.status !== "paid") {
      const transactionId = String(
        payload.paymentId ?? payload.tradeNo ?? payload.transactionId ?? "",
      );
      const paidAt = new Date();

      // Claim the paid transition atomically. A duplicate webhook or a second
      // API process must not win the claim and start a second delivery flow.
      const updateFields: Record<string, unknown> = {
        status: "paid",
        paylabsPaidAt: paidAt,
        ...(transactionId ? { paylabsTransactionId: transactionId } : {}),
      };
      if (resolvedBank && (!order.paylabsPaymentType || order.paylabsPaymentType === "H5")) {
        updateFields.paylabsPaymentType = resolvedBank;
      }
      if (vaNumber) {
        updateFields.paylabsVaNumber = vaNumber;
      }

      const [claimedOrder] = await db
        .update(orderAsuransiTable)
        .set(updateFields)
        .where(and(
          eq(orderAsuransiTable.id, order.id),
          not(eq(orderAsuransiTable.status, "paid")),
        ))
        .returning({ id: orderAsuransiTable.id });

      if (!claimedOrder) {
        console.log("[Webhook] Order", order.id, "was already claimed as paid — delivery will reconcile unsent channels");
        shouldDeliverCertificate = true;
      } else {
         console.log("[TRACE] update order success", JSON.stringify({
           orderId: order.id,
           orderCode: order.orderCode ?? null,
           status: "paid",
           callbackPath: "POST /api/paylabs/webhook",
         }, null, 2));
        const syncResult = await syncPaylabsPaidToSupabase(
          order.id,
          paidAt.toISOString(),
          transactionId || null,
          resolvedBank && (!order.paylabsPaymentType || order.paylabsPaymentType === "H5") ? resolvedBank : null,
          vaNumber,
          {
            orderCode: order.orderCode,
            paylabsOrderId: order.paylabsOrderId,
            paylabsMerchantTradeNo: order.paylabsMerchantTradeNo,
          },
        );
        if (!syncResult.matched) {
          console.warn("[Webhook] Supabase payment sync did not match order:", order.id);
        }

        console.log("[Webhook] Order", order.id, "marked as paid. transactionId:", transactionId);

        shouldDeliverCertificate = true;
      }
    } else {
      // A prior webhook/inquiry may have claimed payment before its delivery
      // attempt ran (or delivery may have failed). Reconcile only the channels
      // that are not already marked as sent; the delivery service is idempotent.
      console.log("[Webhook] Order", order.id, "already paid — reconciling certificate delivery");
      shouldDeliverCertificate = true;
    }

    if (shouldDeliverCertificate) {
      try {
        await deliverCertificateAfterPayment(order.id);
      } catch (err) {
        console.error("[Webhook] Gagal kirim sertifikat:", err);
      }
    }

    res.json({ resultCode: "00", resultMsg: "OK" });
  } catch (err) {
    console.error("[Paylabs webhook] Error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /api/payments/:orderId/status ─────────────────────────────────────────

router.get("/payments/:orderId/status", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.orderId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID tidak valid." });
      return;
    }

    const [order] = await db
      .select()
      .from(orderAsuransiTable)
      .where(eq(orderAsuransiTable.id, id));

    if (!order) {
      res.status(404).json({ error: "Order tidak ditemukan." });
      return;
    }

    res.json({
      paymentId: order.id,
      orderId: order.id,
      status: order.status,
      paymentStatus: order.status,
      amount: Number(order.harga ?? order.total),
      paidAt: order.paylabsPaidAt?.toISOString() ?? null,
      provider: "paylabs",
      providerReference: order.paylabsOrderId ?? null,
      transactionId: order.paylabsTransactionId ?? null,
      paymentType: order.paylabsPaymentType ?? null,
      certificateNumber: order.certificateNumber ?? null,
      orderCode: order.orderCode ?? null,
      notifications: {
        emailSent: Boolean(order.emailSentAt),
        whatsappSent: Boolean(order.whatsappSentAt),
        certificateStored: order.certificateStorageStatus === "stored",
        emailStatus: order.emailDeliveryStatus,
        whatsappStatus: order.whatsappDeliveryStatus,
        lastError: order.notificationLastError ?? null,
      },
    });
  } catch (err) {
    console.error("[payments/status] Error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// Delivery retries are exposed by the staff-only route in send-certificate.ts.

// ── POST /api/payments/:orderId/check-status ──────────────────────────────────

router.post("/payments/:orderId/check-status", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.orderId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID tidak valid." });
      return;
    }

    const [order] = await db
      .select()
      .from(orderAsuransiTable)
      .where(eq(orderAsuransiTable.id, id));

    if (!order) {
      res.status(404).json({ error: "Order tidak ditemukan." });
      return;
    }

    if (order.status === "paid") {
      try {
        // Manual status checks also repair a paid order whose notification
        // delivery was skipped or failed after payment was confirmed.
        await deliverCertificateAfterPayment(order.id);
      } catch (certErr) {
        console.error("[check-status] Gagal rekonsiliasi sertifikat:", certErr);
      }
      res.json({
        paid: true,
        status: "paid",
        message: "Pembayaran sudah terkonfirmasi.",
        paidAt: order.paylabsPaidAt?.toISOString() ?? null,
      });
      return;
    }

    const merchantTradeNo = order.paylabsMerchantTradeNo ?? order.paylabsOrderId;
    const paymentType = order.paylabsPaymentType;

    if (!merchantTradeNo || !paymentType) {
      res.status(400).json({
        paid: false,
        status: "pending",
        message: "Pembayaran belum dibuat. Silakan pilih metode pembayaran terlebih dahulu.",
      });
      return;
    }

    console.log(`[check-status] Inquiring orderId=${id} merchantTradeNo=${merchantTradeNo} type=${paymentType}`);

    const paylabsConfig = await loadPaylabsConfig();
    const result = await inquirePayment(merchantTradeNo, paymentType, paylabsConfig);

    console.log(`[check-status] Inquiry result:`, JSON.stringify(result));

    if (result.isPaid) {
      const paidAt = result.paidAt ? new Date(result.paidAt) : new Date();
      const [claimedOrder] = await db
        .update(orderAsuransiTable)
        .set({
          status: "paid",
          paylabsPaidAt: paidAt,
          ...(result.transactionId ? { paylabsTransactionId: result.transactionId } : {}),
        })
        .where(and(
          eq(orderAsuransiTable.id, order.id),
          not(eq(orderAsuransiTable.status, "paid")),
        ))
        .returning({ id: orderAsuransiTable.id });

      if (claimedOrder) {
        console.log("[TRACE] update order success", JSON.stringify({
          orderId: order.id,
          orderCode: order.orderCode ?? null,
          status: "paid",
          callbackPath: "POST /api/payments/:orderId/check-status",
        }, null, 2));
        const syncResult = await syncPaylabsPaidToSupabase(
          order.id,
          paidAt.toISOString(),
          result.transactionId ?? null,
          result.bankCode ?? null,
          result.vaNumber ?? null,
          {
            orderCode: order.orderCode,
            paylabsOrderId: order.paylabsOrderId,
            paylabsMerchantTradeNo: order.paylabsMerchantTradeNo,
          },
        );
        if (!syncResult.matched) {
          console.warn("[check-status] Supabase payment sync did not match order:", order.id);
        }

        try {
          await deliverCertificateAfterPayment(order.id);
        } catch (certErr) {
          console.error("[check-status] Gagal kirim sertifikat:", certErr);
        }
      }

      res.json({
        paid: true,
        status: "paid",
        message: "Pembayaran terkonfirmasi.",
        paidAt: result.paidAt ?? new Date().toISOString(),
      });
      return;
    }

    res.json({
      paid: false,
      status: "pending",
      message: "Pembayaran belum terkonfirmasi, silakan tunggu beberapa saat.",
      inquiryStatus: result.status,
      inquiryError: result.error,
    });
  } catch (err) {
    console.error("[check-status] Error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Simulate paid (dev only) ──────────────────────────────────────────────────

router.post("/orders/:id/simulate-paid", async (req, res): Promise<void> => {
  // FIX #2 — Block in production. This endpoint is purely for testing.
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "Endpoint ini hanya tersedia di lingkungan development." });
    return;
  }

  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID tidak valid." });
      return;
    }

    const [order] = await db
      .select()
      .from(orderAsuransiTable)
      .where(eq(orderAsuransiTable.id, id));

    if (!order) {
      res.status(404).json({ error: "Order tidak ditemukan." });
      return;
    }

    if (order.status === "paid") {
      res.json({
        success: true,
        alreadyPaid: true,
        certificateNumber: order.certificateNumber,
      });
      return;
    }

    const simPaidAt = new Date();
    await db
      .update(orderAsuransiTable)
      .set({ status: "paid", paylabsPaidAt: simPaidAt })
      .where(eq(orderAsuransiTable.id, id));
    syncPaylabsPaidToSupabase(id, simPaidAt.toISOString(), null).catch(() => {});

    try {
      await deliverCertificateAfterPayment(id);
    } catch (certErr) {
      console.error("[simulate-paid] Gagal kirim sertifikat:", certErr);
    }

    const [updated] = await db
      .select()
      .from(orderAsuransiTable)
      .where(eq(orderAsuransiTable.id, id));

    res.json({
      success: true,
      status: "paid",
      certificateNumber: updated?.certificateNumber ?? null,
    });
  } catch (err) {
    console.error("[simulate-paid] Error:", err);
    res.status(500).json({ error: "Gagal memproses simulasi pembayaran." });
  }
});

// ── Merchant public key ───────────────────────────────────────────────────────

router.get("/paylabs/merchant-pubkey", async (_req, res): Promise<void> => {
  try {
    const cfg = await loadPaylabsConfig();
    const pubKey = getMerchantPublicKey(cfg);
    res.json({
      merchantPublicKey: pubKey,
      merchantId: cfg?.merchantId ?? process.env.PAYLABS_MERCHANT_ID ?? "",
      isSandbox: cfg?.isSandbox ?? true,
      keySource: cfg ? "DB" : "env",
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

export default router;
