import OpenAI from "openai";
import { parsePaymentProofDate } from "./paymentProofOcr";

/** Bank/merchant reference is metadata; do not infer payment verification from it. */
export function parseBluProofReference(text: string): string | null {
  const normalized=text.replace(/\r/g,"").replace(/[‐‑–—]/g,"-");
  const lines=normalized.split("\n").map(line=>line.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const first=lines[i]!;
    // Printed receipts may OCR the label on two lines: "No. Ref" + "blu".
    const combined=[first,lines[i+1]??""].join(" ");
    const pattern=/\b(?:NO\.?|NOMOR)\s*\.?\s*REF(?:ERENSI)?\s*BLU\b/i;
    const labelIsSingle=pattern.test(first);
    if(!labelIsSingle&&!pattern.test(combined))continue;
    const label=labelIsSingle?first:combined;
    const startIndex=labelIsSingle?i+1:i+2;
    // Read ONLY contiguous numeric lines below the explicit blu reference label.
    // A bank screenshot commonly wraps "1793 2623 0280" + "0488".
    const inline=label.replace(/^.*?\b(?:NO\.?|NOMOR)\s*\.?\s*REF(?:ERENSI)?\s*BLU\b/i,"")
      .replace(/^[\s:.\-]+/,"").trim();
    const parts:string[]=[];
    // In blu mobile-app screenshots the reference is right-aligned and its
    // first 12 digits can appear BEFORE the OCR label in reading order:
    // "1793 2623 0280 [copy icon]" / "No. Ref blu 0488 [copy icon]".
    // Never prepend an unrelated preceding amount, account or PLN token.
    const preceding=lines[i-1]??"";
    const priorGroups=preceding.match(/^((?:\d{4}[\s.\-]+){2}\d{4})(?=\s|$)/);
    const numericPrefix=(value:string):string|null=>{
      const match=value.match(/^\s*(\d[\d\s.\-]*)(?:[^\d]|$)/);
      return match?.[1]?.replace(/\D/g,"")||null;
    };
    const inlineDigits=numericPrefix(inline);
    if(inlineDigits)parts.push(inlineDigits);
    for(const line of lines.slice(startIndex,startIndex+4)){
      const digits=numericPrefix(line);
      if(!digits)break;
      parts.push(digits);
      const total=parts.join("").length;
      if(total===16 || total===20 || total>20)break;
    }
    const after=parts.join("");
    if((after.length===4 || after.length===8) && priorGroups){
      const prior=priorGroups[1]!.replace(/\D/g,"");
      const joined=prior+after;
      if(joined.length===16 || joined.length===20)return joined;
    }
    if(after.length===16 || after.length===20)return after;
  }
  return null;
}
export function selectCompleteBluReference(
  ocrReference:string|null, visionReference:string|null
):string|null {
  const clean=(value:string|null):string|null=>{
    const digits=String(value??"").replace(/\D/g,"");
    return digits.length===16 || digits.length===20 ? digits : null;
  };
  const ocr=clean(ocrReference);
  const vision=clean(visionReference);
  if(ocr&&vision&&ocr!==vision)return null; // conflicting evidence: manual review
  return ocr??vision;
}

