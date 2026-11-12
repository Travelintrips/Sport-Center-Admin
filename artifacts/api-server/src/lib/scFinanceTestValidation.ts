export type TestDirection = "IN" | "OUT";
export type TestLedgerEntry = {
  id: number;
  transaction_date: string;
  source_name: string;
  bank_reference?: string | null;
  method?: string | null;
  sender_bank?: string | null;
  cash_type?: string | null;
  receiving_account?: string | null;
  notes?: string | null;
  direction: TestDirection;
  amount: string | number;
  expense_kind?: string | null;
  destination_bank?: string | null;
  description_version?: number | null;
  admin_fee?: number | string | null;
  base_amount?: number | string | null;
  ppn_amount?: number | string | null;
};
// Category is for reporting only. Historical expense_kind values remain readable.
export const EXPENSE_TEST_KINDS = ["Pembelian Barang","Biaya Operasional","Reimburse Karyawan",
  "Kasbon Karyawan","Pembayaran Vendor","Transportasi","Pengeluaran Lainnya"] as const;
export const PAYMENT_TEST_METHODS = ["Transfer Bank","BI-FAST","QRIS","PLN Prabayar",
  "E-Commerce","Tunai","Kartu Kredit","Kartu Debit","Virtual Account","E-Wallet"] as const;
export const TEST_RECON_STATUS = "SC_TEST_ONLY";
export const TEST_GUARD_VERSION = "sc-test-only-v2";

