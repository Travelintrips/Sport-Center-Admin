export const PAYMENT_METHOD_OCR_VERSION = 1;
export const PAYMENT_METHOD_OCR_THRESHOLD = 0.85;

export type PaymentMethodOcrDetection = {
  paymentMethod: string | null;
  confidence: number;
  highConfidence: boolean;
  bank: string | null;
  signals: string[];
  matchedTerms: string[];
  version: number;
};

export type PaymentProofOcrResult = {
  ocrName: string | null;
  ocrAmount: number | null;
  ocrDate: string | null;
  ocrRaw: string;
  paymentMethodDetection: PaymentMethodOcrDetection;
};

type Candidate = {
  paymentMethod: string;
  confidence: number;
  bank?: string;
  signals: string[];
  matchedTerms: string[];
};

const BANK_PATTERNS: Array<{
  bank: string;
  label: string;
  terms: RegExp[];
  accountNumbers?: string[];
}> = [
  {
    bank: "Mandiri",
    label: "Transfer Bank Mandiri",
    terms: [/\bMANDIRI\b/i],
    accountNumbers: ["1640006707220"],
  },
  { bank: "BCA", label: "Transfer Bank BCA", terms: [/\bBCA\b/i] },
  { bank: "BRI", label: "Transfer Bank BRI", terms: [/\bBRI\b/i, /\bBRIVA\b/i] },
  { bank: "BNI", label: "Transfer Bank BNI", terms: [/\bBNI\b/i, /\bBNIVA\b/i] },
];

