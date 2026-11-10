import {google} from "googleapis";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {resultRows} from "./scIncomeOperational";
import {TEST_GUARD_VERSION,testNo,testRowIndexes,testSheetRow} from "./scFinanceTestValidation";

const CASH_SHEET_ID="1VcbUujz6WHRgj5Fa1QkWjaEnkb2YIxQjkkSpEfMJNE8";
const CASH_TAB="kas besar sc";
export const testSheetWritingEnabled=()=>
  // No background worker exists: only an explicit Super Admin test submission can write.
  // Even when enabled, the deployed BizPortal guard must respond successfully every time.
  process.env.NODE_ENV==="production" && process.env.SC_FINANCE_TEST_SHEETS_ENABLED!=="false";

async function assertBizPortalTestGuard(){
  // Fail CLOSED if BizPortal has not deployed the test-row exclusion.
  const response=await fetch("https://bizportal.cstlogistic.co.id/api/healthz",{
    headers:{"Cache-Control":"no-cache"},
    signal:AbortSignal.timeout(6000)
  });
  if(!response.ok)throw Error("SC_TEST_BIZPORTAL_GUARD_NOT_READY");
  const json=await response.json() as {scTestGuard?:string,status?:string};
  if(json.status!=="ok" || json.scTestGuard!==TEST_GUARD_VERSION)
    throw Error("SC_TEST_BIZPORTAL_GUARD_NOT_READY");
}
async function assertCashSheetConfiguration(){
  const rows=resultRows(await db.execute(sql`SELECT b.sheet_id,b.tab_name,b.company_id,b.bank_account_id,c.account_type
    FROM public.bank_sheet_configs b
    JOIN public.company_bank_accounts c ON c.id=b.bank_account_id AND c.company_id=b.company_id
    WHERE b.id=12 AND b.is_active=true`));
  if(rows.length!==1 || rows[0].sheet_id!==CASH_SHEET_ID ||
    String(rows[0].tab_name).trim().toLowerCase()!==CASH_TAB ||
    Number(rows[0].company_id)!==1 || Number(rows[0].bank_account_id)!==1 ||
    rows[0].account_type!=="cash")
    throw Error("SC_TEST_SHEET_TARGET_NOT_VERIFIED");
}
function googleSheetsClient(){
  const credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??"{}");
  if(typeof credentials.private_key==="string")
    credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
  return google.sheets({version:"v4",auth:new google.auth.GoogleAuth({
    credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]
  })});
}
function assertHeaders(headers:string[]){
  const normalized=headers.map(x=>String(x).trim().toLowerCase().replace(/\s+/g," "));
  const expected=["tanggal","keterangan coa","debit","kredit","saldo","pp",
    "mutation_key","status_recon","nama_coa","match_score","match_result","last_sync","coa"];
  if(normalized[0]!=="tanggal" || !["keterangan coa","keterangan"].includes(normalized[1]) ||
     expected.slice(2).some((x,i)=>normalized[i+2]!==x))
    throw Error("SC_TEST_CASH_SHEET_HEADERS_MISMATCH");
}
export async function syncScFinanceTestRow(id:number):Promise<"synced"|"pending"|"disabled"> {
  if(!testSheetWritingEnabled())return "disabled";
  if(!process.env.GOOGLE_SERVICE_ACCOUNT_JSON)throw Error("SC_TEST_SHEET_CREDENTIALS_MISSING");
  // Runtime proof precedes any mutation, including claim and Google writes.
  await assertBizPortalTestGuard();
  await assertCashSheetConfiguration();
  const claim=resultRows(await db.execute(sql`UPDATE sport_center.sc_finance_test_entries SET
    sheet_sync_state='syncing',sheet_sync_attempts=sheet_sync_attempts+1,
    sheet_sync_started_at=now(),updated_at=now()
    WHERE id=${id} AND (sheet_sync_state IN ('pending','failed') OR
      (sheet_sync_state='syncing' AND sheet_sync_started_at<now()-interval '15 minutes'))
    RETURNING id,direction,transaction_date::text,source_name,sender_bank,receiving_account,
      method,bank_reference,notes,amount::text`))[0];
  if(!claim){
    const existing=resultRows(await db.execute(sql`SELECT sheet_sync_state
      FROM sport_center.sc_finance_test_entries WHERE id=${id}`))[0];
    if(!existing)throw Error("SC_TEST_ENTRY_NOT_FOUND");
    return existing.sheet_sync_state==="synced"?"synced":"pending";
  }
  try{
    const sheets=googleSheetsClient();
    const headers=await sheets.spreadsheets.values.get({
      spreadsheetId:CASH_SHEET_ID,range:"'kas besar sc'!A1:M1"
    });
    assertHeaders((headers.data.values?.[0]??[]) as string[]);
    const number=testNo(Number(id),claim.direction);
    const all=await sheets.spreadsheets.values.get({
      spreadsheetId:CASH_SHEET_ID,range:"'kas besar sc'!B:B"
    });
    const existing=testRowIndexes((all.data.values??[]) as unknown[][],number);
    if(existing.length>1)throw Error("SC_TEST_DUPLICATE_SHEET_ROW");
    if(existing.length===0){
      await assertBizPortalTestGuard(); // fresh guard read immediately before insert
      await sheets.spreadsheets.values.append({
        spreadsheetId:CASH_SHEET_ID,range:"'kas besar sc'!A:M",
        valueInputOption:"RAW",insertDataOption:"INSERT_ROWS",
        requestBody:{values:[testSheetRow(claim)]}
      });
    }
    const proof=await sheets.spreadsheets.values.get({
      spreadsheetId:CASH_SHEET_ID,range:"'kas besar sc'!B:B"
    });
    const matched=testRowIndexes((proof.data.values??[]) as unknown[][],number);
    if(matched.length!==1)throw Error("SC_TEST_SHEET_READBACK_NOT_UNIQUE");
    const readback=await sheets.spreadsheets.values.get({
      spreadsheetId:CASH_SHEET_ID,range:`'kas besar sc'!A${matched[0]}:M${matched[0]}`,
      valueRenderOption:"UNFORMATTED_VALUE"
    });
    const row=readback.data.values?.[0]??[];
    const expected=testSheetRow(claim);
    if(row[1]!==expected[1] ||
       Number(row[2]||0)!==Number(expected[2]||0) ||
       Number(row[3]||0)!==Number(expected[3]||0) ||
       row[5]!==expected[5] ||
       String(row[6]??"")!=="" || row[7]!=="SC_TEST_ONLY")
      throw Error("SC_TEST_SHEET_READBACK_MISMATCH");
    await db.execute(sql`UPDATE sport_center.sc_finance_test_entries SET
      sheet_sync_state='synced',sheet_row=${matched[0]},sheet_sync_error=NULL,
      sheet_synced_at=now(),updated_at=now()
      WHERE id=${id} AND sheet_sync_state='syncing'`);
    return "synced";
  }catch(e){
    const message=(e instanceof Error?e.message:"SC_TEST_SYNC_FAILED").slice(0,250);
    await db.execute(sql`UPDATE sport_center.sc_finance_test_entries
      SET sheet_sync_state='failed',sheet_sync_error=${message},updated_at=now()
      WHERE id=${id} AND sheet_sync_state='syncing'`);
    return "pending";
  }
}

// A bounded retry worker lets a confirmed Super Admin test complete after
// a temporary Google/BizPortal outage. All writes still require live guard proof.
export function startScFinanceTestRetryWorker(){
  if(!testSheetWritingEnabled())return;
  const timer=setInterval(async()=>{
    try{
      const rows=resultRows(await db.execute(sql`SELECT id FROM sport_center.sc_finance_test_entries
        WHERE sheet_sync_state='pending'
          OR (sheet_sync_state='failed' AND updated_at<now()-interval '5 minutes')
          OR (sheet_sync_state='syncing' AND sheet_sync_started_at<now()-interval '15 minutes')
        ORDER BY id LIMIT 3`));
      for(const row of rows){
        try{await syncScFinanceTestRow(Number(row.id));}
        catch(e){console.warn("[SC_FINANCE_TEST_GUARD]",e instanceof Error?e.message:"NOT_READY");}
      }
    }catch(e){console.error("[SC_FINANCE_TEST_RETRY]",e instanceof Error?e.message:"UNKNOWN");}
  },60000);
  timer.unref();
}
