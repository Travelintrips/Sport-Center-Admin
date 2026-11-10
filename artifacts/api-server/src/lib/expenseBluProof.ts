import OpenAI from "openai";
import { parsePaymentProofDate } from "./paymentProofOcr";

/** Bank/merchant reference is metadata; do not infer payment verification from it. */
export function parseBluProofReference(text: string): string | null {
  const normalized = text.replace(/\r/g, "").replace(/[‐‑–—]/g, "-");
  const lines = normalized.split("\n").map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/\b(?:NO\.?|NOMOR)\s*\.?\s*REF(?:ERENSI)?\s*BLU\b/i.test(line)) continue;
    const inline = line.replace(/^.*?\b(?:NO\.?|NOMOR)\s*\.?\s*REF(?:ERENSI)?\s*BLU\b/i, "");
    const candidate = [inline, ...lines.slice(i + 1, i + 4)].join(" ");
    const digits = (candidate.match(/(?:\d[\s\-.]*){12,21}/g) ?? [])
      .map(x => x.replace(/\D/g, "")).find(x => x.length >= 12 && x.length <= 20);
    if (digits) return digits;
  }
  // Some PLN receipts have a provider reference, not a blu reference.
  // Do not silently label that identifier as a blu bank reference.
  return null;
}

export function parseBluProofDate(text: string): string | null {
  const direct = parsePaymentProofDate(text);
  if (direct) return direct;
  const normalized = text.replace(/\r/g, "").replace(/[|]/g, " ")
    .replace(/\b(\d{1,2})\s*\n\s*(Okt|Oct|Agu|Sep|Nov|Des|Jan|Feb|Mar|Apr|Mei|Jun|Jul)\s*\n\s*(20\d{2})\b/gi, "$1 $2 $3")
    .replace(/\b(\d{1,2})\s+(Okt|Oct|Agu|Sep|Nov|Des|Jan|Feb|Mar|Apr|Mei|Jun|Jul)\s+(20\d{2})\b/gi, "$1 $2 $3");
  return parsePaymentProofDate(normalized);
}

export function parseBluExpenseAmount(text: string): number | null {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  // Prefer the actual top-level transaction total. In PLN proof 'RP BAYAR'
  // can include a different breakdown while 'TOTAL BAYAR' is the settled value.
  for (const label of [/\bTOTAL\s+BAYAR\b/i, /^\s*NOMINAL\s*[:\-]?/i, /^\s*TOTAL\s*[:\-]?$/i]) {
    for (let i=0; i<lines.length; i++) {
      const line=lines[i]!;
      if (!label.test(line)) continue;
      const joined=[line, ...lines.slice(i+1,i+3)].join(" ");
      const value=joined.match(/\b(?:RP|IDR)\s*([\d.,]+)(?:\b|$)/i);
      if (!value) continue;
      const raw=value[1]!;
      const digits=raw.replace(/[.,](\d{2})$/, "").replace(/\D/g,"");
      const result=Number(digits);
      if (Number.isSafeInteger(result) && result>=1000 && result<=1_000_000_000) return result;
    }
  }
  return null;
}


