import { createHmac, timingSafeEqual } from "crypto";
import sharp from "sharp";

export type OcrPaymentMethod = "QRIS" | "Transfer Bank" | "unknown";

export interface PaymentProofOcrScan {
  paymentMethod: OcrPaymentMethod;
  confidence: number;
  signals: string[];
  rawText: string;
  name: string | null;
  amount: number | null;
  date: string | null;
  engine: "tesseract" | "unsupported" | "failed";
  scannedAt: string;
}

const OCR_TOKEN_TTL_MS = 30 * 60 * 1000;

function ocrSecret(): string {
  return process.env.SESSION_SECRET ?? "development-only-proof-ocr";
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(text: string): number | null {
  const candidates: number[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const normalized = normalizeText(line);
    const looksLikeAmount =
      /\b(RP|IDR|TOTAL|JUMLAH|NOMINAL|AMOUNT|DIBAYAR|PEMBAYARAN)\b/.test(normalized);
    if (!looksLikeAmount) continue;

    const matches = line.match(/(?:Rp|IDR)?\s*[\dOIl]{3,}(?:[.,]\d{2})?/gi) ?? [];
    for (const match of matches) {
      const digits = match
        .replace(/[Oo]/g, "0")
        .replace(/[IiLl]/g, "1")
        .replace(/[^\d]/g, "");
      const amount = Number(digits);
      if (Number.isFinite(amount) && amount >= 1_000) candidates.push(amount);
    }
  }

  return candidates.length ? Math.max(...candidates) : null;
}

function parseDate(text: string): string | null {
  const match =
    text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/) ??
    text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (!match) return null;

  const [, a, b, c] = match;
  const year = a.length === 4 ? a : c;
  const month = a.length === 4 ? b : b;
  const day = a.length === 4 ? c : a;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseName(text: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line = lines.find((value) => /\b(?:DARI|FROM|NAMA|PEMBAYAR|PENGIRIM)\b\s*[:\-]/i.test(value));
  if (!line) return null;
  const value = line.replace(/^.*?\b(?:DARI|FROM|NAMA|PEMBAYAR|PENGIRIM)\b\s*[:\-]?\s*/i, "").trim();
  return value.length >= 3 && value.length <= 120 ? value : null;
}

function classifyPaymentMethod(text: string): {
  paymentMethod: OcrPaymentMethod;
  confidence: number;
  signals: string[];
} {
  const normalized = normalizeText(text);
  const signals: string[] = [];

  const qrisSignals = [
    ["QRIS", /\bQRIS\b/],
    ["Quick Response Code", /QUICK\s+RESPONSE\s+CODE/],
    ["NMID", /\bNMID\b/],
    ["QR Payment", /\bQR\s+(?:PAYMENT|PEMBAYARAN)\b/],
  ] as const;
  for (const [label, pattern] of qrisSignals) {
    if (pattern.test(normalized)) signals.push(label);
  }

  // Bank names are intentionally checked after QRIS. A QRIS receipt may show
  // the acquiring bank name even though the selected method is still QRIS.
  const bankSignals = [
    ["BCA", /\bBCA\b|BANK CENTRAL ASIA/],
    ["Mandiri", /\bMANDIRI\b/],
    ["BNI", /\bBNI\b/],
    ["BRI", /\bBRI\b/],
    ["BTN", /\bBTN\b/],
    ["CIMB", /\bCIMB\b/],
    ["Danamon", /\bDANAMON\b/],
    ["Permata", /\bPERMATA\b/],
    ["BSI", /\bBSI\b|BANK SYARIAH INDONESIA/],
    ["OCBC", /\bOCBC\b/],
    ["Maybank", /\bMAYBANK\b/],
    ["Bank transfer", /\b(?:TRANSFER|TRF|PEMINDAHAN DANA)\b/],
  ] as const;
  const bankMatches = bankSignals.filter(([, pattern]) => pattern.test(normalized)).map(([label]) => label);

  if (signals.length > 0) {
    return { paymentMethod: "QRIS", confidence: signals.length > 1 ? 0.99 : 0.97, signals };
  }
  if (bankMatches.length > 0) {
    return {
      paymentMethod: "Transfer Bank",
      confidence: bankMatches.includes("Bank transfer") && bankMatches.length > 1 ? 0.95 : 0.86,
      signals: bankMatches,
    };
  }
  return { paymentMethod: "unknown", confidence: 0, signals: [] };
}

async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1800, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .jpeg({ quality: 88 })
    .toBuffer();
}

