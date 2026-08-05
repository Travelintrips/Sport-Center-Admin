/**
 * Paylabs Payment Gateway — API v4.8.1 client
 *
 * Signing algorithm (v4.8.1):
 *   minifiedBody = JSON.stringify(body) stripped of \n\r\t
 *   bodyHash     = lowercase( SHA256Hex( minifiedBody ) )
 *   stringToSign = "POST:" + endpoint + ":" + bodyHash + ":" + X-TIMESTAMP
 *   X-SIGNATURE  = Base64( SHA256withRSA( stringToSign, merchantPrivateKey ) )
 *
 * Verification (webhook — same algorithm):
 *   stringToSign = "POST:" + endpoint + ":" + bodyHash + ":" + X-TIMESTAMP
 *   valid        = SHA256withRSA_VERIFY( paylabsPublicKey, stringToSign, base64sig )
 */

import crypto from "crypto";
import { logger } from "./logger";

// ─── Config ──────────────────────────────────────────────────────────────────

// v4.8.1: sandbox and production share the same base domain;
// sandbox is distinguished by using test merchant credentials, not a /sandbox prefix.
const SANDBOX_BASE = "https://sit-pay.paylabs.co.id";
const PROD_BASE    = "https://pay.paylabs.co.id";

export interface PaylabsConfig {
  sandboxMode: boolean;
  storeId?: string;          // optional — omitted from payload when not configured
  merchantId: string;
  privateKey: string;
  paylabsPublicKey: string;
  baseUrl: string;
  debugMode: boolean;
}

// ─── Store ID helper ──────────────────────────────────────────────────────────

/**
 * Normalize and validate an optional Paylabs Store ID.
 *
 * Rules:
 *   - undefined / null / blank → return undefined (omit from payload)
 *   - length 1–5 or 33+       → throw (invalid)
 *   - length 6–32             → return trimmed value
 *
 * Use conditional spread in every payload builder:
 *   ...(normalizeOptionalPaylabsStoreId(cfg.storeId) ? { storeId: ... } : {})
 */
