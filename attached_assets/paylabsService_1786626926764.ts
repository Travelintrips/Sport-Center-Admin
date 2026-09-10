import crypto from "crypto";
import axios from "axios";

const SANDBOX_BASE = "https://sit-pay.paylabs.co.id";
const PRODUCTION_BASE = "https://pay.paylabs.co.id";

/** Kredensial Paylabs yang bisa dioverride dari DB (admin dashboard). */
export interface PaylabsConfig {
  merchantId: string;
  privateKey: string;
  publicKey: string;
  isSandbox: boolean;
  storeId?: string;
}

function getBaseUrl(cfg?: PaylabsConfig) {
  if (cfg) return cfg.isSandbox ? SANDBOX_BASE : PRODUCTION_BASE;
  return process.env.PAYLABS_ENV === "production"
    ? PRODUCTION_BASE
    : SANDBOX_BASE;
}

function getMerchantId(cfg?: PaylabsConfig) {
  if (cfg?.merchantId) return cfg.merchantId;
  const id = process.env.PAYLABS_MERCHANT_ID;
  if (!id) throw new Error("PAYLABS_MERCHANT_ID tidak dikonfigurasi.");
  return id;
}

/**
 * Normalize PEM key — handles:
 * - literal \n in env var
 * - missing newlines (flat string)
 * - 4-dash header (----BEGIN instead of -----BEGIN)
 * - spaces instead of newlines in key body
 */