export async function scanPaymentProof(
  buffer: Buffer,
  mimetype: string,
): Promise<PaymentProofOcrScan> {
  const scannedAt = new Date().toISOString();
  if (!mimetype.startsWith("image/")) {
    return {
      paymentMethod: "unknown",
      confidence: 0,
      signals: [],
      rawText: "",
      name: null,
      amount: null,
      date: null,
      engine: "unsupported",
      scannedAt,
    };
  }

  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      // App Engine's application filesystem is read-only. Keep downloaded
      // language data in its writable temporary filesystem instead.
      cachePath: "/tmp/tesseract-cache",
      logger: () => {},
    });
    try {
      const image = await preprocessImage(buffer);
      const result = await worker.recognize(image);
      const rawText = String(result.data.text ?? "").trim();
      const classification = classifyPaymentMethod(rawText);
      return {
        ...classification,
        rawText,
        name: parseName(rawText),
        amount: parseAmount(rawText),
        date: parseDate(rawText),
        engine: "tesseract",
        scannedAt,
      };
    } finally {
      await worker.terminate();
    }
  } catch {
    return {
      paymentMethod: "unknown",
      confidence: 0,
      signals: [],
      rawText: "",
      name: null,
      amount: null,
      date: null,
      engine: "failed",
      scannedAt,
    };
  }
}

function tokenSignature(payload: string): string {
  return createHmac("sha256", ocrSecret()).update(payload).digest("hex");
}

export function createProofOcrToken(proofUrl: string, scan: PaymentProofOcrScan): string {
  const payload = JSON.stringify({ proofUrl, expiresAt: Date.now() + OCR_TOKEN_TTL_MS, scan });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${tokenSignature(encoded)}`;
}

export function verifyProofOcrToken(token: unknown, proofUrl: string): PaymentProofOcrScan | null {
  try {
    if (typeof token !== "string") return null;
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;
    const expected = tokenSignature(encoded);
    const actualBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) return null;

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      proofUrl?: string;
      expiresAt?: number;
      scan?: PaymentProofOcrScan;
    };
    if (payload.proofUrl !== proofUrl || !payload.expiresAt || payload.expiresAt < Date.now()) return null;
    if (!payload.scan || !["QRIS", "Transfer Bank", "unknown"].includes(payload.scan.paymentMethod)) return null;
    return payload.scan;
  } catch {
    return null;
  }
}

export function paymentMethodMatchesOcr(
  selectedMethod: string | null | undefined,
  scan: PaymentProofOcrScan | null | undefined,
): boolean | null {
  if (!scan || scan.paymentMethod === "unknown" || scan.engine !== "tesseract") return null;
  const selected = String(selectedMethod ?? "").trim().toUpperCase();
  if (selected.includes("QRIS")) return scan.paymentMethod === "QRIS";
  if (/\bTRANSFER\b|\bBANK\b|\bVIRTUAL ACCOUNT\b|\bVA\b/.test(selected)) {
    return scan.paymentMethod === "Transfer Bank";
  }
  if (/\bCASH\b|\bTUNAI\b/.test(selected)) return false;
  return null;
}

export function storedPaymentProofOcr(
  payment: {
    ocrName?: string | null;
    ocrAmount?: string | number | null;
    ocrDate?: string | null;
    ocrRaw?: string | null;
    ocrData?: unknown;
  } | null | undefined,
): PaymentProofOcrScan | null {
  if (!payment?.ocrData || typeof payment.ocrData !== "object") return null;
  const data = payment.ocrData as Record<string, unknown>;
  const method = data.paymentMethod;
  if (!["QRIS", "Transfer Bank", "unknown"].includes(String(method))) return null;
  return {
    paymentMethod: method as OcrPaymentMethod,
    confidence: Number(data.confidence ?? 0),
    signals: Array.isArray(data.signals) ? data.signals.map(String) : [],
    rawText: payment.ocrRaw ?? "",
    name: payment.ocrName ?? null,
    amount: payment.ocrAmount == null ? null : Number(payment.ocrAmount),
    date: payment.ocrDate ?? null,
    engine: data.engine === "tesseract" ? "tesseract" : data.engine === "failed" ? "failed" : "unsupported",
    scannedAt: String(data.scannedAt ?? ""),
  };
}