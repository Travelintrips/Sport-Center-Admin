import {google} from "googleapis";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {resultRows} from "./scIncomeOperational";
import {cashIncomeNumber,cashLedgerPositions,cashLedgerRow} from "./scIncomeCashLedgerValidation";

const CASH_TAB="kas besar sc";
const CASH_SHEET_ID="1VcbUujz6WHRgj5Fa1QkWjaEnkb2YIxQjkkSpEfMJNE8";
export const cashLedgerEnabled=()=>process.env.NODE_ENV==="production" && process.env.SC_CASH_LEDGER_SYNC_ENABLED==="true";
function client(){
  const credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??"{}");
  if(typeof credentials.private_key==="string")credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
  return google.sheets({version:"v4",auth:new google.auth.GoogleAuth({
    credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]
  })});
}
async function sheetTarget(){
  // Both the mapping and account type must be read back at runtime.
  // A narrowly scoped app-role RLS policy allows only this cash account.
  const rows=resultRows(await db.execute(sql`SELECT b.sheet_id,b.tab_name,b.company_id,b.bank_account_id,c.account_type
    FROM public.bank_sheet_configs b
    JOIN public.company_bank_accounts c ON c.id=b.bank_account_id AND c.company_id=b.company_id
    WHERE b.id=12 AND b.is_active=true`));
  if(rows.length!==1 || rows[0].sheet_id!==CASH_SHEET_ID ||
     String(rows[0].tab_name).trim().toLowerCase()!==CASH_TAB ||
     Number(rows[0].company_id)!==1 || Number(rows[0].bank_account_id)!==1 ||
     rows[0].account_type!=="cash")
     throw Error("SC_CASH_TARGET_NOT_VERIFIED");
  return CASH_SHEET_ID;
}
// Never treat a bank transfer as physical cash. No guessed balances, COA or reconciliation.
export async function syncConfirmedCashIncome(id:number):Promise<"synced"|"pending"|"disabled">{
  if(!cashLedgerEnabled())return "disabled";
  if(!process.env.GOOGLE_SERVICE_ACCOUNT_JSON)throw Error("GOOGLE_SERVICE_ACCOUNT_NOT_CONFIGURED");
  const claimed=resultRows(await db.execute(sql`UPDATE sport_center.sc_income_entries SET
    cash_sheet_state='syncing',cash_sheet_attempts=cash_sheet_attempts+1,
    cash_sheet_started_at=now(),updated_at=now()
    WHERE id=${id} AND cash_received_confirmed_at IS NOT NULL
      AND method='Tunai' AND receiving_account='Kas Besar SC'
      AND (cash_sheet_state IN ('pending','failed') OR
           (cash_sheet_state='syncing' AND cash_sheet_started_at<now()-interval '15 minutes'))
    RETURNING id,transaction_date::text,source_name,amount::text`))[0];
  if(!claimed){
    const rows=resultRows(await db.execute(sql`SELECT cash_sheet_state FROM sport_center.sc_income_entries WHERE id=${id}`));
    if(!rows.length)throw Error("INCOME_NOT_FOUND");
    return rows[0].cash_sheet_state==="synced"?"synced":"pending";
  }
  try{
    const spreadsheetId=await sheetTarget();
    const sheets=client();
    const metadata=await sheets.spreadsheets.values.get({spreadsheetId,range:"'kas besar sc'!A1:M1"});
    const headers=(metadata.data.values?.[0]??[]).map(v=>String(v).trim().toLowerCase());
    const expected=["tanggal","keterangan coa","debit","kredit","saldo","pp","mutation_key","status_recon"];
    if(expected.some((v,i)=>headers[i]!==v))throw Error("CASH_SHEET_HEADERS_MISMATCH");
    const list=await sheets.spreadsheets.values.get({spreadsheetId,range:"'kas besar sc'!B:B"});
    const number=cashIncomeNumber(Number(id));
    const existing=cashLedgerPositions((list.data.values??[]) as unknown[][],number);
    if(existing.length>1)throw Error("CASH_SHEET_DUPLICATE_ROW");
    if(!existing.length){
      await sheets.spreadsheets.values.append({
        spreadsheetId,range:"'kas besar sc'!A:M",valueInputOption:"RAW",insertDataOption:"INSERT_ROWS",
        requestBody:{values:[cashLedgerRow(claimed)]}
      });
    }
    const readback=await sheets.spreadsheets.values.get({spreadsheetId,range:"'kas besar sc'!B:B"});
    const positions=cashLedgerPositions((readback.data.values??[]) as unknown[][],number);
    if(positions.length!==1)throw Error("CASH_SHEET_READBACK_NOT_UNIQUE");
    const matched=await sheets.spreadsheets.values.get({
      spreadsheetId,range:`'kas besar sc'!A${positions[0]}:F${positions[0]}`,
      valueRenderOption:"UNFORMATTED_VALUE"
    });
    const actual=matched.data.values?.[0]??[];
    const expectedRow=cashLedgerRow(claimed);
    if(actual[1]!==expectedRow[1] || Number(actual[2])!==expectedRow[2] || String(actual[5])!=="Pemasukan")
      throw Error("CASH_SHEET_READBACK_MISMATCH");
    await db.execute(sql`UPDATE sport_center.sc_income_entries SET cash_sheet_state='synced',
      cash_sheet_row=${positions[0]},cash_sheet_error=NULL,cash_sheet_synced_at=now(),updated_at=now()
      WHERE id=${id} AND cash_sheet_state='syncing'`);
    return "synced";
  }catch(e){
    const message=(e instanceof Error?e.message:"CASH_SHEET_SYNC_FAILED").slice(0,250);
    await db.execute(sql`UPDATE sport_center.sc_income_entries SET
      cash_sheet_state='failed',cash_sheet_error=${message},updated_at=now()
      WHERE id=${id} AND cash_sheet_state='syncing'`);
    return "pending";
  }
}


// Separate retry worker: never retries non-cash or unconfirmed bank-account receipts.
export function startScCashLedgerRetryWorker(){
  if(!cashLedgerEnabled())return;
  const timer=setInterval(async()=>{
    try{
      const rows=resultRows(await db.execute(sql`SELECT id FROM sport_center.sc_income_entries
        WHERE cash_received_confirmed_at IS NOT NULL AND method='Tunai'
          AND receiving_account='Kas Besar SC'
          AND (cash_sheet_state='pending'
            OR (cash_sheet_state='failed' AND updated_at<now()-interval '5 minutes')
            OR (cash_sheet_state='syncing' AND cash_sheet_started_at<now()-interval '15 minutes'))
        ORDER BY id LIMIT 10`));
      for(const row of rows)await syncConfirmedCashIncome(Number(row.id));
    }catch(e){console.error("[SC_CASH_LEDGER_RETRY]",e instanceof Error?e.message:"UNKNOWN");}
  },300000);
  timer.unref();
}