export function normalizeOptionalPaylabsStoreId(value?: string | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length < 6 || normalized.length > 32) {
    throw new Error(
      `Paylabs Store ID must contain between 6 and 32 characters (got ${normalized.length})`
    );
  }
  return normalized;
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

  let storeId: string | undefined;
  try {
    storeId = normalizeOptionalPaylabsStoreId(process.env.PAYLABS_STORE_ID);
  } catch (e) {
    logger.warn({ err: String(e) }, "[paylabs] PAYLABS_STORE_ID env var invalid — omitting from requests");
    storeId = undefined;
  }

  return {
    sandboxMode,
    storeId,
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
    // DB takes priority over env vars — admin panel is the source of truth.
    // Env vars serve as seed/fallback only when the DB field is null/undefined.
    // EXCEPTION: paylabsPublicKey — if DB is explicitly "" (empty string, not null),
    // skip env var fallback. This lets admin disable signature verification for sandbox
    // testing without touching secrets. Use ?? (null-coalescing) instead of ||.
    const merchantId = sandboxMode
      ? (row.sandboxMerchantId || process.env.PAYLABS_SANDBOX_MERCHANT_ID || "")
      : (row.prodMerchantId    || process.env.PAYLABS_PROD_MERCHANT_ID    || "");
    const privateKey = sandboxMode
      ? (row.sandboxPrivateKey || process.env.PAYLABS_SANDBOX_PRIVATE_KEY || "")
      : (row.prodPrivateKey    || process.env.PAYLABS_PROD_PRIVATE_KEY    || "");
    const paylabsPublicKey = sandboxMode
      ? (row.sandboxPublicKey  ?? process.env.PAYLABS_SANDBOX_PUBLIC_KEY  ?? "")
      : (row.prodPublicKey     ?? process.env.PAYLABS_PROD_PUBLIC_KEY     ?? "");
    let storeId: string | undefined;
    try {
      storeId = normalizeOptionalPaylabsStoreId(row.storeId ?? process.env.PAYLABS_STORE_ID);
    } catch (e) {
      logger.warn({ err: String(e) }, "[paylabs] storeId in DB/env is invalid length — omitting from requests");
      storeId = undefined;
    }

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
  // Handle literal \n escape sequences (common when pasting from secret managers)
  key = key.trim().replace(/\\n/g, "\n").replace(/\\r/g, "");
  // Already a complete PEM block — re-normalize line widths and return
  if (key.includes("-----BEGIN")) {
    const body = key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    if (!body) throw new Error(`Empty PEM body for ${type} key`);
    const chunked = (body.match(/.{1,64}/g) ?? []).join("\n");
    // Preserve original header type (PUBLIC KEY, RSA PUBLIC KEY, etc.)
    const header = key.match(/-----BEGIN ([^-]+)-----/)?.[1] ?? `${type} KEY`;
    return `-----BEGIN ${header}-----\n${chunked}\n-----END ${header}-----`;
  }
  // Raw base64 → wrap as PEM
  const body = key.replace(/\s+/g, "");
  if (!body) throw new Error(`Empty raw base64 for ${type} key`);
  const chunked = body.match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN ${type} KEY-----\n${chunked}\n-----END ${type} KEY-----`;
}

/**
 * Normalize a PEM public key received from the Paylabs dashboard (sandbox or production).
 * Accepts:
 *   - Full PEM with -----BEGIN PUBLIC KEY----- header
 *   - Literal \n escape sequences (from secret managers / copy-paste)
 *   - Raw base64 without header
 * Returns well-formed PEM or empty string if input is blank.
 * NOTE: This is the Paylabs-owned public key used for VERIFYING their webhook signatures.
 *       Do NOT confuse with the merchant public key (derived from merchant private key).
 */
export function normalizePaylabsPublicKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return normaliseKey(trimmed, "PUBLIC");
  } catch {
    return ""; // reject malformed input
  }
}

/**
 * Build the canonical string-to-sign per Paylabs v4.8.1:
 *   POST:<endpoint>:<lowercase(sha256hex(minifiedBody))>:<timestamp>
 */
function buildStringToSign(
  method: string,
  endpoint: string,
  minifiedBody: string,
  timestamp: string,
): string {
  const bodyHash = crypto
    .createHash("sha256")
    .update(minifiedBody, "utf8")
    .digest("hex")
    .toLowerCase();
  return `${method}:${endpoint}:${bodyHash}:${timestamp}`;
}

/** Minify JSON body — strip \n \r \t per Paylabs spec */
function minifyBody(body: string): string {
  return body.replace(/[\n\r\t]/g, "");
}

function sign(
  privateKeyPem: string,
  timestamp: string,
  bodyStr: string,
  endpoint: string,
  method = "POST",
): string {
  const minified     = minifyBody(bodyStr);
  const stringToSign = buildStringToSign(method, endpoint, minified, timestamp);

  const doSign = (key: crypto.KeyObject): string => {
    const s = crypto.createSign("RSA-SHA256");
    s.update(stringToSign, "utf8");
    return s.sign(key, "base64");
  };

  // Normalise key: convert literal \n escape sequences to real newlines (common DB storage issue)
  const raw = privateKeyPem
    .trim()
    .replace(/\\n/g, "\n")   // literal \n → real newline
    .replace(/\\r/g, "");    // literal \r → remove

  // Strip all PEM headers/footers to get raw base64 (no spaces)
  const base64 = raw.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  // Re-chunk into 64-char lines for PEM body
  const body64 = (base64.match(/.{1,64}/g) ?? [base64]).join("\n");

  const pkcs8Pem   = `-----BEGIN PRIVATE KEY-----\n${body64}\n-----END PRIVATE KEY-----`;
  const pkcs1Pem   = `-----BEGIN RSA PRIVATE KEY-----\n${body64}\n-----END RSA PRIVATE KEY-----`;
  const derBuf     = Buffer.from(base64, "base64");

  const attempts: Array<[string, () => crypto.KeyObject]> = [
    // 1. Explicit PKCS#8 PEM with format hint (most compatible with OpenSSL 3)
    ["pkcs8-pem-explicit",  () => crypto.createPrivateKey({ key: pkcs8Pem,  format: "pem", type: "pkcs8" })],
    // 2. Explicit PKCS#1 PEM with format hint (OpenSSL 3 requires explicit type for RSA PEM)
    ["pkcs1-pem-explicit",  () => crypto.createPrivateKey({ key: pkcs1Pem,  format: "pem", type: "pkcs1" })],
    // 3. Auto-detect from raw input (works if key already has correct PEM header)
    ...(raw.includes("-----BEGIN") ? [["raw-auto", () => crypto.createPrivateKey(raw)] as [string, () => crypto.KeyObject]] : []),
    // 4. Auto-detect PKCS#8 PEM
    ["pkcs8-pem-auto",      () => crypto.createPrivateKey(pkcs8Pem)],
    // 5. Auto-detect PKCS#1 PEM
    ["pkcs1-pem-auto",      () => crypto.createPrivateKey(pkcs1Pem)],
    // 6. DER — PKCS#8
    ["pkcs8-der",           () => crypto.createPrivateKey({ key: derBuf, format: "der", type: "pkcs8" })],
    // 7. DER — PKCS#1
    ["pkcs1-der",           () => crypto.createPrivateKey({ key: derBuf, format: "der", type: "pkcs1" })],
  ];

  const errors: string[] = [];
  for (const [label, attempt] of attempts) {
    try {
      const keyObj = attempt();
      return doSign(keyObj);
    } catch (e) {
      errors.push(`[${label}] ${String(e).split("\n")[0]}`);
    }
  }

  throw new Error(
    `RSA signing failed — semua format kunci dicoba tapi gagal. ` +
    `Pastikan private key PKCS#8 atau PKCS#1 RSA 2048-bit (PEM atau base64). ` +
    `Detail: ${errors.join(" | ")}`,
  );
}