/** Expense-only fallback for blu proofs where beneficiary is not explicitly labelled. */
export function parseBluProofRecipient(text: string): string | null {
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const clean=(raw: string | undefined): string | null => {
    if (!raw) return null;
    const value=raw.replace(/^[^A-Za-z]+/,"").replace(/[^A-Za-z.' -]+$/,"").trim().replace(/\s+/g," ");
    if (!/^[A-Za-z][A-Za-z.' -]{3,75}$/.test(value) || value.split(" ").length < 2) return null;
    if (/\b(?:TRANSAKSI|BERHASIL|NOMINAL|TOTAL|KATEGORI|PEMBAYARAN|BANK|PLN|BCA|DIGITAL|PRABAYAR|WIB|CHARGER|REIMBUSH|REIMBURSE)\b/i.test(value)) return null;
    return value.toUpperCase();
  };
  // Blu transfers: name is immediately ABOVE the destination account line,
  // after the transfer nominal. Do not take the sender's bluAccount name.
  for (let i=0;i<lines.length;i++) {
    const line=lines[i]!;
    if (/\b(?:BCA|MANDIRI|BNI|BRI|BSI|CIMB|PERMATA)\s*[-–:]\s*\d[\d\s-]{5,}/i.test(line)) {
      const name=clean(lines[i-1]);
      if (name) return name;
    }
  }
  // Blu PLN prepayment: recipient appears directly before meter/voltage.
  if (/PLN\s*PRABAYAR|LISTRIK\s*PRABAYAR/i.test(text)) {
    for (let i=0;i<lines.length;i++) {
      const line=lines[i]!;
      if (/\b\d{9,13}\s*[-/]\s*(?:R\d\s*[/]\s*\d{3,5}\s*VA|\d{3,5}\s*VA)/i.test(line)) {
        const recipient=clean(lines[i-1]);
        if (recipient) return recipient;
      }
      if (/^(?:NAMA)\s*[:\-]?\s*[A-Z][A-Z .'-]{3,}$/i.test(line)) {
        const recipient=clean(line.replace(/^NAMA\s*[:\-]?/i,""));
        if (recipient) return recipient;
      }
    }
  }
  return null;
}

type VisionFields = { date: string | null; bankReference: string | null; amount: number | null; recipient: string | null };
export async function readExpenseBluMissingFieldsWithVision(buffer: Buffer, mime: string): Promise<VisionFields | null> {
  const key=process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    let data=buffer;
    let type=mime;
    try {
      const sharp=(await import("sharp")).default;
      data=await sharp(buffer).rotate().resize({width:1800,withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
      type="image/jpeg";
    } catch { /* keep original data */ }
    const client=new OpenAI({apiKey:key,...(process.env.OPENAI_BASE_URL ? {baseURL:process.env.OPENAI_BASE_URL}:{}),timeout:20000,maxRetries:0});
    const response=await client.chat.completions.create({
      model:process.env.PAYMENT_PROOF_VISION_MODEL||"gpt-4o-mini",temperature:0,max_tokens:220,
      messages:[{role:"system",content:"Extract data from Indonesian blu/BCA Digital transaction proof. Return ONLY JSON with fields date (YYYY-MM-DD or null), bankReference (digits of No. Ref blu only; null if not explicitly present), amount (integer rupiah of nominal transaction or TOTAL BAYAR; not PLN RP BAYAR or fees; null if unclear), recipient (name of beneficiary/receiver of transfer or PLN service customer, or null; NEVER sender/source owner). For blu transfer proof, identify recipient near destination bank/account (e.g. DEDE SAEFULLAH near BCA account), not Felicia Justiani bluAccount; on PLN proof return DEDE YANI. Do not invent dates on receipts lacking date. A PLN meter number, token, and provider NO REF are NOT No. Ref blu. Keep exact reference digits, joining groups."},
        {role:"user",content:[{type:"text",text:"Read the screenshot and return the specified JSON fields only."},
          {type:"image_url",image_url:{url:`data:${type};base64,${data.toString("base64")}`,detail:"high"}}]}],
    });
    const raw=response.choices[0]?.message?.content?.trim()||"";
    const parsed=JSON.parse(raw.replace(/^```(?:json)?/i,"").replace(/```$/,"").trim()) as Record<string,unknown>;
    const date=typeof parsed.date==="string" && /^20\d{2}-\d{2}-\d{2}$/.test(parsed.date) && parsePaymentProofDate(parsed.date)===parsed.date ? parsed.date : null;
    const bankReference=typeof parsed.bankReference==="string" ? parsed.bankReference.replace(/\D/g,"") : null;
    const amount=Number(parsed.amount);
    const recipient=typeof parsed.recipient==="string" ? parsed.recipient.trim().replace(/\s+/g," ") : "";
    const safeRecipient=recipient.length>=3 && recipient.length<=120 &&
      /^[\p{L} .'-]+$/u.test(recipient) && !/^(null|unknown|tidak\s*terbaca)$/i.test(recipient)
      ? recipient.toUpperCase() : null;
    return {date,bankReference:bankReference && bankReference.length>=12 && bankReference.length<=20?bankReference:null,
      amount:Number.isSafeInteger(amount)&&amount>=1000&&amount<=1_000_000_000?amount:null, recipient:safeRecipient};
  } catch {
    return null;
  }
}