export function testNo(id: number, direction: TestDirection): string {
  if (!Number.isSafeInteger(id) || id < 1) throw Error("INVALID_TEST_ID");
  // Income uses the historical SC-IN ID prefix; the TEST status remains in H.
  // Expenses retain the old marker until their separate format is reviewed.
  return direction==="IN" ? `SC-IN-${String(id).padStart(6,"0")}`
    : `SC-TEST-OUT-${String(id).padStart(6,"0")}`;
}
export function parseTestInput(body: any) {
  if (!body || !["IN","OUT"].includes(body.direction)) throw Error("INVALID_DIRECTION");
  const date = String(body.transactionDate ?? "");
  const parsedDate=new Date(date+"T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime())
      || parsedDate.toISOString().slice(0,10) !== date)
    throw Error("INVALID_DATE");
  const amount = Number(body.amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000)
    throw Error("TEST_AMOUNT_MUST_BE_1_TO_1000000");
  if (typeof body.entryKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.entryKey))
    throw Error("INVALID_ENTRY_KEY");
  const sourceName = String(body.sourceName ?? "").trim();
  if (!sourceName || sourceName.length > 160) throw Error("INVALID_NAME");
  const senderBank = String(body.senderBank ?? "").trim().slice(0,100);
  const receivingAccount = String(body.receivingAccount ?? "").trim().slice(0,120);
  const cashType = String(body.cashType ?? "").trim().toLowerCase();
  if(!["","kas kecil","kas besar"].includes(cashType))throw Error("INVALID_CASH_TYPE");
  const method = String(body.method ?? "").trim().slice(0,80);
  const bankReference = String(body.bankReference ?? "").trim().slice(0,120);
  const notes = String(body.notes ?? "").trim().slice(0,200);
  const expenseKind = body.direction==="OUT" ? String(body.expenseKind ?? "Pengeluaran Lainnya").trim() : "";
  if(body.direction==="OUT" && !EXPENSE_TEST_KINDS.includes(expenseKind as typeof EXPENSE_TEST_KINDS[number]))
    throw Error("INVALID_EXPENSE_KIND");
  if(body.direction==="OUT" && !PAYMENT_TEST_METHODS.includes(method as typeof PAYMENT_TEST_METHODS[number]))
    throw Error("INVALID_PAYMENT_METHOD");
  const adminFee=Number(body.adminFee??0);
  const ppnAmount=Number(body.ppnAmount??0);
  const baseAmount=Number(body.baseAmount??amount-adminFee-ppnAmount);
  if(![adminFee,ppnAmount,baseAmount].every(x=>Number.isSafeInteger(x)&&x>=0))
    throw Error("INVALID_EXPENSE_COMPONENT");
  if(baseAmount+adminFee+ppnAmount!==amount || (body.direction==="OUT"&&baseAmount<1) ||
     (body.direction==="IN"&&(adminFee!==0||ppnAmount!==0)))
    throw Error("TEST_AMOUNT_BREAKDOWN_MISMATCH");
  const destinationBank = body.direction==="OUT" ? String(body.destinationBank ?? "").trim() : "";
  const destinationAccount = body.direction==="OUT" ? String(body.destinationAccount ?? "").trim() : "";
  if(destinationBank.length>100)throw Error("INVALID_DESTINATION_BANK");
  if(destinationAccount && !/^[0-9]{6,24}$/.test(destinationAccount))throw Error("INVALID_DESTINATION_ACCOUNT");
  const validateProofUrls=(value:unknown,name:string):string[]=>{
    if(!Array.isArray(value) || value.length>10 ||
       value.some((url:unknown)=>typeof url!=="string" || url.length>2000 || !/^https:\/\//i.test(url)))
      throw Error(name);
    return [...new Set(value as string[])];
  };
  // Existing clients/entries are supported without backfilling historical evidence.
  if(Array.isArray(body.paymentProofUrls) && body.paymentProofUrls.length>1)
    throw Error("ONLY_ONE_MAIN_PAYMENT_PROOF");
  const paymentProofUrls=validateProofUrls(body.paymentProofUrls??[],"INVALID_PAYMENT_PROOF_URLS");
  const supportingReceiptUrls=validateProofUrls(body.supportingReceiptUrls??[],"INVALID_SUPPORTING_RECEIPT_URLS");
  if(paymentProofUrls.length>1)throw Error("ONLY_ONE_MAIN_PAYMENT_PROOF");
  if(paymentProofUrls.some(url=>supportingReceiptUrls.includes(url)))
    throw Error("PROOF_CATEGORY_OVERLAP");
  const categorized=[...paymentProofUrls,...supportingReceiptUrls];
  const receiptUrls=validateProofUrls(body.receiptUrls??categorized,"INVALID_TEST_PROOF_URLS");
  if(receiptUrls.length>10)throw Error("MAX_TEN_TEST_PROOFS");
  if(categorized.some(url=>!receiptUrls.includes(url)))
    throw Error("PROOF_CATEGORY_NOT_IN_RECEIPTS");
  return {
    direction:body.direction as TestDirection, transactionDate:date, amount,
    entryKey:body.entryKey, sourceName,senderBank,receivingAccount,cashType,method,
    bankReference,notes,expenseKind,destinationBank,destinationAccount,baseAmount,adminFee,ppnAmount,receiptUrls,paymentProofUrls,supportingReceiptUrls
  };
}
export function testSheetRow(item:TestLedgerEntry) {
  const amount = Number(item.amount);
  if(!Number.isSafeInteger(amount)||amount<=0)throw Error("INVALID_TEST_AMOUNT");
  const date=String(item.transaction_date).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error("INVALID_TEST_DATE");
  const who=String(item.source_name).trim().toUpperCase();
  const source=String(item.sender_bank??"").trim();
  const account=String(item.receiving_account??"").trim();
  const cashType=String(item.cash_type??"").trim().toLowerCase();
  if(!["","kas kecil","kas besar"].includes(cashType))throw Error("INVALID_CASH_TYPE");
  const reference=String(item.bank_reference??"").trim();
  const note=String(item.notes??"").trim();
  // Cash income column B mirrors the October reference workbook:
  // "Dana Masuk dari NAMA | BANK - TUJUAN | ID".
  // No SC-TEST prefix, method label, or automatically inserted SIMULASI note.
  // H still holds SC_TEST_ONLY, G stays empty, and BizPortal v2 skips the row.
  // Legacy rows keep their original B text: reconciliation compares exact Sheets rows.
  // Only newly created version-2 expense entries use the structured description.
  const kind=String(item.expense_kind??item.method??"Lainnya").trim();
  const destination=String(item.destination_bank??"").trim();
  const legacyParts=[source,account].filter(Boolean).join(" - ");
  const legacyDetails=[legacyParts,String(item.method??"").trim(),
    reference?"Ref: "+reference:"",note].filter(Boolean);
  const legacyExpense=`SC-TEST-OUT: Pengeluaran ke ${who}${legacyDetails.length?" | "+legacyDetails.join(" | "):""} | ${testNo(Number(item.id),"OUT")}`;
  const structuredPrefix=kind==="Transfer Bank"||kind==="BI-FAST"
    ? `Transfer ke ${who}`
    : kind==="QRIS"?"Pembayaran QRIS | "+who
    : kind==="PLN Prabayar"?"Pembelian PLN Prabayar | "+who
    : kind==="Top Up E-Wallet"?"Top Up E-Wallet | "+who
    : kind==="Biaya Admin"?"Biaya Admin | "+who
    : kind==="Kasbon Karyawan"?"Kasbon Karyawan | "+who
    : kind==="Tunai"?"Pengeluaran Tunai | "+who
    : `${kind} | ${who}`;
  const structuredExpense=[
    structuredPrefix,
    [destination,note].filter(Boolean).join(" - ") || note,
    reference,
    testNo(Number(item.id),"OUT")
  ].filter(Boolean).join(" | ");
  const method=String(item.method??"").trim();
  const paymentPrefix=method==="QRIS"?"Pembayaran QRIS | "+who:
    method==="PLN Prabayar"?"Pembelian PLN Prabayar | "+who:
    method==="E-Wallet"?"Pembayaran E-Wallet | "+who:
    method==="Tunai"?"Pengeluaran Tunai | "+who:
    method==="E-Commerce"?"Pembayaran E-Commerce | "+who:
    method==="Kartu Kredit"||method==="Kartu Debit"?"Pembayaran Kartu | "+who:
    method==="Virtual Account"?"Pembayaran Virtual Account | "+who:
    "Transfer ke "+who;
  const fee=Number(item.admin_fee??0);
  const base=Number(item.base_amount??0);
  const ppn=Number(item.ppn_amount??0);
  const feeDetail=fee>0?`Biaya Admin Rp${fee.toLocaleString("id-ID")}`:"";
  const version3Description=[paymentPrefix,[destination,note].filter(Boolean).join(" - "),reference,
    feeDetail,testNo(Number(item.id),"OUT")].filter(Boolean).join(" | ");
  const version=Number(item.description_version??1);
  const expenseDescription=version>=3?version3Description:version>=2?structuredExpense:legacyExpense;
  const description=item.direction==="IN"
    ? `Dana Masuk dari ${who} | ${source||"-"} - ${cashType||account||"-"}${cashType?" | "+(account||"-"):""}${reference?" | "+reference:""} | ${testNo(Number(item.id),"IN")}`
    : expenseDescription;
  // A:M. Never invent real bank balance, mutation_key, matching score or COA.
  return [
    date.split("-").reverse().join("/"),description,
    item.direction==="IN"?amount:"",item.direction==="OUT"?amount:"",
    "", item.direction==="IN"?"Pemasukan":"Pengeluaran",
    "",TEST_RECON_STATUS,"","","","",""
  ];
}
export function testRowIndexes(rows:unknown[][], number:string):number[] {
  const result:number[]=[];
  for(let i=0;i<rows.length;i++) {
    if(String(rows[i]?.[0]??"").endsWith(` | ${number}`))result.push(i+1);
  }
  return result;
}
export function testSummary(entries:Array<{direction:TestDirection,amount:string|number,sheet_sync_state:string}>) {
  const synced=entries.filter(x=>x.sheet_sync_state==="synced");
  const incoming=synced.filter(x=>x.direction==="IN").reduce((s,x)=>s+Number(x.amount),0);
  const outgoing=synced.filter(x=>x.direction==="OUT").reduce((s,x)=>s+Number(x.amount),0);
  return {income:incoming,expense:outgoing,balance:incoming-outgoing,
    pending:entries.filter(x=>["pending","syncing","failed"].includes(x.sheet_sync_state)).length,
    count:entries.length};
}
