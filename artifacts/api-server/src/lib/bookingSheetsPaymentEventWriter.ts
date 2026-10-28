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
