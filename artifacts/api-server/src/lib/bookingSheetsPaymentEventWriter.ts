import { paymentEventRow, PAYMENT_EVENT_HEADERS, type PaymentEventCandidate } from "./bookingSheetsPaymentEventContract";

/** Transport-independent, fail-closed writer. Caller must hold a durable unique
 * source_key claim before calling. Never retry after an ambiguous append. */
export interface PaymentEventSheetPort {
  readHeaders(tab: string): Promise<string[]>;
  findSourceKeyAcrossEventTabs(key: string): Promise<Array<{tab:string;row:number}>>;
  append(tab: string, values: string[]): Promise<{row:number}>;
  readRow(tab: string,row: number): Promise<string[]>;
}
export type EventWriteResult =
  | {status:"written";tab:string;row:number}
  | {status:"needs_review";reason:"ALREADY_PRESENT"|"HEADER_MISMATCH"|"VERIFY_FAILED"|"AMBIGUOUS_APPEND"};

/** Only an explicit event-specific tab is used; legacy PAID tabs are untouched. */
export async function writeClaimedPaymentEvent(
  event:PaymentEventCandidate, tab:string, port:PaymentEventSheetPort,
):Promise<EventWriteResult> {
  const values=paymentEventRow(event);
  if(!/^PAYMENT EVENTS (?:JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER) 20\d{2}$/.test(tab))
    throw new Error("EVENT_TAB_INVALID");
  const existing=await port.findSourceKeyAcrossEventTabs(values[0]);
  if(existing.length) return {status:"needs_review",reason:"ALREADY_PRESENT"};
  const headers=await port.readHeaders(tab);
  if(PAYMENT_EVENT_HEADERS.some((h,i)=>headers[i]!==h))
    return {status:"needs_review",reason:"HEADER_MISMATCH"};
  let row:number;
  try {
    const result=await port.append(tab,values);
    row=result.row;
  } catch {
    // Server timeout may occur after Google accepted the append.
    return {status:"needs_review",reason:"AMBIGUOUS_APPEND"};
  }
  if(!Number.isSafeInteger(row)||row<2) return {status:"needs_review",reason:"VERIFY_FAILED"};
  try {
    const saved=await port.readRow(tab,row);
    // Google RAW writes can return numeric 150000 instead of input "150000.00".
    // Compare the amount in integer cents, never with floating-point equality.
    const toCents=(v:string):bigint|null=>{
      const m=/^(\d+)(?:\.(\d{1,2}))?$/.exec(v);
      return m ? BigInt(m[1])*100n+BigInt((m[2]??"").padEnd(2,"0")) : null;
    };
    if(saved.length<values.length||values.some((v,i)=>i===8
      ? toCents(String(saved[i]??""))!==toCents(v)
      : String(saved[i]??"")!==v))
      return {status:"needs_review",reason:"VERIFY_FAILED"};
  } catch {return {status:"needs_review",reason:"VERIFY_FAILED"};}
  return {status:"written",tab,row};
}

/** Explicit post-crash reconciliation. It NEVER appends. A match may be used
 * by an operator to finalize a stranded writing claim; ambiguous rows stay blocked. */
export async function inspectStrandedPaymentEvent(
  event: PaymentEventCandidate, port: PaymentEventSheetPort,
): Promise<{status:"verified_existing";tab:string;row:number}|{status:"needs_review";reason:"MISSING"|"DUPLICATE"|"ROW_MISMATCH"|"READ_FAILED"}> {
  const expected=paymentEventRow(event);
  let matches: Array<{tab:string;row:number}>;
  try {matches=await port.findSourceKeyAcrossEventTabs(expected[0]);}
  catch{return {status:"needs_review",reason:"READ_FAILED"};}
  if(matches.length===0)return {status:"needs_review",reason:"MISSING"};
  if(matches.length!==1)return {status:"needs_review",reason:"DUPLICATE"};
  const match=matches[0];
  try {
    const actual=await port.readRow(match.tab,match.row);
    const cents=(s:string)=>{const m=/^(\d+)(?:\.(\d{1,2}))?$/.exec(s);return m?BigInt(m[1])*100n+BigInt((m[2]??"").padEnd(2,"0")):null};
    const valid=actual.length>=expected.length&&expected.every((v,i)=>i===8
      ? cents(String(actual[i]??""))!==null&&cents(String(actual[i]??""))===cents(v)
      : String(actual[i]??"")===v);
    return valid?{status:"verified_existing",tab:match.tab,row:match.row}:{status:"needs_review",reason:"ROW_MISMATCH"};
  }catch{return {status:"needs_review",reason:"READ_FAILED"};}
}
