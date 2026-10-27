/** Stable IDs: one booking can have multiple payments; one payment can have multiple allocations. */
export type BookingSheetsPaymentSource =
  | {kind:"direct";paymentId:number;bookingId:number}
  | {kind:"allocation";paymentId:number;allocationId:number;bookingId:number}
  | {kind:"corporate";invoiceId:number;invoiceItemId:number;bookingId:number};
const id=(n:number)=>{if(!Number.isSafeInteger(n)||n<=0)throw new Error("Invalid source ID");return n;};
export function bookingSheetsEventKey(event:BookingSheetsPaymentSource):string {
  const booking=id(event.bookingId);
  if(event.kind==="direct")return `payment:${id(event.paymentId)}:booking:${booking}`;
  if(event.kind==="allocation")return `payment:${id(event.paymentId)}:allocation:${id(event.allocationId)}:booking:${booking}`;
  return `invoice:${id(event.invoiceId)}:item:${id(event.invoiceItemId)}:booking:${booking}`;
}
const months=["JANUARI","FEBRUARI","MARET","APRIL","MEI","JUNI","JULI","AGUSTUS","SEPTEMBER","OKTOBER","NOVEMBER","DESEMBER"];
export function bookingSheetsPaidTab(value:Date|string):string {
 const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new Error("Invalid paid date");
 const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Jakarta",year:"numeric",month:"numeric"}).formatToParts(d);
 const y=p.find(x=>x.type==="year")?.value;const m=Number(p.find(x=>x.type==="month")?.value);
 if(!y||!Number.isInteger(m)||m<1||m>12)throw new Error("Invalid WIB month");
 return `PAID ${months[m-1]} ${y}`;
}
