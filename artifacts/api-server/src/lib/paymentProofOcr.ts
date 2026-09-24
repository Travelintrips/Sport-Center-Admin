import { createHmac, timingSafeEqual } from "crypto";

export type OcrPaymentMethod = "QRIS" | "Transfer Bank" | "unknown";

export interface PaymentProofOcrScan {
  paymentMethod: OcrPaymentMethod;
  confidence: number;
  signals: string[];
  rawText: string;
  name: string | null;
  recipient: string | null;
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

function parseMoneyToken(raw: string): number | null {
  let token = raw
    .replace(/[Oo]/g, "0")
    .replace(/[IiLl]/g, "1")
    .replace(/\s+/g, "")
    .replace(/[^\d.,]/g, "");

  if (!token) return null;

  // Indonesian receipts commonly use dot thousands + comma decimals
  // (Rp 200.000,00), while some apps use the inverse
  // (Rp 200,000.00). A trailing 2-digit group is treated as cents;
  // a trailing 3-digit group is preserved as a thousands group.
  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  const lastSeparator = Math.max(lastDot, lastComma);
  if (lastSeparator >= 0) {
    const trailing = token.slice(lastSeparator + 1);
    if (/^\d{2}$/.test(trailing)) {
      token = token.slice(0, lastSeparator);
    }
  }

  const digits = token.replace(/[^\d]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount >= 1_000 ? amount : null;
}

export function parsePaymentProofAmount(text: string): number | null {
  const candidates: Array<{ amount: number; score: number }> = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const normalized = normalizeText(line);
    if (!normalized) continue;

    // Reference/account identifiers often contain long digit sequences and
    // must never be treated as payment amounts.
    if (/\b(?:REF(?:ERENSI)?|REFERENCE|PAN|TERMINAL|REKENING|ACCOUNT)\b/.test(normalized)) {
      continue;
    }

    const hasStrongAmountLabel =
      /\b(?:TOTAL(?:\s+TRANSAKSI)?|JUMLAH|NOMINAL|AMOUNT|DIBAYAR|TOTAL\s+TRANSACTION)\b/.test(
        normalized,
      );

    // Prefer explicit currency values. Allow OCR-confused O/I/l inside digits
    // and preserve thousands separators instead of accidentally reading
    // "200.000" as "200.00" => 20.000.
    const currencyMatches = [
      ...line.matchAll(/(?:Rp|IDR)\.?\s*([\dOIl][\dOIl.,\s]{1,28})/gi),
    ];
    for (const match of currencyMatches) {
      const amount = parseMoneyToken(match[1] ?? "");
      if (amount != null) {
        candidates.push({ amount, score: hasStrongAmountLabel ? 3 : 2 });
      }
    }

    // Some OCR engines drop the "Rp" prefix. Only trust an unprefixed number
    // when the same line explicitly labels it as the total/amount.
    if (hasStrongAmountLabel && currencyMatches.length === 0) {
      const labelled = line.match(
        /(?:TOTAL(?:\s+TRANSAKSI)?|JUMLAH|NOMINAL|AMOUNT|DIBAYAR|TOTAL\s+TRANSACTION)\s*[:\-]?\s*([\dOIl][\dOIl.,\s]{2,28})/i,
      );
      const amount = labelled ? parseMoneyToken(labelled[1] ?? "") : null;
      if (amount != null) candidates.push({ amount, score: 3 });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return candidates[0]!.amount;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parsePaymentProofDate(text: string): string | null {
  const numeric =
    text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/) ??
    text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (numeric) {
    const [, a, b, c] = numeric;
    const year = Number(a.length === 4 ? a : c);
    const month = Number(b);
    const day = Number(a.length === 4 ? c : a);
    const parsed = isoDate(year, month, day);
    if (parsed) return parsed;
  }

  const textual = text.match(
    /\b(\d{1,2})\s+(Jan(?:uari|uary)?|Feb(?:ruari|ruary)?|Mar(?:et|ch)?|Apr(?:il)?|Mei|May|Jun(?:i|e)?|Jul(?:i|y)?|Agu(?:stus)?|Agt|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Okt(?:ober)?|Oct(?:ober)?|Nov(?:ember)?|Des(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/i,
  );
  if (!textual) return null;
  const day = Number(textual[1]);
  const month = MONTHS[textual[2].toLowerCase()];
  const year = Number(textual[3]);
  return month ? isoDate(year, month, day) : null;
}

function toWibDate(value: Date | string): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

export function paymentProofDateMatchesBooking(
  proofDate: string | null | undefined,
  bookingCreatedAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean | null {
  if (!proofDate || !bookingCreatedAt) return null;
  const createdDate = toWibDate(bookingCreatedAt);
  const today = toWibDate(now);
  if (!createdDate || !today) return null;
  return proofDate >= createdDate && proofDate <= today;
}

function parseName(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const line = lines.find((value) =>
    /\b(?:DARI|FROM|NAMA|PEMBAYAR|PENGIRIM)\b\s*[:\-]/i.test(value),
  );

  if (!line) return null;

  const value = line
    .replace(/^.*?\b(?:DARI|FROM|NAMA|PEMBAYAR|PENGIRIM)\b\s*[:\-]?\s*/i, "")
    .trim();

  return value.length >= 3 && value.length <= 120 ? value : null;
}

export function parsePaymentProofRecipient(text: string): string | null {
  const patterns = [
    /^(?:NAMA\s+PENERIMA|PENERIMA|NAMA\s+MERCHANT|MERCHANT\s+NAME|BENEFICIARY(?:\s+NAME)?)\s*[:\-]?\s*(.+)$/i,
    /^(?:REKENING\s+TUJUAN|TUJUAN(?:\s+(?:TRANSFER|PEMBAYARAN))?|KEPADA|MERCHANT|TO)\s*[:\-]?\s*(.+)$/i,
  ];
  const lines = text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  for (const line of lines) {
    for (const pattern of patterns) {
      const recipient = line.match(pattern)?.[1]
        ?.replace(/^[\s:—-]+|[\s.,;]+$/g, "")
        .trim();
      if (
        recipient &&
        recipient.length >= 3 &&
        recipient.length <= 120 &&
        /[A-Za-z]/.test(recipient) &&
        !/^(?:detail transaksi|transaction detail|berhasil|sukses)$/i.test(recipient)
      ) {
        return recipient;
      }
    }
  }
  return null;
}

function normalizedRecipientWords(value: string): string[] {
  return normalizeText(value)
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1 && !/^(?:PT|CV|UD|TBK|PERSERO|LTD|INC)$/.test(word));
}

export function paymentRecipientMatchesOcr(
  actualRecipient: string | null | undefined,
  expectedRecipients: string[],
): boolean {
  if (!actualRecipient?.trim()) return false;
  const actualWords = normalizedRecipientWords(actualRecipient);
  if (actualWords.length === 0) return false;

  return expectedRecipients.some((expectedRecipient) => {
    const expectedWords = normalizedRecipientWords(expectedRecipient);
    if (expectedWords.length === 0) return false;
    const actualText = actualWords.join(" ");
    const expectedText = expectedWords.join(" ");
    if (actualText === expectedText) return true;

    const actualSet = new Set(actualWords);
    const matchingWords = expectedWords.filter((word) => actualSet.has(word)).length;
    if (expectedWords.length === 1) return actualSet.has(expectedWords[0]!);
    return (
      matchingWords >= Math.min(2, expectedWords.length) &&
      matchingWords / expectedWords.length >= 0.65
    );
  });
}

export function classifyPaymentMethod(text: string): {
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
    ["QR Code", /\bQR\s*CODE\b/],

    // Banking apps may omit the word QRIS on the success screen,
    // but Merchant PAN / MPAN is specific evidence of a QR merchant payment.
    ["Merchant PAN", /\bMERCHANT\s+PAN\b|\bMPAN\b/],

    ["QR Payment", /\bQR\s+(?:PAYMENT|PEMBAYARAN)\b/],
  ] as const;

  for (const [label, pattern] of qrisSignals) {
    if (pattern.test(normalized)) {
      signals.push(label);
    }
  }

  // Bank names are intentionally checked after QRIS because a QRIS receipt
  // may still display the acquiring bank name.
  //
  // Generic words such as BERHASIL/SUKSES are deliberately excluded because
  // they are not sufficient evidence of a bank transfer.
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
  ] as const;

  const bankMatches = bankSignals
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([label]) => label);

  const explicitTransferEvidence = [
    /\bTRANSFER\s+(?:BANK|KE\s+(?:REKENING|AKUN)|ANTAR\s*BANK)\b/,
    /\b(?:NO|NOMOR)\.?\s*(?:REKENING|REK)\b/,
    /\b(?:VIRTUAL\s+ACCOUNT|VA)\b/,
    /\bREKENING\s+(?:TUJUAN|PENERIMA)\b/,
  ].some((pattern) => pattern.test(normalized));

  // QRIS evidence takes priority over bank-name evidence.
  if (signals.length > 0) {
    return {
      paymentMethod: "QRIS",
      confidence: signals.length > 1 ? 0.99 : 0.97,
      signals,
    };
  }

  // A bank name alone is not enough to classify a payment as bank transfer.
  // Require explicit account / VA / transfer evidence.
  if (bankMatches.length > 0 && explicitTransferEvidence) {
    return {
      paymentMethod: "Transfer Bank",
      confidence: 0.96,
      signals: bankMatches,
    };
  }

  return {
    paymentMethod: "unknown",
    confidence: 0,
    signals: [],
  };
}

async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
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
      recipient: null,
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
        recipient: parsePaymentProofRecipient(rawText),
        amount: parsePaymentProofAmount(rawText),
        date: parsePaymentProofDate(rawText),
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
      recipient: null,
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

export function createProofOcrToken(
  proofUrl: string,
  scan: PaymentProofOcrScan,
): string {
  const payload = JSON.stringify({
    proofUrl,
    expiresAt: Date.now() + OCR_TOKEN_TTL_MS,
    scan,
  });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${tokenSignature(encoded)}`;
}

export function verifyProofOcrToken(
  token: unknown,
  proofUrl: string,
): PaymentProofOcrScan | null {
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
    )
      return null;

    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as {
      proofUrl?: string;
      expiresAt?: number;
      scan?: PaymentProofOcrScan;
    };
    if (
      payload.proofUrl !== proofUrl ||
      !payload.expiresAt ||
      payload.expiresAt < Date.now()
    )
      return null;
    if (
      !payload.scan ||
      !["QRIS", "Transfer Bank", "unknown"].includes(payload.scan.paymentMethod)
    )
      return null;
    return payload.scan;
  } catch {
    return null;
  }
}

export function paymentMethodMatchesOcr(
  selectedMethod: string | null | undefined,
  scan: PaymentProofOcrScan | null | undefined,
): boolean | null {
  if (!scan || scan.paymentMethod === "unknown" || scan.engine !== "tesseract")
    return null;
  const selected = String(selectedMethod ?? "")
    .trim()
    .toUpperCase();
  if (selected.includes("QRIS")) return scan.paymentMethod === "QRIS";
  if (/\bTRANSFER\b|\bBANK\b|\bVIRTUAL ACCOUNT\b|\bVA\b/.test(selected)) {
    return scan.paymentMethod === "Transfer Bank";
  }
  if (/\bCASH\b|\bTUNAI\b/.test(selected)) return false;
  return null;
}

export interface PaymentProofValidation {
  methodMatch: boolean;
  amountMatch: boolean;
  dateMatch: boolean;
  recipientMatch: boolean;
  complete: boolean;
  expectedAmount: number;
  expectedRecipients: string[];
}

export function validatePaymentProofScan(params: {
  scan: PaymentProofOcrScan | null | undefined;
  selectedMethod: string;
  expectedAmount: number;
  expectedRecipients: string[];
  bookingCreatedAt: Date | string | null | undefined;
  now?: Date;
}): PaymentProofValidation {
  const scan = params.scan;
  const readable = scan?.engine === "tesseract";
  const methodMatch =
    readable && paymentMethodMatchesOcr(params.selectedMethod, scan) === true;
  const amountMatch =
    readable &&
    scan?.amount != null &&
    Number(scan.amount) === Number(params.expectedAmount);
  const dateMatch =
    readable &&
    paymentProofDateMatchesBooking(
      scan?.date,
      params.bookingCreatedAt,
      params.now,
    ) === true;
  const recipientMatch =
    readable &&
    paymentRecipientMatchesOcr(scan?.recipient, params.expectedRecipients);
  return {
    methodMatch,
    amountMatch,
    dateMatch,
    recipientMatch,
    complete: methodMatch && amountMatch && dateMatch && recipientMatch,
    expectedAmount: Number(params.expectedAmount),
    expectedRecipients: params.expectedRecipients,
  };
}

export function storedPaymentProofOcr(
  payment:
    | {
        ocrName?: string | null;
        ocrAmount?: string | number | null;
        ocrDate?: string | null;
        ocrRaw?: string | null;
        ocrData?: unknown;
      }
    | null
    | undefined,
): PaymentProofOcrScan | null {
  if (!payment?.ocrData || typeof payment.ocrData !== "object") return null;
  const data = payment.ocrData as Record<string, unknown>;
  const method = data.paymentMethod;
  if (!["QRIS", "Transfer Bank", "unknown"].includes(String(method)))
    return null;
  return {
    paymentMethod: method as OcrPaymentMethod,
    confidence: Number(data.confidence ?? 0),
    signals: Array.isArray(data.signals) ? data.signals.map(String) : [],
    rawText: payment.ocrRaw ?? "",
    name: payment.ocrName ?? null,
    recipient: typeof data.recipient === "string" ? data.recipient : null,
    amount: payment.ocrAmount == null ? null : Number(payment.ocrAmount),
    date: payment.ocrDate ?? null,
    engine:
      data.engine === "tesseract"
        ? "tesseract"
        : data.engine === "failed"
          ? "failed"
          : "unsupported",
    scannedAt: String(data.scannedAt ?? ""),
  };
}
