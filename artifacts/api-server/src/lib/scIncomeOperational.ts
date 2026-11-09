import {google} from "googleapis";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";

import {INCOME_TAB,INCOME_HEADERS,incomeRowPositions} from "./scIncomeValidation";
export {INCOME_TAB,INCOME_HEADERS,incomeRowPositions,validateIncome,incomeFingerprint} from "./scIncomeValidation";
export const resultRows=(r:any):any[]=>r?.rows??(Array.isArray(r)?r:[]);
// A production admin saving a real receipt authorizes this isolated Sheet write.
// Explicit false is the emergency kill switch. DEV is disabled unless explicitly enabled.
export function incomeSyncEnabled():boolean {
 if(process.env.SC_INCOME_SHEETS_SYNC_ENABLED==="false")return false;
 return process.env.NODE_ENV==="production"||process.env.SC_INCOME_SHEETS_SYNC_ENABLED==="true";
}

async function sheetTarget(){
 if(!incomeSyncEnabled())throw Error("INCOME_SYNC_DISABLED");
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
 if(!incomeSyncEnabled())return "disabled";
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
 if(!incomeSyncEnabled())return;
 const timer=setInterval(async()=>{
  try{const rows=resultRows(await db.execute(sql`SELECT id FROM sport_center.sc_income_entries WHERE
    sheet_sync_state IN ('pending','disabled') OR (sheet_sync_state='failed' AND updated_at<now()-interval '5 minutes')
    OR (sheet_sync_state='syncing' AND sheet_sync_started_at<now()-interval '15 minutes') ORDER BY id LIMIT 10`));
   for(const row of rows)await syncIncomeRow(Number(row.id));
  }catch(e){console.error("[SC_INCOME_RETRY]",e instanceof Error?e.message:"UNKNOWN");}
 },300000);timer.unref();
}