export function verifyPaylabsSignature(
  paylabsPublicKeyPem: string,
  timestamp: string,
  bodyStr: string,
  signature: string,
  endpoint = "/api/paylabs/webhook",
  method   = "POST",
): boolean {
  try {
    const pem          = normaliseKey(paylabsPublicKeyPem, "PUBLIC");
    const minified     = minifyBody(bodyStr);
    const stringToSign = buildStringToSign(method, endpoint, minified, timestamp);
    const v = crypto.createVerify("RSA-SHA256");
    v.update(stringToSign, "utf8");
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
      errMsg: `Paylabs credentials not configured. merchantId=${config.merchantId ? "SET" : "EMPTY"}, privateKey=${config.privateKey ? "SET" : "EMPTY"}`,
    };
  }

  const bodyStr   = JSON.stringify(body);
  const timestamp = makeTimestamp();
  const url       = `${config.baseUrl}${endpoint}`;

  // Build the string-to-sign so we can log it for diagnostics
  const minifiedForLog = minifyBody(bodyStr);
  const bodyHashForLog = crypto.createHash("sha256").update(minifiedForLog, "utf8").digest("hex").toLowerCase();
  const stringToSignForLog = `POST:${endpoint}:${bodyHashForLog}:${timestamp}`;

  let signature: string;
  try {
    signature = sign(config.privateKey, timestamp, bodyStr, endpoint);
  } catch (keyErr) {
    const msg = String(keyErr);
    logger.error(
      { sandboxMode: config.sandboxMode, endpoint, errDetail: msg.slice(0, 500) },
      "[paylabs] RSA signing failed — check private key format",
    );
    return {
      ok: false, httpStatus: 0, data: {} as T,
      errCode: "INVALID_PRIVATE_KEY",
      errMsg: `RSA sign error for Paylabs request: ${msg.slice(0, 300)}`,
    };
  }

  // X-REQUEST-ID must be unique per request (use requestId from body if present, else random)
  const requestId = (body as Record<string, unknown>).requestId as string | undefined
    ?? `req-${Date.now()}`;

  const requestHeaders = {
    "Content-Type" : "application/json;charset=utf-8",
    "X-PARTNER-ID" : config.merchantId,
    "X-REQUEST-ID" : requestId,
    "X-TIMESTAMP"  : timestamp,
    "X-SIGNATURE"  : signature,
  };

  logger.info(
    { url, timestamp, endpoint, stringToSign: stringToSignForLog },
    "[paylabs] outgoing request",
  );

  let httpStatus = 0;
  try {
    const res = await fetch(url, {
      method : "POST",
      headers: requestHeaders,
      body: bodyStr,
    });

    httpStatus = res.status;
    const raw = await res.text().catch(() => "");
    const contentType = res.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json") || (raw.trimStart().startsWith("{") || raw.trimStart().startsWith("["));

    let data: T & Record<string, unknown> = {} as T & Record<string, unknown>;
    let jsonParseOk = false;
    if (isJson) {
      try { data = JSON.parse(raw); jsonParseOk = true; } catch { /* non-JSON response */ }
    }

    // ── PAYLABS DEBUG LOG ────────────────────────────────────────────────────
    console.log("=== [PAYLABS] RESPONSE ===");
    console.log("HTTP Status  :", httpStatus);
    console.log("Raw response :", raw.slice(0, 1000));
    console.log("==========================");
    // ────────────────────────────────────────────────────────────────────────

    if (config.debugMode || !res.ok) {
      logger.info({ httpStatus, url, data, rawSnippet: raw.slice(0, 500) }, "[paylabs] response");
    }

    // Always log when response is not OK — helps diagnose field-name mismatches
    if (!res.ok || config.debugMode) {
      logger.warn({ httpStatus, url, contentType, rawSnippet: raw.slice(0, 800), jsonParseOk }, "[paylabs] non-OK or debug response");
    }

    // Paylabs v4.8.1: errCode (0 = success), errCodeDes = error description
    // We cast broadly to catch any possible field casing/naming variant.
    const d = data as Record<string, any>;
    const errCode: string | undefined =
      d.errCode   ?? d.errcode    ?? d.ErrCode   ??
      d.errorCode ?? d.error_code ?? d.ErrorCode ??
      d.responseCode ?? d.code ?? d.status_code  ?? undefined;

    let errMsg: string | undefined =
      d.errCodeDes    ??   // v4.8.1 primary
      d.errMsg        ??   // older versions
      d.errmsg        ?? d.ErrMsg       ??
      d.errorMessage  ?? d.error_message ?? d.ErrorMessage ??
      d.description   ?? d.desc        ??
      d.message       ?? d.Message     ??
      d.error         ?? d.Error       ??
      d.responseMessage ?? d.reason    ??
      d.detail        ?? d.details     ?? undefined;

    // Non-JSON response (HTML error page etc.)
    if (!res.ok && !jsonParseOk) {
      const httpDesc =
        httpStatus === 404 ? "Endpoint tidak ditemukan (HTTP 404)" :
        httpStatus === 401 ? "Autentikasi gagal — cek Merchant ID & Private Key (HTTP 401)" :
        httpStatus === 403 ? "Akses ditolak (HTTP 403)" :
        httpStatus === 0   ? "Tidak dapat terhubung ke server Paylabs" :
        `HTTP ${httpStatus}`;
      errMsg = `${httpDesc}`;
    }

    // JSON response but no recognisable error fields — show raw snippet so it's debuggable
    if (!errMsg && !errCode && !res.ok) {
      const snippet = raw.slice(0, 200);
      errMsg = `HTTP ${httpStatus} — respons tidak dikenali dari Paylabs: ${snippet}`;
    }

    // Even when ok, if errMsg is still undefined fall back to empty string (never "undefined")
    const finalErrMsg = errMsg ?? (errCode && errCode !== "0" && errCode !== "00" ? `Paylabs errCode: ${errCode}` : undefined);

    const ok = res.ok && (!errCode || errCode === "0" || errCode === "SUCCESS" || errCode === "00");
    return { ok, httpStatus, data, errCode, errMsg: finalErrMsg };
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

/** Format amount as Decimal(12,2) string per Paylabs v4.8.1 docs */
function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

export function createQris(req: CreateQrisRequest, cfg?: PaylabsConfig) {
  const c = cfg ?? getPaylabsConfig();
  // v4.8.1 endpoint: POST /payment/v2.3/qris/create
  return callPaylabs("/payment/v2.3/qris/create", {
    requestId      : req.requestId,
    merchantId     : c.merchantId,
    ...(c.storeId ? { storeId: c.storeId } : {}),
    paymentType    : "QRIS",
    merchantTradeNo: req.merchantTradeNo,
    amount         : formatAmount(req.amount),
    notifyUrl      : req.notifyUrl,
    payer          : req.payer,
    productName    : req.productName,
    productInfo    : req.productInfo,
  }, cfg);
}

export function createVa(req: CreateVaRequest, cfg?: PaylabsConfig) {
  const c = cfg ?? getPaylabsConfig();
  // v4.8.1 endpoint: POST /payment/v2.3/va/create
  return callPaylabs("/payment/v2.3/va/create", {
    requestId      : req.requestId,
    merchantId     : c.merchantId,
    ...(c.storeId ? { storeId: c.storeId } : {}),
    paymentType    : req.paymentType,   // e.g. "BRIVA", "BCAVA", "MandiriVA"
    merchantTradeNo: req.merchantTradeNo,
    amount         : formatAmount(req.amount),
    notifyUrl      : req.notifyUrl,
    payer          : req.payer,
    productName    : req.productName,
    productInfo    : req.productInfo,
  }, cfg);
}

export function createEwallet(req: CreateEwalletRequest, cfg?: PaylabsConfig) {
  const c = cfg ?? getPaylabsConfig();
  // v4.8.1 endpoint: POST /payment/v2.3/ewallet/create
  return callPaylabs("/payment/v2.3/ewallet/create", {
    requestId      : req.requestId,
    merchantId     : c.merchantId,
    ...(c.storeId ? { storeId: c.storeId } : {}),
    paymentType    : req.ewalletCode,
    merchantTradeNo: req.merchantTradeNo,
    amount         : formatAmount(req.amount),
    notifyUrl      : req.notifyUrl,
    payer          : req.payer,
    redirectUrl    : req.redirectUrl,
    productName    : req.productName,
    productInfo    : req.productInfo,
  }, cfg);
}

export function statusInquiry(merchantTradeNo: string, cfg?: PaylabsConfig) {
  const config = cfg ?? getPaylabsConfig();
  // v4.8.1 endpoint: POST /payment/v2.3/va/inquiry (try va inquiry; fallback in route)
  return callPaylabs("/payment/v2.3/va/inquiry", {
    requestId      : `inq-${merchantTradeNo}-${Date.now()}`,
    merchantId     : config.merchantId,
    ...(config.storeId ? { storeId: config.storeId } : {}),
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

// ─── Centralised status mapper (Phase 4) ─────────────────────────────────────

/**
 * Map raw Paylabs status string to our internal enum.
 * Paylabs numeric codes (v4.8.1):
 *   01 → PENDING   02 → SUCCESS   09 → FAILED
 * Never silently map an unknown status to SUCCESS.
 */
export type PaylabsInternalStatus = "PENDING" | "SUCCESS" | "FAILED" | "UNKNOWN";

export function mapPaylabsStatus(rawStatus: string): PaylabsInternalStatus {
  switch (String(rawStatus).trim().toUpperCase()) {
    case "01": return "PENDING";
    case "1":  return "PENDING";
    case "02": return "SUCCESS";
    case "2":  return "SUCCESS";
    case "09": return "FAILED";
    case "9":  return "FAILED";
    // String aliases that some Paylabs sandbox responses use.
    case "SUCCESS":
    case "PAID":
    case "SUCCEEDED":
    case "SETTLED":
    case "COMPLETE":
    case "COMPLETED":
    case "PAYMENT_SUCCESS":
    case "TRADE_SUCCESS": return "SUCCESS";
    case "FAILED":
    case "CANCELLED":
    case "EXPIRED":  return "FAILED";
    case "PENDING":
    case "CREATED":
    case "WAITING":  return "PENDING";
    default:         return "UNKNOWN";
  }
}
