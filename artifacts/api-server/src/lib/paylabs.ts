/**
 * Paylabs Payment Gateway — API v2 client
 *
 * Signing algorithm : RSA-SHA256
 *   message  = X-TIMESTAMP + "\r\n" + requestBodyJSON
 *   signature = base64( RSA_SHA256_SIGN( merchantPrivateKey, message ) )
 *
 * Verification (webhook):
 *   message  = X-TIMESTAMP header + "\r\n" + notificationBodyJSON
 *   verify   = RSA_SHA256_VERIFY( paylabsPublicKey, message, base64sig )
 */

import crypto from "crypto";
import { logger } from "./logger";

// ─── Config ──────────────────────────────────────────────────────────────────

const SANDBOX_BASE = "https://pay.paylabs.co.id/sandbox";
const PROD_BASE    = "https://pay.paylabs.co.id";

export interface PaylabsConfig {
  sandboxMode: boolean;
  storeId: string;
  merchantId: string;
  privateKey: string;
  paylabsPublicKey: string;
  baseUrl: string;
  debugMode: boolean;
}

/** Env-var only fallback (used when DB is unavailable) */
export function getPaylabsConfig(): PaylabsConfig {
  const sandboxMode = process.env.PAYLABS_SANDBOX_MODE !== "false";

  const merchantId = sandboxMode
    ? (process.env.PAYLABS_SANDBOX_MERCHANT_ID || "")
    : (process.env.PAYLABS_PROD_MERCHANT_ID    || "");

  const privateKey = sandboxMode
    ? (process.env.PAYLABS_SANDBOX_PRIVATE_KEY || "")
    : (process.env.PAYLABS_PROD_PRIVATE_KEY    || "");

  const paylabsPublicKey = sandboxMode
    ? (process.env.PAYLABS_SANDBOX_PUBLIC_KEY  || "")
    : (process.env.PAYLABS_PROD_PUBLIC_KEY     || "");

  return {
    sandboxMode,
    storeId: process.env.PAYLABS_STORE_ID || "",
    merchantId,
    privateKey,
    paylabsPublicKey,
    baseUrl: sandboxMode ? SANDBOX_BASE : PROD_BASE,
    debugMode: false,
  };
}

/** Load Paylabs config from DB (paylabs_settings table), fall back to env vars */
export async function loadPaylabsConfigFromDb(): Promise<PaylabsConfig> {
  try {
    const { db, paylabsSettingsTable } = await import("@workspace/db");
    const [row] = await db.select().from(paylabsSettingsTable).limit(1);
    if (!row) return getPaylabsConfig();

    const sandboxMode = row.sandboxMode;
    const merchantId = sandboxMode
      ? (row.sandboxMerchantId || process.env.PAYLABS_SANDBOX_MERCHANT_ID || "")
      : (row.prodMerchantId    || process.env.PAYLABS_PROD_MERCHANT_ID    || "");
    const privateKey = sandboxMode
      ? (row.sandboxPrivateKey || process.env.PAYLABS_SANDBOX_PRIVATE_KEY || "")
      : (row.prodPrivateKey    || process.env.PAYLABS_PROD_PRIVATE_KEY    || "");
    const paylabsPublicKey = sandboxMode
      ? (row.sandboxPublicKey  || process.env.PAYLABS_SANDBOX_PUBLIC_KEY  || "")
      : (row.prodPublicKey     || process.env.PAYLABS_PROD_PUBLIC_KEY     || "");
    const storeId = row.storeId || process.env.PAYLABS_STORE_ID || "";

    return {
      sandboxMode,
      storeId,
      merchantId,
      privateKey,
      paylabsPublicKey,
      baseUrl: sandboxMode ? SANDBOX_BASE : PROD_BASE,
      debugMode: row.debugMode,
    };
  } catch (err) {
    logger.warn({ err }, "[paylabs] loadPaylabsConfigFromDb failed, falling back to env");
    return getPaylabsConfig();
  }
}