function normalizeText(value: string): string {
  return value
    .toUpperCase()
    .replace(/[|]/g, "I")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function matchedTerms(text: string, patterns: RegExp[]): string[] {
  return patterns
    .map((pattern) => text.match(pattern)?.[0])
    .filter((term): term is string => Boolean(term))
    .map((term) => term.trim());
}

/**
 * Classifies a payment method from OCR text.
 *
 * This intentionally returns a high-confidence result only when the receipt
 * contains a distinctive payment rail. A generic bank receipt without a bank
 * name remains a suggestion candidate and is not applied automatically.
 */
export function detectPaymentMethodFromOcr(
  rawText: string,
  ocrAmount?: number | null,
): PaymentMethodOcrDetection {
  const text = normalizeText(rawText);
  if (!text) {
    return {
      paymentMethod: null,
      confidence: 0,
      highConfidence: false,
      bank: null,
      signals: [],
      matchedTerms: [],
      version: PAYMENT_METHOD_OCR_VERSION,
    };
  }

  const candidates: Candidate[] = [];
  const qrPatterns = [/\bQRIS\b/i, /\bQR\s*CODE\b/i, /\bGPN\b/i];
  const hasQris = matchesAny(text, qrPatterns);
  const hasGpn = /\bGPN\b/i.test(text);
  if (hasQris) {
    const exactQris = /\bQRIS\b/i.test(text);
    const qrCode = /\bQR\s*CODE\b/i.test(text);
    const confidence = exactQris ? 0.98 : qrCode ? 0.94 : hasGpn && ocrAmount ? 0.88 : 0;
    if (confidence > 0) {
      candidates.push({
        paymentMethod: "QRIS",
        confidence,
        signals: [
          exactQris ? "kata kunci QRIS" : qrCode ? "kata kunci QR Code" : "logo/kata kunci GPN + nominal",
        ],
        matchedTerms: matchedTerms(text, qrPatterns),
      });
    }
  }

  const cardPatterns = [/\bEDC\b/i, /\bDEBIT\b/i, /\bCREDIT\b/i, /\bKARTU\b/i];
  const hasCardRail = matchesAny(text, cardPatterns);
  if (hasCardRail) {
    const hasDebitCredit = /\b(DEBIT|CREDIT)\b/i.test(text);
    candidates.push({
      paymentMethod: "Debit/Kredit",
      confidence: hasDebitCredit && /\bEDC\b/i.test(text) ? 0.97 : hasDebitCredit ? 0.91 : 0.86,
      signals: [
        hasDebitCredit && /\bEDC\b/i.test(text)
          ? "struk EDC + Debit/Kredit"
          : hasDebitCredit
            ? "kata kunci Debit/Kredit"
            : "kata kunci EDC",
      ],
      matchedTerms: matchedTerms(text, cardPatterns),
    });
  }

  const walletPatterns = [/\bGO\s*-?\s*PAY\b/i, /\bOVO\b/i, /\bDANA\b/i];
  const wallet = text.match(/\bGO\s*-?\s*PAY\b|\bOVO\b|\bDANA\b/i)?.[0];
  if (wallet) {
    const normalizedWallet = wallet.replace(/[\s-]/g, "").toUpperCase();
    const paymentMethod = normalizedWallet === "GOPAY" ? "GoPay" : normalizedWallet === "OVO" ? "OVO" : "DANA";
    candidates.push({
      paymentMethod,
      confidence: 0.96,
      signals: [`bukti ${paymentMethod}`],
      matchedTerms: [wallet],
    });
  }

  const transferPatterns = [
    /\bTRANSFER\b/i,
    /\bREKENING\b/i,
    /\bMUTASI\b/i,
    /\bBANK\b/i,
    /\bBERHASIL\b/i,
    /\bSUKSES\b/i,
  ];
  const hasTransferSignal = matchesAny(text, transferPatterns);
  for (const bank of BANK_PATTERNS) {
    const accountMatched = bank.accountNumbers?.find((account) => text.includes(account));
    const bankTerms = matchedTerms(text, bank.terms);
    if (accountMatched || bankTerms.length > 0) {
      const confidence = accountMatched
        ? 0.99
        : hasTransferSignal
          ? 0.94
          : 0.78;
      candidates.push({
        paymentMethod: bank.label,
        confidence,
        bank: bank.bank,
        signals: [
          ...(accountMatched ? [`nomor rekening ${accountMatched}`] : []),
          ...(bankTerms.length ? [`bank ${bank.bank}`] : []),
          ...(hasTransferSignal ? ["indikasi transfer bank"] : []),
        ],
        matchedTerms: [...bankTerms, ...(accountMatched ? [accountMatched] : [])],
      });
    }
  }

  if (hasTransferSignal && !candidates.some((candidate) => candidate.bank)) {
    candidates.push({
      paymentMethod: "Transfer Bank",
      confidence: 0.86,
      signals: ["indikasi transfer bank tanpa nama bank spesifik"],
      matchedTerms: matchedTerms(text, transferPatterns),
    });
  }

  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (!best) {
    return {
      paymentMethod: null,
      confidence: 0,
      highConfidence: false,
      bank: null,
      signals: [],
      matchedTerms: [],
      version: PAYMENT_METHOD_OCR_VERSION,
    };
  }

  return {
    paymentMethod: best.paymentMethod,
    confidence: best.confidence,
    highConfidence: best.confidence >= PAYMENT_METHOD_OCR_THRESHOLD,
    bank: best.bank ?? null,
    signals: best.signals,
    matchedTerms: best.matchedTerms,
    version: PAYMENT_METHOD_OCR_VERSION,
  };
}

function parseOcrFields(rawText: string): Omit<PaymentProofOcrResult, "paymentMethodDetection"> {
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  let ocrName: string | null = null;
  let ocrAmount: number | null = null;
  let ocrDate: string | null = null;

  const amountMatch = rawText.match(/(?:Rp\.?\s*|IDR\s*)?([\d]{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?)/i);
  if (amountMatch) {
    const cleaned = amountMatch[1]!.replace(/\./g, "").replace(",", ".");
    ocrAmount = parseFloat(cleaned) || null;
  }

  const dateMatch = rawText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  if (dateMatch) {
    if (dateMatch[4]) {
      ocrDate = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
    } else {
      const day = dateMatch[1]!.padStart(2, "0");
      const month = dateMatch[2]!.padStart(2, "0");
      const year = dateMatch[3]!.length === 2 ? `20${dateMatch[3]}` : dateMatch[3]!;
      ocrDate = `${year}-${month}-${day}`;
    }
  }

  const skipWords = /^(transfer|bank|rekening|tanggal|nominal|total|biaya|fee|dari|ke|kode|ref|no|rp|idr|berhasil|sukses|debet|kredit|saldo|date|amount|beneficiary|sender)/i;
  for (const line of lines) {
    if (line.length > 3 && /[a-zA-Z]{3,}/.test(line) && !skipWords.test(line) && !/^\d+$/.test(line)) {
      ocrName = line.slice(0, 100);
      break;
    }
  }

  return { ocrName, ocrAmount, ocrDate, ocrRaw: rawText.slice(0, 2000) };
}

export async function readPaymentProofOcr(proofUrl: string): Promise<PaymentProofOcrResult> {
  const imageResponse = await fetch(proofUrl);
  if (!imageResponse.ok) {
    throw new Error(`Gagal mengunduh gambar: ${imageResponse.statusText}`);
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("ind+eng", 1, {
    cachePath: "/tmp/tesseract-cache",
    logger: () => {},
  });

  try {
    const { data } = await worker.recognize(imageBuffer);
    const rawText = data.text || "";
    const fields = parseOcrFields(rawText);
    return {
      ...fields,
      paymentMethodDetection: detectPaymentMethodFromOcr(rawText, fields.ocrAmount),
    };
  } finally {
    await worker.terminate();
  }
}