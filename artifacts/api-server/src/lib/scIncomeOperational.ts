import {createHash} from "node:crypto";
import {google} from "googleapis";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";

export const INCOME_TAB="SC Uang Masuk";
export const INCOME_HEADERS=["SC Entry ID","Tanggal","Dana Masuk Dari","Bank Pengirim","Metode","Bank / Akun Penerima","Nominal (Rp)","Status Bank","Dibuat Pada (UTC)","Nomor Ref"];
export type IncomePayload={entryKey:string;transactionDate:string;sourceName:string;senderBank:string;method:string;receivingAccount:string;amount:number;bankReference:string};
export function validateIncome(input:unknown):IncomePayload{
 const p=(input??{}) as Record<string,unknown>;
 const val=(field:string,max:number)=>typeof p[field]==="string" && (p[field] as string).length<=max?(p[field] as string).trim():"";
 const entryKey=val("entryKey",40),transactionDate=val("transactionDate",10);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entryKey))throw Error("INVALID_ENTRY_KEY");
 if(!/^\d{4}-\d\d-\d\d$/.test(transactionDate)||Number.isNaN(Date.parse(transactionDate))||new Date(transactionDate+"T00:00:00Z").toISOString().slice(0,10)!==transactionDate)throw Error("INVALID_DATE");
 const sourceName=val("sourceName",150),senderBank=val("senderBank",100),receivingAccount=val("receivingAccount",150),method=val("method",32),bankReference=val("bankReference",120);
 if(sourceName.length<2||senderBank.length<2||receivingAccount.length<2)throw Error("REQUIRED_FIELD_MISSING");
 if(!["Transfer Bank","Tunai","QRIS","Lainnya"].includes(method))throw Error("INVALID_METHOD");
 const amount=p.amount;
 if(typeof amount!=="number"||!Number.isSafeInteger(amount)||amount<1||amount>1_000_000_000_000)throw Error("INVALID_AMOUNT");
 return {entryKey,transactionDate,sourceName,senderBank,method,receivingAccount,amount,bankReference};
}
export function incomeFingerprint(p:IncomePayload){
 return createHash("sha256").update([p.transactionDate,p.sourceName,p.senderBank,p.method,p.receivingAccount,String(p.amount),p.bankReference].map(x=>x.trim().toLowerCase()).join("|")).digest("hex");
}
export const resultRows=(x:any):any[]=>x?.rows??x??[];
export async function listIncome(){
 return resultRows(await db.execute(sql`SELECT id,entry_key::text AS "entryKey",transaction_date::text AS "transactionDate",source_name AS "sourceName",sender_bank AS "senderBank",method,receiving_account AS "receivingAccount",amount::text,bank_reference AS "bankReference",reconciliation_state AS "reconciliationState",sheet_sync_state AS "sheetSyncState",sheet_sync_error AS "sheetSyncError",sheet_synced_at AS "sheetSyncedAt",created_at AS "createdAt" FROM sport_center.sc_income_entries ORDER BY id DESC LIMIT 100`));
}
async function target(){
 if(process.env.SC_INCOME_SHEETS_SYNC_ENABLED!=="true")throw Error("INCOME_SYNC_DISABLED");
 const id=process.env.SC_INCOME_SPREADSHEET_ID?.trim();
 if(!id)throw Error("INCOME_SPREADSHEET_NOT_CONFIGURED");
 const prod=process.env.NODE_ENV==="production";
 if((process.env.APP_ENV==="production")!==prod)throw Error("ENV_MISMATCH");
 const configs=resultRows(await db.execute(sql`SELECT sheet_id FROM public.bank_sheet_configs WHERE lower(trim(tab_name))='kas besar sc' AND is_active=true AND company_id IS NOT NULL AND bank_account_id IS NOT NULL ORDER BY id DESC LIMIT 2`));
 if(configs.length!==1||configs[0].sheet_id!==id)throw Error("SHEET_CONFIG_MISMATCH");
 if(!prod && id==="1VcbUujz6WHRgj5Fa1QkWjaEnkb2YIxQjkkSpEfMJNE8")throw Error("DEV_CANNOT_WRITE_PROD_SHEET");
 return id;
}
function client(){
 const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!raw)throw Error("GOOGLE_CREDENTIALS_NOT_CONFIGURED");
 const credentials=JSON.parse(raw);
 if(typeof credentials.private_key==="string")credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
 return google.sheets({version:"v4",auth:new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]})});
}
/** Claim first; retry reads back the entry UUID before writing to prevent duplicate rows. */
export async function syncIncomeRow(id:number):Promise<"synced"|"failed"|"disabled">{
 const claimed=resultRows(await db.execute(sql`UPDATE sport_center.sc_income_entries SET sheet_sync_state='syncing',sheet_sync_started_at=now(),sheet_sync_error=NULL,updated_at=now() WHERE id=${id} AND (sheet_sync_state IN ('pending','failed','disabled') OR (sheet_sync_state='syncing' AND sheet_sync_started_at < now()-interval '15 minutes')) RETURNING entry_key::text,transaction_date::text,source_name,sender_bank,method,receiving_account,amount::text,bank_reference,created_at`))[0];
 if(!claimed)return "disabled";
 try{
  const spreadsheetId=await target(),sheets=client();
  let meta=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(sheetId,title))"});
  if(!meta.data.sheets?.some(s=>s.properties?.title===INCOME_TAB)){
   await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{addSheet:{properties:{title:INCOME_TAB}}}]}});
   meta=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(sheetId,title))"});
  }
  if(!meta.data.sheets?.some(s=>s.properties?.title===INCOME_TAB))throw Error("INCOME_TAB_UNAVAILABLE");
  const range="'SC Uang Masuk'!";
  const existing=await sheets.spreadsheets.values.get({spreadsheetId,range:range+"A1:J100000",valueRenderOption:"UNFORMATTED_VALUE"});
  const all=existing.data.values??[];
  if(all.length && all[0]?.[0]!==INCOME_HEADERS[0])throw Error("SHEET_HEADERS_MISMATCH");
  const found=all.reduce<number[]>((a,r,i)=>{if(String(r?.[0])===claimed.entry_key)a.push(i+1);return a},[]);
  if(found.length>1)throw Error("DUPLICATE_SHEET_KEY");
  if(found.length===0){
   if(!all.length)await sheets.spreadsheets.values.update({spreadsheetId,range:range+"A1:J1",valueInputOption:"RAW",requestBody:{values:[INCOME_HEADERS]}});
   await sheets.spreadsheets.values.append({spreadsheetId,range:range+"A:J",valueInputOption:"RAW",insertDataOption:"INSERT_ROWS",requestBody:{values:[[
    claimed.entry_key,claimed.transaction_date,claimed.source_name,claimed.sender_bank,claimed.method,claimed.receiving_account,
    Number(claimed.amount),"UNVERIFIED",new Date(claimed.created_at).toISOString(),claimed.bank_reference??""
   ]]}});
  }
  const read=await sheets.spreadsheets.values.get({spreadsheetId,range:range+"A1:J100000",valueRenderOption:"UNFORMATTED_VALUE"});
  const matches=(read.data.values??[]).reduce<number[]>((a,r,i)=>{if(String(r?.[0])===claimed.entry_key)a.push(i+1);return a},[]);
  if(matches.length!==1)throw Error("SHEET_READBACK_NOT_UNIQUE");
  const v=read.data.values?.[matches[0]-1]??[];
  if(Number(v[6])!==Number(claimed.amount)||String(v[7])!=="UNVERIFIED")throw Error("SHEET_READBACK_MISMATCH");
  await db.execute(sql`UPDATE sport_center.sc_income_entries SET sheet_sync_state='synced',sheet_sync_error=NULL,sheet_row=${matches[0]},sheet_synced_at=now(),updated_at=now() WHERE id=${id}`);
  return "synced";
 }catch(e){
  const message=e instanceof Error?e.message:"UNKNOWN_SYNC_FAILURE";
  const disabled=["INCOME_SYNC_DISABLED","INCOME_SPREADSHEET_NOT_CONFIGURED"].includes(message);
  await db.execute(sql`UPDATE sport_center.sc_income_entries SET sheet_sync_state=${disabled?"disabled":"failed"},sheet_sync_error=${message.slice(0,160)},updated_at=now() WHERE id=${id}`);
  return disabled?"disabled":"failed";
 }
}