function normalizePem(raw: string, defaultType = "PUBLIC KEY"): string {
  let s = raw.replace(/\\n/g, "\n").trim();

  // Extract using flexible regex (3-5 dashes, type may have spaces around)
  const m = s.match(
    /(-{3,5})\s*BEGIN\s+([^-]+?)\s*-{3,5}([\s\S]+?)-{3,5}\s*END\s+[^-]+?\s*-{3,5}/,
  );
  if (m) {
    const type = m[2].trim();
    const body = m[3].replace(/\s+/g, "");
    const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
    return `-----BEGIN ${type}-----\n${wrapped}\n-----END ${type}-----`;
  }

  // No header — treat as raw base64
  const body = s.replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${defaultType}-----\n${wrapped}\n-----END ${defaultType}-----`;
}

// Mapping env → key:
// PAYLABS_PRIVATE_KEY env = Merchant Private Key (~1674 chars, RSA PRIVATE KEY header)
// PAYLABS_PUBLIC_KEY env = Paylabs Public Key (~443 chars, PUBLIC KEY header)
function getMerchantPrivateKey(cfg?: PaylabsConfig): string {
  const key = cfg?.privateKey || process.env.PAYLABS_PRIVATE_KEY;
  if (!key)
    throw new Error(
      "PAYLABS_PRIVATE_KEY (merchant private key) tidak dikonfigurasi.",
    );
  return normalizePem(key, "RSA PRIVATE KEY");
}

function getPaylabsPublicKey(cfg?: PaylabsConfig): string {
  const key = cfg?.publicKey || process.env.PAYLABS_PUBLIC_KEY;
  if (!key)
    throw new Error(
      "PAYLABS_PUBLIC_KEY (paylabs public key) tidak dikonfigurasi.",
    );
  return normalizePem(key, "PUBLIC KEY");
}

/** Derive merchant public key from private key — use this for Paylabs dashboard upload */
export function getMerchantPublicKey(cfg?: PaylabsConfig): string {
  try {
    const privPem = getMerchantPrivateKey(cfg);
    const privKey = crypto.createPrivateKey(privPem);
    return crypto
      .createPublicKey(privKey)
      .export({ type: "spki", format: "pem" }) as string;
  } catch (e) {
    throw new Error(
      `Cannot derive merchant public key: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function generateRequestId(): string {
  return String(Math.floor(Math.random() * 9999999) + 1111);
}

/**
 * Timestamp format sesuai contoh PHP Paylabs:
 * date("Y-m-d")."T".date("H:i:s.B")."+07:00"
 * dimana .B = Swatch Internet Time (000-999) dipakai sebagai pengganti ms
 * Contoh: 2026-06-03T11:51:23.456+07:00
 */
function buildTimestamp(): string {
  const now = new Date();
  // Konversi ke WIB (UTC+7)
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const YYYY = wib.getUTCFullYear();
  const MM = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const DD = String(wib.getUTCDate()).padStart(2, "0");
  const HH = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  const ss = String(wib.getUTCSeconds()).padStart(2, "0");
  const ms = String(wib.getUTCMilliseconds()).padStart(3, "0");
  return `${YYYY}-${MM}-${DD}T${HH}:${mm}:${ss}.${ms}+07:00`;
}

/**
 * Bangun signature string sesuai PHP Paylabs:
 * "POST:/payment/v2{path}:{sha256_body_lowercase}:{timestamp}"
 * lalu RSA-SHA256 sign dengan merchant private key.
 */
function buildSignature(
  method: string,
  fullPath: string,
  jsonBody: string,
  timestamp: string,
  cfg?: PaylabsConfig,
): string {
  const shaJson = crypto
    .createHash("sha256")
    .update(jsonBody)
    .digest("hex")
    .toLowerCase();
  const signatureBefore = `${method}:${fullPath}:${shaJson}:${timestamp}`;
  const privateKey = getMerchantPrivateKey(cfg);

  // Derive merchant public key for fingerprint logging
  try {
    const privKeyObj = crypto.createPrivateKey(privateKey);
    const pubPem = crypto
      .createPublicKey(privKeyObj)
      .export({ type: "spki", format: "pem" }) as string;
    const pubBase64 = pubPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    const fingerprint = crypto
      .createHash("sha256")
      .update(Buffer.from(pubBase64, "base64"))
      .digest("hex")
      .substring(0, 16);
    console.log(
      `[Paylabs sign] path=${fullPath} | sha256body=${shaJson.substring(0, 16)}... | pubkey_fingerprint=${fingerprint}`,
    );
    console.log(
      `[Paylabs sign] signatureBefore="${signatureBefore.substring(0, 80)}..."`,
    );
  } catch {
    console.log(
      `[Paylabs sign] path=${fullPath} | could not derive pubkey fingerprint`,
    );
  }

  return crypto
    .sign("sha256", Buffer.from(signatureBefore), {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    })
    .toString("base64");
}

/** Verifikasi signature dari Paylabs menggunakan public key mereka */
export function verifyResponseSignature(
  payload: string,
  signature: string,
  cfg?: PaylabsConfig,
): boolean {
  try {
    const publicKey = getPaylabsPublicKey(cfg);
    return crypto.verify(
      "sha256",
      Buffer.from(payload),
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

function buildHeaders(
  requestId: string,
  signature: string,
  timestamp: string,
  cfg?: PaylabsConfig,
) {
  return {
    "Content-Type": "application/json;charset=utf-8",
    "X-TIMESTAMP": timestamp,
    "X-PARTNER-ID": getMerchantId(cfg),
    "X-REQUEST-ID": requestId,
    "X-SIGNATURE": signature,
  };
}

function isMockMode(cfg?: PaylabsConfig): boolean {
  if (process.env.PAYLABS_MOCK === "true") return true;
  // Auto-mock when credentials are not configured
  if (cfg) return !cfg.merchantId || !cfg.privateKey;
  if (!process.env.PAYLABS_MERCHANT_ID || !process.env.PAYLABS_PRIVATE_KEY)
    return true;
  return false;
}

function getAppBaseUrl(): string {
  if (process.env.APP_BASE_URL)
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  // Replit deployment provides REPLIT_DOMAINS (comma-separated list)
  if (process.env.REPLIT_DOMAINS) {
    const first = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    if (first) return `https://${first}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN)
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "https://travelintrips.replit.app";
}

function mockExpiredTime(hoursFromNow = 24): string {
  return new Date(Date.now() + hoursFromNow * 3600 * 1000).toISOString();
}

export interface CreateVAPaymentParams {
  orderId: string;
  amount: number;
  customerName: string;
  email: string;
  phone: string;
  productName: string;
  bankCode?: string;
  expiredTime?: number;
  notifyUrl?: string;
}

export interface PaylabsVAResult {
  success: boolean;
  paylabsOrderId?: string;
  vaNumber?: string;
  bank?: string;
  expiredTime?: string;
  amount?: number;
  error?: string;
  raw?: unknown;
  mock?: boolean;
}

export interface CreateQRISPaymentParams {
  orderId: string;
  amount: number;
  customerName: string;
  email: string;
  phone: string;
  productName: string;
  expiredTime?: number;
  notifyUrl?: string;
}

export interface PaylabsQRISResult {
  success: boolean;
  paylabsOrderId?: string;
  qrCode?: string;
  expiredTime?: string;
  amount?: number;
  error?: string;
  raw?: unknown;
  mock?: boolean;
}

export interface CreateH5PaymentParams {
  orderId: string;
  amount: number;
  customerName: string;
  phone: string;
  productName: string;
  redirectUrl: string;
  notifyUrl?: string;
}

export interface PaylabsH5Result {
  success: boolean;
  paylabsOrderId?: string;
  paymentUrl?: string;
  amount?: number;
  error?: string;
  raw?: unknown;
  mock?: boolean;
}

function isNetworkError(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET"
  );
}

/**
 * Map internal bank code → Paylabs API channel name for outbound VA create request.
 * Paylabs uses camelCase for some channel names (e.g. MandiriVA, DanamonVA).
 */
const OUTBOUND_VA_CHANNEL_MAP: Record<string, string> = {
  MANDIRIVA: "MandiriVA",
  DANAMONVA: "DanamonVA",
  DanamonVA: "DanamonVA",
};

function toPaylabsChannel(code: string): string {
  return OUTBOUND_VA_CHANNEL_MAP[code] ?? code;
}

/**
 * Correct Paylabs SIT v2.1 field names (discovered via trial/error):
 * - merchantTradeNo (NOT referenceNo)
 * - payer (NOT customerName/userName)
 * - email (correct)
 * - productName (correct)
 * - notifyUrl (correct)
 * - storeId (optional)
 * - NO currency, NO phoneNo/customerNo/userName (causes 403 paramInvalid)
 * - NO expiredTime (causes 403 paramInvalid)
 */
export async function createVAPayment(
  params: CreateVAPaymentParams,
  config?: PaylabsConfig,
): Promise<PaylabsVAResult> {
  if (isMockMode(config)) {
    return {
      success: true,
      paylabsOrderId: params.orderId,
      vaNumber: "8808" + String(params.amount).padStart(12, "0"),
      bank: "BSS (Simulasi)",
      expiredTime: mockExpiredTime(24),
      amount: params.amount,
      mock: true,
    };
  }

  const requestId = generateRequestId();
  const merchantId = getMerchantId(config);
  const timestamp = buildTimestamp();
  const notifyUrl =
    params.notifyUrl ?? `${getAppBaseUrl()}/api/paylabs/webhook`;

  const paylabsChannel = params.bankCode
    ? toPaylabsChannel(params.bankCode)
    : undefined;

  const body = {
    merchantId,
    requestId,
    merchantTradeNo: params.orderId,
    ...(paylabsChannel ? { paymentType: paylabsChannel } : {}),
    amount: Math.round(params.amount),
    productName: params.productName,
    payer: params.customerName,
    email: params.email,
    notifyUrl,
  };

  const apiPath = "/payment/v2.1/va/create";
  const jsonBody = JSON.stringify(body);
  let signature: string;
  try {
    signature = buildSignature("POST", apiPath, jsonBody, timestamp, config);
  } catch (err) {
    return {
      success: false,
      error: `RSA sign error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const response = await axios.post(`${getBaseUrl(config)}${apiPath}`, body, {
      headers: buildHeaders(requestId, signature, timestamp, config),
      timeout: 15000,
    });

    const data = response.data as Record<string, unknown>;
    const errCode = String(data.errCode ?? data.resultCode ?? "");
    if (errCode === "0" || errCode === "00" || errCode === "") {
      return {
        success: true,
        paylabsOrderId: String(
          data.paymentId ??
            data.tradeNo ??
            data.merchantTradeNo ??
            params.orderId,
        ),
        vaNumber: String(
          data.vaCode ?? data.virtualAccountNo ?? data.vaNumber ?? "",
        ),
        bank: String(data.bankCode ?? data.bankName ?? ""),
        expiredTime: String(data.expiredTime ?? ""),
        amount: params.amount,
        raw: data,
      };
    }
    console.error(
      `[Paylabs VA] errCode=${String(data.errCode ?? "")} merchantId=${merchantId} raw:`,
      JSON.stringify(data),
    );
    return {
      success: false,
      error: String(
        data.errCodeDes ?? data.errMsg ?? data.resultMsg ?? "Gagal membuat VA",
      ),
      raw: data,
    };
  } catch (err) {
    const axErr = err as { response?: { data: unknown; status: number } };
    const msg = err instanceof Error ? err.message : String(err);
    if (isNetworkError(err)) {
      console.error("[Paylabs VA] Network unreachable:", msg);
      return {
        success: false,
        error: "Tidak dapat terhubung ke Paylabs. Periksa koneksi server.",
      };
    }
    console.error("[Paylabs VA] Error:", msg, axErr.response?.data);
    return {
      success: false,
      error: `Paylabs error: ${msg}`,
      raw: axErr.response?.data,
    };
  }
}

export async function createQRISPayment(
  params: CreateQRISPaymentParams,
  config?: PaylabsConfig,
): Promise<PaylabsQRISResult> {
  if (isMockMode(config)) {
    const qrData = `00020101021226660014ID.CO.QRIS.WWW011893600914000000000020210000${String(Math.round(params.amount)).padStart(6, "0")}5204581153033605802ID5920${params.customerName.substring(0, 20).padEnd(20)}6013JAKARTA PUSAT6105102406304ABCD`;
    return {
      success: true,
      paylabsOrderId: params.orderId,
      qrCode: qrData,
      expiredTime: mockExpiredTime(1),
      amount: params.amount,
      mock: true,
    };
  }

  const requestId = generateRequestId();
  const merchantId = getMerchantId(config);
  const timestamp = buildTimestamp();
  const notifyUrl =
    params.notifyUrl ?? `${getAppBaseUrl()}/api/paylabs/webhook`;

  const body = {
    merchantId,
    requestId,
    merchantTradeNo: params.orderId,
    paymentType: "QRIS",
    amount: Math.round(params.amount),
    productName: params.productName,
    payer: params.customerName,
    email: params.email,
    notifyUrl,
  };

  const apiPath = "/payment/v2.1/qris/create";
  const jsonBody = JSON.stringify(body);
  let signature: string;
  try {
    signature = buildSignature("POST", apiPath, jsonBody, timestamp, config);
  } catch (err) {
    return {
      success: false,
      error: `RSA sign error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const response = await axios.post(`${getBaseUrl(config)}${apiPath}`, body, {
      headers: buildHeaders(requestId, signature, timestamp, config),
      timeout: 15000,
    });

    const data = response.data as Record<string, unknown>;
    const errCode = String(data.errCode ?? data.resultCode ?? "");
    if (errCode === "0" || errCode === "00" || errCode === "") {
      return {
        success: true,
        paylabsOrderId: String(
          data.paymentId ??
            data.tradeNo ??
            data.merchantTradeNo ??
            params.orderId,
        ),
        qrCode: String(data.qrCode ?? data.qrString ?? data.qr ?? ""),
        expiredTime: String(data.expiredTime ?? ""),
        amount: params.amount,
        raw: data,
      };
    }
    console.error(
      `[Paylabs QRIS] errCode=${String(data.errCode ?? "")} merchantId=${getMerchantId(config)} raw:`,
      JSON.stringify(data),
    );
    return {
      success: false,
      error: String(
        data.errCodeDes ??
          data.errMsg ??
          data.resultMsg ??
          "Gagal membuat QRIS",
      ),
      raw: data,
    };
  } catch (err) {
    const axErr = err as { response?: { data: unknown; status: number } };
    const msg = err instanceof Error ? err.message : String(err);
    if (isNetworkError(err)) {
      console.error("[Paylabs QRIS] Network unreachable:", msg);
      return {
        success: false,
        error: "Tidak dapat terhubung ke Paylabs. Periksa koneksi server.",
      };
    }
    console.error("[Paylabs QRIS] Error:", msg, axErr.response?.data);
    return {
      success: false,
      error: `Paylabs error: ${msg}`,
      raw: axErr.response?.data,
    };
  }
}

export function verifyWebhookSignature(
  rawBody: string,
  receivedSignature: string,
  config?: PaylabsConfig,
): boolean {
  return verifyResponseSignature(rawBody, receivedSignature, config);
}

export interface InquireResult {
  success: boolean;
  isPaid: boolean;
  status?: string;
  transactionId?: string;
  paidAt?: string;
  bankCode?: string;
  vaNumber?: string;
  error?: string;
  raw?: unknown;
}

const CHANNEL_MAP: Record<string, string> = {
  BNIVA: "BNIVA",
  BNI: "BNIVA",
  MANDIRIVA: "MandiriVA",
  MANDIRI: "MandiriVA",
  PERMATAVA: "PERMATAVA",
  PERMATA: "PERMATAVA",
  MAYBANKVA: "MAYBANKVA",
  MAYBANK: "MAYBANKVA",
  CIMBVA: "CIMBVA",
  CIMB: "CIMBVA",
  CIMBNIAGA: "CIMBVA",
  BRIVA: "BRIVA",
  BRI: "BRIVA",
  BCAVA: "BCAVA",
  BCA: "BCAVA",
  BTNVA: "BTNVA",
  BTN: "BTNVA",
  DANAMONVA: "DanamonVA",
  DANAMON: "DanamonVA",
  BSIVA: "BSIVA",
  BSI: "BSIVA",
  MUAMALATVA: "MUAMALATVA",
  MUAMALAT: "MUAMALATVA",
  SINARMASVA: "SINARMASVA",
  SINARMAS: "SINARMASVA",
  INAVA: "INAVA",
  INA: "INAVA",
};

function isInquiryPaid(data: Record<string, unknown>): boolean {
  const PAID_CODES = new Set([
    "02",
    "2",
    "success",
    "paid",
    "settled",
    "complete",
    "completed",
    "payment_success",
    "trade_success",
  ]);

  // Check all possible status field names Paylabs might return
  const statusFields = [
    data.tradeStatus,
    data.tradeState,
    data.status,
    data.paymentStatus,
    data.orderStatus,
    data.resultStatus,
  ];

  for (const val of statusFields) {
    if (val !== undefined && val !== null && val !== "") {
      if (PAID_CODES.has(String(val).toLowerCase().trim())) return true;
    }
  }

  // resultCode / errCode "00" means API success but NOT necessarily payment paid —
  // only use these as paid indicator when there is no dedicated status field present.
  const hasDedicatedStatus = statusFields.some(
    (v) => v !== undefined && v !== null && v !== "",
  );
  if (!hasDedicatedStatus) {
    const code = String(data.resultCode ?? data.errCode ?? "").trim();
    if (code === "00" || code === "0") return true;
  }

  return false;
}

async function inquireByPath(
  apiPath: string,
  merchantTradeNo: string,
  extraFields: Record<string, unknown> = {},
  cfg?: PaylabsConfig,
): Promise<InquireResult> {
  const requestId = generateRequestId();
  const merchantId = getMerchantId(cfg);
  const timestamp = buildTimestamp();

  const body = { merchantId, requestId, merchantTradeNo, ...extraFields };
  const jsonBody = JSON.stringify(body);

  let signature: string;
  try {
    signature = buildSignature("POST", apiPath, jsonBody, timestamp, cfg);
  } catch (err) {
    return {
      success: false,
      isPaid: false,
      error: `RSA sign error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const response = await axios.post(`${getBaseUrl(cfg)}${apiPath}`, body, {
      headers: buildHeaders(requestId, signature, timestamp, cfg),
      timeout: 15000,
    });
    const data = response.data as Record<string, unknown>;

    // Log full raw response so we can see exactly which fields Paylabs returns
    console.log(
      `[Paylabs Inquiry ${apiPath}] Raw response:`,
      JSON.stringify(data, null, 2),
    );

    const isPaid = isInquiryPaid(data);
    const detectedStatus = String(
      data.tradeStatus ??
        data.tradeState ??
        data.status ??
        data.paymentStatus ??
        data.orderStatus ??
        data.resultStatus ??
        data.errCode ??
        "",
    );

    console.log(
      `[Paylabs Inquiry ${apiPath}] merchantTradeNo=${merchantTradeNo} detectedStatus="${detectedStatus}" isPaid=${isPaid}`,
    );

    // Extract bank channel from any possible field name Paylabs might use
    const rawChannel = String(
      data.channelType ??
        data.bankCode ??
        data.channel ??
        data.paymentChannel ??
        data.bankChannel ??
        data.subPayType ??
        data.payType ??
        data.payChannel ??
        "",
    )
      .toUpperCase()
      .trim();
    const bankCode = rawChannel
      ? (CHANNEL_MAP[rawChannel] ?? undefined)
      : undefined;

    // Extract VA number
    const vaNumber =
      String(
        data.vaNumber ??
          data.vaAccount ??
          data.accountNo ??
          data.virtualAccountNumber ??
          data.bankVaNo ??
          data.paymentCode ??
          "",
      ).trim() || undefined;

    console.log(
      `[Paylabs Inquiry ${apiPath}] bankCode=${bankCode ?? "-"} vaNumber=${vaNumber ?? "-"}`,
    );

    return {
      success: true,
      isPaid,
      status: detectedStatus,
      transactionId: String(
        data.paymentId ?? data.tradeNo ?? data.transactionId ?? "",
      ),
      paidAt: data.payTime ? String(data.payTime) : undefined,
      bankCode,
      vaNumber,
      raw: data,
    };
  } catch (err) {
    const axErr = err as { response?: { data: unknown; status: number } };
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[Paylabs Inquiry ${apiPath}] Error:`,
      msg,
      JSON.stringify(axErr.response?.data ?? {}),
    );
    return {
      success: false,
      isPaid: false,
      error: `Inquiry error: ${msg}`,
      raw: axErr.response?.data,
    };
  }
}

export async function inquireQRIS(
  merchantTradeNo: string,
  config?: PaylabsConfig,
): Promise<InquireResult> {
  return inquireByPath(
    "/payment/v2.1/qris/query",
    merchantTradeNo,
    { paymentType: "QRIS" },
    config,
  );
}

export async function inquireVA(
  merchantTradeNo: string,
  config?: PaylabsConfig,
): Promise<InquireResult> {
  return inquireByPath("/payment/v2.1/va/query", merchantTradeNo, {}, config);
}

export async function inquireH5(
  merchantTradeNo: string,
  config?: PaylabsConfig,
): Promise<InquireResult> {
  // Basic query — only required fields (merchantId, requestId, merchantTradeNo)
  // storeId="" causes paramInvalid on SIT merchant 010370
  const result = await inquireByPath(
    "/payment/v2/h5/query",
    merchantTradeNo,
    {},
    config,
  );

  // If failed, check raw errCode for paramInvalid and retry with paymentType field
  const rawErrCode = String(
    (result.raw as Record<string, unknown>)?.errCode ?? "",
  );
  if (!result.isPaid && rawErrCode === "paramInvalid") {
    console.log(
      "[Paylabs H5 Inquiry] paramInvalid on basic query, retry with paymentType...",
    );
    return inquireByPath(
      "/payment/v2/h5/query",
      merchantTradeNo,
      { paymentType: "h5" },
      config,
    );
  }
  return result;
}

const VA_BANK_CODES = new Set([
  "BRIVA",
  "BCAVA",
  "BNIVA",
  "MANDIRIVA",
  "PERMATAVA",
  "CIMBVA",
  "BTNVA",
  "DanamonVA",
  "MAYBANKVA",
  "BSIVA",
  "MUAMALATVA",
  "SINARMASVA",
  "INAVA",
  "VIRTUAL_ACCOUNT",
]);

export async function inquirePayment(
  merchantTradeNo: string,
  paymentType: string,
  config?: PaylabsConfig,
): Promise<InquireResult> {
  if (isMockMode(config)) {
    return { success: true, isPaid: false, status: "PENDING" };
  }
  if (paymentType === "QRIS") return inquireQRIS(merchantTradeNo, config);
  if (VA_BANK_CODES.has(paymentType)) return inquireVA(merchantTradeNo, config);
  if (paymentType === "H5") return inquireH5(merchantTradeNo, config);
  return {
    success: false,
    isPaid: false,
    error: "Payment type tidak didukung untuk inquiry.",
  };
}

/**
 * H5 createLink — customer diarahkan ke halaman pembayaran Paylabs.
 * Endpoint: POST /payment/v2/h5/createLink
 * Field sesuai contoh PHP: requestId, merchantId, merchantTradeNo, amount,
 * payer, phoneNumber, productName, redirectUrl, notifyUrl
 */
export async function createH5Payment(
  params: CreateH5PaymentParams,
  config?: PaylabsConfig,
): Promise<PaylabsH5Result> {
  if (isMockMode(config)) {
    const base = getAppBaseUrl();
    const mockUrl = `${base}/mock-payment?tradeNo=${encodeURIComponent(params.orderId)}&amount=${params.amount}&redirect=${encodeURIComponent(params.redirectUrl)}`;
    return {
      success: true,
      paylabsOrderId: params.orderId,
      paymentUrl: mockUrl,
      amount: params.amount,
      mock: true,
    };
  }

  const requestId = generateRequestId();
  const merchantId = getMerchantId(config);
  const timestamp = buildTimestamp();
  const notifyUrl =
    params.notifyUrl ?? `${getAppBaseUrl()}/api/paylabs/webhook`;
  console.log("[Paylabs H5] notifyUrl:", notifyUrl);

  const body = {
    requestId,
    merchantId,
    merchantTradeNo: params.orderId,
    amount: String(Math.round(params.amount)),
    payer: params.customerName,
    phoneNumber: params.phone,
    productName: params.productName,
    redirectUrl: params.redirectUrl,
    notifyUrl,
  };

  const apiPath = "/payment/v2/h5/createLink";
  const jsonBody = JSON.stringify(body);
  let signature: string;
  try {
    signature = buildSignature("POST", apiPath, jsonBody, timestamp, config);
  } catch (err) {
    return {
      success: false,
      error: `RSA sign error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const response = await axios.post(`${getBaseUrl(config)}${apiPath}`, body, {
      headers: buildHeaders(requestId, signature, timestamp, config),
      timeout: 15000,
    });

    const data = response.data as Record<string, unknown>;
    const errCode = String(data.errCode ?? data.resultCode ?? "");
    if (errCode === "0" || errCode === "00" || errCode === "") {
      return {
        success: true,
        paylabsOrderId: String(data.merchantTradeNo ?? params.orderId),
        paymentUrl: String(data.url ?? data.paymentUrl ?? ""),
        amount: params.amount,
        raw: data,
      };
    }
    console.error(
      `[Paylabs H5] errCode=${String(data.errCode ?? "")} merchantId=${getMerchantId(config)} raw:`,
      JSON.stringify(data),
    );
    return {
      success: false,
      error: String(
        data.errCodeDes ??
          data.errMsg ??
          data.resultMsg ??
          "Gagal membuat H5 link",
      ),
      raw: data,
    };
  } catch (err) {
    const axErr = err as { response?: { data: unknown; status: number } };
    const msg = err instanceof Error ? err.message : String(err);
    if (isNetworkError(err)) {
      console.error("[Paylabs H5] Network unreachable:", msg);
      return {
        success: false,
        error: "Tidak dapat terhubung ke Paylabs. Periksa koneksi server.",
      };
    }
    console.error("[Paylabs H5] Error:", msg, axErr.response?.data);
    return {
      success: false,
      error: `Paylabs error: ${msg}`,
      raw: axErr.response?.data,
    };
  }
}
