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

/** yyyyMMddHHmmss in UTC */
function makeTimestamp(): string {
  const now = new Date();
  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
}

function normaliseKey(key: string, type: "PUBLIC" | "PRIVATE"): string {
  key = key.trim();
  const header = `-----BEGIN ${type} KEY-----`;
  const footer = `-----END ${type} KEY-----`;
  if (key.startsWith(header)) return key;
  // Raw base64 → wrap as PEM
  const body = key.replace(/\s+/g, "").match(/.{1,64}/g)!.join("\n");
  return `${header}\n${body}\n${footer}`;
}

function sign(privateKeyPem: string, timestamp: string, body: string): string {
  const pem = normaliseKey(privateKeyPem, "PRIVATE");
  const msg = `${timestamp}\r\n${body}`;
  const s = crypto.createSign("RSA-SHA256");
  s.update(msg, "utf8");
  return s.sign(pem, "base64");
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
  const signature = sign(config.privateKey, timestamp, bodyStr);
  const url       = `${config.baseUrl}${endpoint}`;

  if (config.debugMode) {
    logger.debug({ url, timestamp, body }, "[paylabs] outgoing request");
  }

  let httpStatus = 0;
  try {
    const res = await fetch(url, {
      method : "POST",
      headers: {
        "Content-Type" : "application/json",
        "X-MERCHANT-ID": config.merchantId,
        "X-TIMESTAMP"  : timestamp,
        "X-SIGNATURE"  : signature,
      },
      body: bodyStr,
    });

    httpStatus = res.status;
    const data = await res.json().catch(() => ({})) as T & { errCode?: string; errMsg?: string };

    if (config.debugMode) {
      logger.debug({ httpStatus, data }, "[paylabs] response");
    }

    const ok = res.ok && (!data.errCode || data.errCode === "0" || data.errCode === "SUCCESS");
    return { ok, httpStatus, data, errCode: data.errCode, errMsg: data.errMsg };
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
  phoneNo?: string;
  notifyUrl: string;
  productName: string;
  productInfo?: ProductInfo[];
}

export interface CreateVaRequest {
  requestId: string;
  merchantTradeNo: string;
  vaCode: string;          // BRI | BNI | BCA | MANDIRI | PERMATA | CIMB | BSI | BTN | MUAMALAT | DANAMON | SINARMAS | INA
  amount: number;
  phoneNo?: string;
  billStartDate?: string;  // ISO8601
  billEndDate?: string;    // ISO8601
  notifyUrl: string;
  productName: string;
  productInfo?: ProductInfo[];
}

export interface CreateEwalletRequest {
  requestId: string;
  merchantTradeNo: string;
  ewalletCode: string;     // OVO | DANA | SHOPEEPAY | LINKAJA | GOPAY
  amount: number;
  phoneNo?: string;
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
  unit: string;
  description?: string;
}

export function createQris(req: CreateQrisRequest, cfg?: PaylabsConfig) {
  return callPaylabs("/payment/createQRIS", {
    ...req,
    merchantId: (cfg ?? getPaylabsConfig()).merchantId,
    storeId   : (cfg ?? getPaylabsConfig()).storeId,
  }, cfg);
}

export function createVa(req: CreateVaRequest, cfg?: PaylabsConfig) {
  return callPaylabs("/payment/createVA", {
    ...req,
    merchantId: (cfg ?? getPaylabsConfig()).merchantId,
    storeId   : (cfg ?? getPaylabsConfig()).storeId,
  }, cfg);
}

export function createEwallet(req: CreateEwalletRequest, cfg?: PaylabsConfig) {
  return callPaylabs("/payment/createEwallet", {
    ...req,
    merchantId: (cfg ?? getPaylabsConfig()).merchantId,
    storeId   : (cfg ?? getPaylabsConfig()).storeId,
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

const METHOD_TO_VA: Record<string, string> = {
  bri: "BRI", bni: "BNI", bca: "BCA", mandiri: "MANDIRI",
  permata: "PERMATA", cimb: "CIMB", bsi: "BSI", btn: "BTN",
  muamalat: "MUAMALAT", danamon: "DANAMON", sinarmas: "SINARMAS", ina: "INA",
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
