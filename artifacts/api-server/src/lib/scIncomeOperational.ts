import {createHash} from "node:crypto";
import {google} from "googleapis";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";

export const INCOME_TAB="SC Uang Masuk";
export const INCOME_HEADERS=["SC Entry ID","Tanggal","Dana Masuk (Dari)","Bank Pengirim","Metode","Bank / Akun Penerima","Nominal IDR","Referensi Bank","Status Bank","Dibuat Pada"];
export type IncomeInput={entryKey:string;transactionDate:string;sourceName:string;senderBank:string;method:string;receivingAccount:string;amount:number;bankReference?:string|null};
export function validateIncome(data:unknown):IncomeInput{
 const o=(data&&typeof data==="object")?data as Record<string,unknown>:{};
 const s=(k:string)=>typeof o[k]==="string"?String(o[k]).trim():"";
 const entryKey=s("entryKey"),transactionDate=s("transactionDate"),sourceName=s("sourceName"),senderBank=s("senderBank"),method=s("method"),receivingAccount=s("receivingAccount"),bankReference=s("bankReference");
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(entryKey))throw Error("INVALID_ENTRY_KEY");
 const d=new Date(transactionDate+"T00:00:00Z");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==transactionDate)throw Error("INVALID_DATE");
 if(sourceName.length<2||sourceName.length>160||senderBank.length<2||senderBank.length>120||receivingAccount.length>160||
   (method==="Transfer Bank"&&receivingAccount.length<2)||!["Transfer Bank","Tunai","QRIS","Lainnya"].includes(method)||bankReference.length>120)throw Error("REQUIRED_FIELD_MISSING");
 if(typeof o.amount!=="number"||!Number.isSafeInteger(o.amount)||o.amount<=0||o.amount>=1e12)throw Error("INVALID_AMOUNT");
 return {entryKey,transactionDate,sourceName,senderBank,method,receivingAccount,amount:o.amount,bankReference:bankReference||null};
}
export function incomeFingerprint(x:IncomeInput):string{
 const n=(s:string|null|undefined)=>String(s??"").trim().toLowerCase().replace(/\s+/g," ");
 return createHash("sha256").update(JSON.stringify([x.transactionDate,n(x.sourceName),n(x.senderBank),n(x.method),n(x.receivingAccount),x.amount,n(x.bankReference)])).digest("hex");
}
export function incomeRowPositions(rows:unknown[][],key:string):number[]{return rows.reduce<number[]>((a,row,i)=>{if(String(row?.[0]??"")===key)a.push(i+1);return a},[])}
export const resultRows=(r:any):any[]=>r?.rows??(Array.isArray(r)?r:[]);
async function sheetTarget(){
 if(process.env.SC_INCOME_SHEETS_SYNC_ENABLED!=="true")throw Error("INCOME_SYNC_DISABLED");
 if(!process.env.GOOGLE_SERVICE_ACCOUNT_JSON)throw Error("GOOGLE_SERVICE_ACCOUNT_NOT_CONFIGURED");
 const rows=resultRows(await db.execute(sql`SELECT sheet_id FROM public.bank_sheet_configs WHERE lower(trim(tab_name))='kas besar sc' AND is_active=true ORDER BY id DESC LIMIT 2`));
 if(rows.length!==1)throw Error("SHEET_CONFIG_MISSING_OR_AMBIGUOUS");
 const id=String(rows[0].sheet_id??"");
 if(process.env.NODE_ENV==="production"&&id!=="1VcbUujz6WHRgj5Fa1QkWjaEnkb2YIxQjkkSpEfMJNE8")throw Error("PROD_TARGET_NOT_ALLOWLISTED");
 if(process.env.NODE_ENV!=="production"&&id==="1VcbUujz6WHRgj5Fa1QkWjaEnkb2YIxQjkkSpEfMJNE8")throw Error("DEV_CANNOT_WRITE_PROD_SHEET");
 if(process.env.SC_INCOME_SPREADSHEET_ID?.trim()&&process.env.SC_INCOME_SPREADSHEET_ID?.trim()!==id)throw Error("SHEET_OVERRIDE_MISMATCH");
 return id;
}
function sheetsClient(){
 const creds=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??"{}");
 if(typeof creds.private_key==="string")creds.private_key=creds.private_key.replace(/\\n/g,"\n");
 const auth=new google.auth.GoogleAuth({credentials:creds,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
 return google.sheets({version:"v4",auth});
}
async function ensureTab(sheets:ReturnType<typeof google.sheets>,id:string){
 const meta=await sheets.spreadsheets.get({spreadsheetId:id,fields:"sheets.properties.title"});
 if(!meta.data.sheets?.some(x=>x.properties?.title===INCOME_TAB)){
  try{await sheets.spreadsheets.batchUpdate({spreadsheetId:id,requestBody:{requests:[{addSheet:{properties:{title:INCOME_TAB}}}]}})}
  catch(e){const updated=await sheets.spreadsheets.get({spreadsheetId:id,fields:"sheets.properties.title"});
   if(!updated.data.sheets?.some(x=>x.properties?.title===INCOME_TAB))throw e;}
 }
 const head=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'SC Uang Masuk'!A1:J1"});
 const row=head.data.values?.[0];
 if(!row?.length)await sheets.spreadsheets.values.update({spreadsheetId:id,range:"'SC Uang Masuk'!A1:J1",valueInputOption:"RAW",requestBody:{values:[INCOME_HEADERS]}});
 else if(INCOME_HEADERS.some((name,i)=>row[i]!==name))throw Error("SHEET_HEADERS_MISMATCH");
}
async function rowKeys(sheets:ReturnType<typeof google.sheets>,id:string){
 const r=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'SC Uang Masuk'!A:A"});
 return (r.data.values??[]) as unknown[][];
}
export async function syncIncomeRow(id:number):Promise<"synced"|"disabled"|"pending">{
 if(process.env.SC_INCOME_SHEETS_SYNC_ENABLED!=="true")return "disabled";
 const claimed=resultRows(await db.execute(sql`UPDATE sport_center.sc_income_entries SET
   sheet_sync_state='syncing',sheet_sync_started_at=now(),sheet_sync_attempts=sheet_sync_attempts+1,updated_at=now()
   WHERE id=${id} AND (sheet_sync_state IN ('pending','failed','disabled')
     OR (sheet_sync_state='syncing' AND sheet_sync_started_at<now()-interval '15 minutes'))
   RETURNING id,entry_key,transaction_date::text,source_name,sender_bank,method,receiving_account,amount::text,bank_reference,created_at::text`))[0];
 if(!claimed){
  const row=resultRows(await db.execute(sql`SELECT sheet_sync_state FROM sport_center.sc_income_entries WHERE id=${id}`))[0];
  if(!row)throw Error("INCOME_NOT_FOUND");
  return row.sheet_sync_state==="synced"?"synced":"pending";
 }
 try{
  const target=await sheetTarget(),sheets=sheetsClient();await ensureTab(sheets,target);
  const matches=incomeRowPositions(await rowKeys(sheets,target),String(claimed.entry_key));
  if(matches.length>1)throw Error("SHEET_READBACK_NOT_UNIQUE");
  if(!matches.length)await sheets.spreadsheets.values.append({spreadsheetId:target,range:"'SC Uang Masuk'!A:J",valueInputOption:"RAW",insertDataOption:"INSERT_ROWS",
    requestBody:{values:[[String(claimed.entry_key),String(claimed.transaction_date).slice(0,10),String(claimed.source_name),
      String(claimed.sender_bank),String(claimed.method),String(claimed.receiving_account),Number(claimed.amount),
      String(claimed.bank_reference??""),"UNVERIFIED",String(claimed.created_at)]]}});
  const checked=incomeRowPositions(await rowKeys(sheets,target),String(claimed.entry_key));
  if(checked.length!==1)throw Error("SHEET_READBACK_NOT_UNIQUE");
  await db.execute(sql`UPDATE sport_center.sc_income_entries SET sheet_sync_state='synced',sheet_synced_at=now(),
      sheet_row=${checked[0]},sheet_sync_error=NULL,updated_at=now() WHERE id=${id} AND sheet_sync_state='syncing'`);
  return "synced";
 }catch(e){
  const message=e instanceof Error?e.message:"UNKNOWN_SYNC_ERROR";
  await db.execute(sql`UPDATE sport_center.sc_income_entries SET sheet_sync_state='failed',
    sheet_sync_error=${message.slice(0,250)},updated_at=now() WHERE id=${id} AND sheet_sync_state='syncing'`);
  return "pending";
 }
}
export function startScIncomeRetryWorker(){
 if(process.env.SC_INCOME_SHEETS_SYNC_ENABLED!=="true")return;
 const timer=setInterval(async()=>{
  try{const rows=resultRows(await db.execute(sql`SELECT id FROM sport_center.sc_income_entries WHERE
    sheet_sync_state IN ('pending','disabled') OR (sheet_sync_state='failed' AND updated_at<now()-interval '5 minutes')
    OR (sheet_sync_state='syncing' AND sheet_sync_started_at<now()-interval '15 minutes') ORDER BY id LIMIT 10`));
   for(const row of rows)await syncIncomeRow(Number(row.id));
  }catch(e){console.error("[SC_INCOME_RETRY]",e instanceof Error?e.message:"UNKNOWN");}
 },300000);timer.unref();
}