// ─── Crypto helpers ──────────────────────────────────────────────────────────

/**
 * ISO 8601 timestamp with milliseconds and +07:00 offset (WIB)
 * Required format per Paylabs v4.8.1 docs: 2022-09-16T16:58:47.964+07:00
 */
function makeTimestamp(): string {
  // Build a WIB (+07:00) ISO string
  const now = new Date();
  const wibOffset = 7 * 60; // minutes
  const local = new Date(now.getTime() + wibOffset * 60 * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ms = pad(local.getUTCMilliseconds(), 3);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.${ms}+07:00`
  );
}

function normaliseKey(key: string, type: "PUBLIC" | "PRIVATE"): string {
  key = key.trim();
  // Already a complete PEM block (any header) — return as-is
  if (key.includes("-----BEGIN")) return key;
  // Raw base64 → wrap as PKCS#8 PEM
  const body = key.replace(/\s+/g, "").match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN ${type} KEY-----\n${body}\n-----END ${type} KEY-----`;
}

function sign(privateKeyPem: string, timestamp: string, body: string): string {
  const msg = `${timestamp}\r\n${body}`;

  const trySign = (pem: string): string => {
    const s = crypto.createSign("RSA-SHA256");
    s.update(msg, "utf8");
    return s.sign(pem, "base64");
  };

  const pem = normaliseKey(privateKeyPem, "PRIVATE");

  // If the key was already in a PEM block, just use it directly
  if (privateKeyPem.trim().includes("-----BEGIN")) {
    return trySign(pem);
  }

  // Raw base64 key: try PKCS#8 first, then PKCS#1 (RSA PRIVATE KEY) as fallback
  try {
    return trySign(pem);
  } catch {
    const rawB64 = privateKeyPem.replace(/\s+/g, "").match(/.{1,64}/g)!.join("\n");
    const pkcs1Pem = `-----BEGIN RSA PRIVATE KEY-----\n${rawB64}\n-----END RSA PRIVATE KEY-----`;
    return trySign(pkcs1Pem);
  }
}

export function verifyPaylabsSignature(
  paylabsPublicKeyPem: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  try {
    const pem = normaliseKey(paylabsPublicKeyPem, "PUBLIC");
    const msg = `${timestamp}\r\n${body}`;
    const v = crypto.createVerify("RSA-SHA256");
    v.update(msg, "utf8");
    return v.verify(pem, signature, "base64");
  } catch (err) {
    logger.warn({ err }, "[paylabs] signature verification error");
    return false;
  }
}

// ─── HTTP caller ─────────────────────────────────────────────────────────────

export interface PaylabsResponse<T = Record<string, unknown>> {
  ok: boolean;
  httpStatus: number;
  data: T;
  errCode?: string;
  errMsg?: string;
}

export async function callPaylabs<T = Record<string, unknown>>(
  endpoint: string,
  body: object,
  cfg?: PaylabsConfig,
): Promise<PaylabsResponse<T>> {
  const config = cfg ?? getPaylabsConfig();

  if (!config.merchantId || !config.privateKey) {
    return {
      ok: false,
      httpStatus: 0,
      data: {} as T,
      errCode: "NOT_CONFIGURED",
      errMsg: "Paylabs credentials not configured. Set PAYLABS_*_MERCHANT_ID and PAYLABS_*_PRIVATE_KEY.",
    };
  }

  const bodyStr   = JSON.stringify(body);
  const timestamp = makeTimestamp();
  const url       = `${config.baseUrl}${endpoint}`;

  let signature: string;
  try {
    signature = sign(config.privateKey, timestamp, bodyStr);
  } catch (keyErr) {
    const msg = String(keyErr);
    logger.error({ keyErr, merchantId: config.merchantId }, "[paylabs] RSA signing failed — check private key format");
    return {
      ok: false, httpStatus: 0, data: {} as T,
      errCode: "INVALID_PRIVATE_KEY",
      errMsg: `RSA sign error: ${msg}. Pastikan private key di Paylabs Settings berformat PEM atau base64 RSA yang valid.`,
    };
  }

  if (config.debugMode) {
    logger.debug({ url, timestamp, body }, "[paylabs] outgoing request");
  }

  // X-REQUEST-ID must be unique per request (use requestId from body if present, else random)
  const requestId = (body as Record<string, unknown>).requestId as string | undefined
    ?? `req-${Date.now()}`;

  let httpStatus = 0;
  try {
    const res = await fetch(url, {
      method : "POST",
      headers: {
        "Content-Type" : "application/json;charset=utf-8",
        "X-PARTNER-ID" : config.merchantId,   // v4.8.1: X-PARTNER-ID (not X-MERCHANT-ID)
        "X-REQUEST-ID" : requestId,            // v4.8.1: required unique request ID
        "X-TIMESTAMP"  : timestamp,
        "X-SIGNATURE"  : signature,
      },
      body: bodyStr,
    });

    httpStatus = res.status;
    const raw = await res.text().catch(() => "");
    let data: T & Record<string, unknown> = {} as T & Record<string, unknown>;
    try { data = JSON.parse(raw); } catch { /* non-JSON response */ }

    if (config.debugMode || !res.ok) {
      logger.info({ httpStatus, url, data, rawSnippet: raw.slice(0, 500) }, "[paylabs] response");
    }

    // Paylabs v4.8.1: errCode (0 = success), errCodeDes = error description
    const errCode: string | undefined =
      (data as any).errCode   ?? (data as any).errcode   ??
      (data as any).errorCode ?? (data as any).error_code ??
      (data as any).responseCode ?? undefined;

    const errMsg: string | undefined =
      (data as any).errCodeDes   ??   // v4.8.1 primary field
      (data as any).errMsg       ??   // fallback (older API versions)
      (data as any).errmsg       ??
      (data as any).errorMessage ?? (data as any).error_message ??
      (data as any).message      ?? (data as any).error    ??
      (data as any).responseMessage ?? undefined;

    const ok = res.ok && (!errCode || errCode === "0" || errCode === "SUCCESS" || errCode === "00");
    return { ok, httpStatus, data, errCode, errMsg };
  } catch (err) {
    logger.error({ err, url }, "[paylabs] request failed");
    return { ok: false, httpStatus, data: {} as T, errCode: "NETWORK_ERROR", errMsg: String(err) };
  }
}

// ─── Payment helpers ─────────────────────────────────────────────────────────

export interface CreateQrisRequest {
  requestId: string;
  merchantTradeNo: string;
  amount: number;
  payer?: string;          // v4.8.1: nama pembayar (bukan nomor telepon)
  notifyUrl: string;
  productName: string;
  productInfo?: ProductInfo[];
}

export interface CreateVaRequest {
  requestId: string;
  merchantTradeNo: string;
  paymentType: string;     // v4.8.1: BRIVA | BNIVA | BCAVA | MandiriVA | PermataVA | CIMBVA | BSIVA | BTNVA | MuamalatVA | DanamonVA | SinarmasVA | INAVA
  amount: number;
  payer?: string;          // v4.8.1: nama pembayar (bukan nomor telepon)
  notifyUrl: string;
  productName: string;
  productInfo?: ProductInfo[];
}

export interface CreateEwalletRequest {
  requestId: string;
  merchantTradeNo: string;
  ewalletCode: string;     // OVO | DANA | SHOPEEPAY | LINKAJA | GOPAY
  amount: number;
  payer?: string;          // v4.8.1: nama pembayar
  redirectUrl?: string;
  notifyUrl: string;
  productName: string;
  productInfo?: ProductInfo[];
}

export interface ProductInfo {
  id: string;
  name: string;
  price: number;
  type: string;
  quantity: number;
  url?: string;          // v4.8.1 optional product URL
}

export function createQris(req: CreateQrisRequest, cfg?: PaylabsConfig) {
  const c = cfg ?? getPaylabsConfig();
  return callPaylabs("/payment/createQRIS", {
    requestId      : req.requestId,
    merchantId     : c.merchantId,
    storeId        : c.storeId || undefined,
    paymentType    : "QRIS",
    merchantTradeNo: req.merchantTradeNo,
    amount         : req.amount,
    notifyUrl      : req.notifyUrl,
    payer          : req.payer,
    productName    : req.productName,
    productInfo    : req.productInfo,
  }, cfg);
}

export function createVa(req: CreateVaRequest, cfg?: PaylabsConfig) {
  const c = cfg ?? getPaylabsConfig();
  return callPaylabs("/payment/createVA", {
    requestId      : req.requestId,
    merchantId     : c.merchantId,
    storeId        : c.storeId || undefined,
    paymentType    : req.paymentType,   // e.g. "BRIVA", "BCAVA", "MandiriVA"
    merchantTradeNo: req.merchantTradeNo,
    amount         : req.amount,
    notifyUrl      : req.notifyUrl,
    payer          : req.payer,
    productName    : req.productName,
    productInfo    : req.productInfo,
  }, cfg);
}

export function createEwallet(req: CreateEwalletRequest, cfg?: PaylabsConfig) {
  const c = cfg ?? getPaylabsConfig();
  return callPaylabs("/payment/createEwallet", {
    requestId      : req.requestId,
    merchantId     : c.merchantId,
    storeId        : c.storeId || undefined,
    paymentType    : req.ewalletCode,
    merchantTradeNo: req.merchantTradeNo,
    amount         : req.amount,
    notifyUrl      : req.notifyUrl,
    payer          : req.payer,
    redirectUrl    : req.redirectUrl,
    productName    : req.productName,
    productInfo    : req.productInfo,
  }, cfg);
}

export function statusInquiry(merchantTradeNo: string, cfg?: PaylabsConfig) {
  const config = cfg ?? getPaylabsConfig();
  return callPaylabs("/payment/statusInquiry", {
    requestId      : `inq-${merchantTradeNo}-${Date.now()}`,
    merchantId     : config.merchantId,
    storeId        : config.storeId,
    merchantTradeNo,
  }, cfg);
}

// ─── VA code mapper ───────────────────────────────────────────────────────────

// v4.8.1 paymentType codes for VA (from docs: SinarmasVA,MaybankVA,DanamonVA,BNCVA,BCAVA,INAVA,BNIVA,PermataVA,MuamalatVA,BSIVA,BRIVA,MandiriVA,CIMBVA,NobuVA,KaltimtaraVA,BTNVA)
const METHOD_TO_VA: Record<string, string> = {
  bri      : "BRIVA",
  bni      : "BNIVA",
  bca      : "BCAVA",
  mandiri  : "MandiriVA",
  permata  : "PermataVA",
  cimb     : "CIMBVA",
  bsi      : "BSIVA",
  btn      : "BTNVA",
  muamalat : "MuamalatVA",
  danamon  : "DanamonVA",
  sinarmas : "SinarmasVA",
  ina      : "INAVA",
  maybank  : "MaybankVA",
  bnc      : "BNCVA",
  nobu     : "NobuVA",
  kaltimtara: "KaltimtaraVA",
};

const EWALLET_CODES: Record<string, string> = {
  ovo: "OVO", dana: "DANA", shopeepay: "SHOPEEPAY",
  linkaja: "LINKAJA", gopay: "GOPAY",
};

export function resolvePaymentMethod(method: string): {
  type: "qris" | "va" | "ewallet" | "unknown";
  code?: string;
} {
  const m = method.toLowerCase();
  if (m === "qris" || m === "paylabs") return { type: "qris" };
  if (METHOD_TO_VA[m]) return { type: "va", code: METHOD_TO_VA[m] };
  if (EWALLET_CODES[m]) return { type: "ewallet", code: EWALLET_CODES[m] };
  return { type: "unknown" };
}