/** Expense-only second look for wrapped No. Ref blu when full-image OCR is incomplete. */
export async function readExpenseBluReferenceFromFocusedImage(buffer:Buffer,mime:string):Promise<string|null>{
  const key=process.env.OPENAI_API_KEY?.trim();
  if(!key || !["image/jpeg","image/png","image/webp"].includes(mime))return null;
  try{
    const sharp=(await import("sharp")).default;
    const rotated=await sharp(buffer).rotate().toBuffer();
    const meta=await sharp(rotated).metadata();
    if(!meta.width || !meta.height || meta.height<200 || meta.width<200)return null;
    // Covers the reference on printable transfer proofs (~40% height) and
    // mobile-app screenshots (~70% height), unlike the old lower-half-only crop.
    const top=Math.floor(meta.height*0.24);
    const bottom=Math.min(meta.height,Math.ceil(meta.height*0.94));
    const focused=await sharp(rotated).extract({left:0,top,width:meta.width,height:bottom-top})
      .resize({width:1800,withoutEnlargement:false}).sharpen().png().toBuffer();
    const client=new OpenAI({apiKey:key,
      ...(process.env.OPENAI_BASE_URL?{baseURL:process.env.OPENAI_BASE_URL}:{}),
      timeout:20000,maxRetries:0});
    const response=await client.chat.completions.create({
      model:process.env.PAYMENT_PROOF_VISION_MODEL||"gpt-4o-mini",
      temperature:0,max_tokens:80,
      messages:[
        {role:"system",content:"Read ONLY the number labeled No. Ref blu on this Indonesian blu bank screenshot. Digit groups may wrap to two lines. Ignore bank account, date, nominal and icons. Return ONLY JSON with a bankReference field containing all 16 or 20 visible digits. If any group is illegible or label absent return bankReference null. Do not guess or extend a 12-digit prefix."},
        {role:"user",content:[
          {type:"text",text:"Transcribe the full No. Ref blu, joining wrapped groups. If incomplete, return null."},
          {type:"image_url",image_url:{url:"data:image/png;base64,"+focused.toString("base64"),detail:"high"}}
        ]}
      ]
    });
    const raw=response.choices[0]?.message?.content?.trim()||"";
    const parsed=JSON.parse(raw.replace(/^[^{]*/,"").replace(/[^}]*$/,"")) as Record<string,unknown>;
    if(typeof parsed.bankReference!=="string")return null;
    const digits=parsed.bankReference.replace(/\D/g,"");
    return digits.length===16 || digits.length===20?digits:null;
  }catch{return null;}
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


/** Expense-only metadata parsers. Never turn a guessed bank or account into a verified payment. */
export function parseBluProofDestinationBank(text: string): string | null {
  const match=text.match(/\b(BCA|MANDIRI|BNI|BRI|BSI|CIMB|PERMATA|DANAMON|BTN|OCBC)\s*[-–:]\s*(?:\d[\d\s-]{5,})/i);
  return match?.[1]?.toUpperCase() ?? null;
}
export function parseBluProofDestinationAccount(text: string): string | null {
  const match=text.match(/\b(?:BCA|MANDIRI|BNI|BRI|BSI|CIMB|PERMATA|DANAMON|BTN|OCBC)\s*[-–:]\s*(\d[\d\s-]{5,})/i);
  const digits=match?.[1]?.replace(/\D/g,"") ?? "";
  return digits.length>=6 && digits.length<=24 ? digits : null;
}
export function parseBluProofPurpose(text: string): string | null {
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  // Most blu receipts show the free-form note in quotation marks below nominal.
  for(const line of lines){
    const quoted=line.match(/^[“"]\s*([^“”"]{4,110})\s*[”"]$/);
    if(quoted?.[1])return quoted[1].trim();
    const labeled=line.match(/^(?:CATATAN|KETERANGAN|BERITA|PESAN)\s*[:\-]\s*(.{4,110})$/i);
    if(labeled?.[1]&&!/^(?:TRANSAKSI|TRANSFER|BANK|NOMINAL)\b/i.test(labeled[1]))
      return labeled[1].trim();
  }
  return null;
}
export function parseBluTransferMethod(text:string):string|null {
  if(/\bBI[\s-]*FAST\b/i.test(text))return "BI-FAST";
  if(/\b(?:PLN\s*PRABAYAR|LISTRIK\s*PRABAYAR)\b/i.test(text))return "PLN Prabayar";
  if(/\bQRIS\b/i.test(text))return "QRIS";
  if(/\bTRANSFER\s+(?:BANK|KE|ANTAR)\b/i.test(text))return "Transfer Bank";
  return null;
}
export function parseBluProofSourceBank(text:string):string|null {
  return /\bbluAccount\b|\bblu\s+by\s+BCA\s+Digital\b/i.test(text) ? "blu by BCA Digital" : null;
}

type VisionFields = { date: string | null; bankReference: string | null; amount: number | null; recipient: string | null; destinationBank: string | null; destinationAccount: string | null; notes: string | null; paymentMethod: string | null; sourceBank: string | null };
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
      messages:[{role:"system",content:"Extract visible fields from Indonesian blu/BCA Digital payment screenshot. Return ONLY JSON: date (YYYY-MM-DD or null), bankReference (No. Ref blu digits, null if absent), amount (integer nominal rupiah, null if unclear), recipient (beneficiary, NEVER sender), destinationBank (explicit beneficiary bank, e.g. BCA), destinationAccount (digits only, only if clearly printed), notes (free-form payment memo, not a generic label), paymentMethod (BI-FAST, Transfer Bank, QRIS, PLN Prabayar, or null), sourceBank (only if explicit bluAccount, use blu by BCA Digital; else null). Do not invent missing values. Ignore unrelated card/phone/token numbers. Never infer bank confirmation."},
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
    const destinationBank=typeof parsed.destinationBank==="string" ? parsed.destinationBank.trim().toUpperCase() : "";
    const destinationAccount=typeof parsed.destinationAccount==="string" ? parsed.destinationAccount.replace(/\D/g,"") : "";
    const notes=typeof parsed.notes==="string" ? parsed.notes.trim().slice(0,120) : "";
    const paymentMethod=typeof parsed.paymentMethod==="string" ? parsed.paymentMethod.trim() : "";
    const sourceBank=typeof parsed.sourceBank==="string" ? parsed.sourceBank.trim() : "";
    return {date,bankReference:bankReference && [16,20].includes(bankReference.length)?bankReference:null,
      amount:Number.isSafeInteger(amount)&&amount>=1000&&amount<=1_000_000_000?amount:null, recipient:safeRecipient,
      destinationBank:/^(BCA|MANDIRI|BNI|BRI|BSI|CIMB|PERMATA|DANAMON|BTN|OCBC)$/.test(destinationBank)?destinationBank:null,
      destinationAccount:destinationAccount.length>=6&&destinationAccount.length<=24?destinationAccount:null,
      notes:notes.length>=4&&!/[\r\n]/.test(notes)?notes:null,
      paymentMethod:["Transfer Bank","BI-FAST","QRIS","PLN Prabayar"].includes(paymentMethod)?paymentMethod:null,
      sourceBank:sourceBank==="blu by BCA Digital"?sourceBank:null};
  } catch {
    return null;
  }
}
