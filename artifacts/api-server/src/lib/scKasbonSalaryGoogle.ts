import { google } from "googleapis";
import { planKasbonSalaryColumnG, type KasbonTotal } from "./scKasbonTotalSheetPlan";
import {salaryTabForKasbonPeriod} from "./scKasbonMonthlyPeriod";

const SPREADSHEET_ID = "1_Zq5gX7xW35YdI46zeLNguvc6TNb6qP7_vGhTqDAtXg";
const NOVEMBER_GID = 1429288652;
const aliases: Record<string,string> = {
  SC003: "ROBBY",
  SC004: "TRI WISUDO",
  SC008: "SONIK",
};
// The alias list must be reviewed against the registered employees before activation.
// Unmatched or duplicate names always fail closed; no invented rows.
function googleClient() {
 const config = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!config)throw Error("GOOGLE_SERVICE_ACCOUNT_MISSING");
 const credentials = JSON.parse(config);
 if(credentials.client_email!=="sport-center@sport-center-506306.iam.gserviceaccount.com")
  throw Error("GOOGLE_SERVICE_ACCOUNT_UNEXPECTED");
 if(typeof credentials.private_key==="string")credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
 const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
 return google.sheets({version:"v4",auth});
}
export async function syncEmployeeKasbonToSalary(input:KasbonTotal, dryRun:boolean,period:string) {
 const tab=salaryTabForKasbonPeriod(period);
 const tabRange=(cell:string)=>"'" + tab.replace(/'/g,"''") + "'!" + cell;
 // Preview is read-only and must never be blocked by the write switch.
 // Only explicit admin-confirmed sync requests can write; deployment can disable writes with false.
 if(!dryRun && process.env.SC_KASBON_SALARY_SYNC_ENABLED==="false")throw Error("SALARY_SYNC_DISABLED");
 if(process.env.APP_ENV!=="production" || process.env.NODE_ENV!=="production")throw Error("SALARY_PRODUCTION_ENV_REQUIRED");
 const sheets=googleClient();
 const meta=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:"sheets(properties(sheetId,title,gridProperties(rowCount)),protectedRanges,merges)"});
 const matches=(meta.data.sheets??[]).filter(s=>s.properties?.title===tab);
 if(matches.length!==1)throw Error("SALARY_WORKSHEET_NOT_VERIFIED");
 const target=matches[0];const gid=target.properties?.sheetId;
 if(typeof gid!=="number"||!Number.isSafeInteger(gid)||gid<0)throw Error("SALARY_WORKSHEET_NOT_VERIFIED");
 if(period==="2026-11"&&gid!==NOVEMBER_GID)throw Error("SALARY_NOVEMBER_WORKSHEET_ID_CHANGED");
 const rowCount=target.properties?.gridProperties?.rowCount??0;
 if(!Number.isSafeInteger(rowCount)||rowCount<22||rowCount>10000)throw Error("SALARY_ROWS_UNEXPECTED");
 const range=tabRange("A1:H"+rowCount);
 // FORMULA returns formulas, allowing the planner to protect existing formula cells.
 const result=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range,valueRenderOption:"FORMULA"});
 const rows=result.data.values??[];
 // The payroll sheet shortens Robby Rahman to ROBBY: bind only to the known SC003 identity.
 if(input.employeeId==="SC003" && input.fullName.trim().toUpperCase()!=="ROBBY RAHMAN" && input.fullName.trim().toUpperCase()!=="ROBBY")
  throw Error("SALARY_EMPLOYEE_ALIAS_IDENTITY_CHANGED");
 const plan=planKasbonSalaryColumnG([input],rows,aliases);
 const entry=plan.writes[0];
 if(!entry)throw Error("SALARY_EMPLOYEE_NAME_NOT_FOUND");
 const existing=String(rows[entry.row-1]?.[6]??"");
 if(existing.startsWith("="))throw Error("SALARY_KASBON_FORMULA_PROTECTED");
 const cell=tabRange(entry.range);
 const report={employeeId:input.employeeId,name:entry.name,cell:entry.range,previous:existing,amount:entry.amount,spreadsheetId:SPREADSHEET_ID,gid,period,tab};
 if(dryRun){
  // Live Sheets row, not a hardcoded G9/G11 mapping. Read-only on-demand check.
  const raw=rows[entry.row-1]??[];
  const observed=typeof raw[6]==="number" ? raw[6] : Number(String(raw[6]??"").replace(/[^0-9.-]/g,""));
  const matched=String(raw[6]??"").trim()!=="" && Number.isFinite(observed) && observed===entry.amount;
  // FORMULA is required for safety/identity checks, but must never be shown in UI.
  // Read the same employee row as displayed by Google Sheets, including calculated salary cells.
  const displayResult=await sheets.spreadsheets.values.get({
   spreadsheetId:SPREADSHEET_ID,range:tabRange("A"+entry.row+":H"+entry.row),
   valueRenderOption:"FORMATTED_VALUE"
  });
  const display=displayResult.data.values?.[0]??[];
  if(String(display[1]??"").trim()!==entry.name)throw Error("SALARY_ROW_CHANGED_DURING_CHECK");
  return {status:"preview" as const,...report,matched,
   sheetRow:{row:entry.row,number:String(display[0]??""),name:String(display[1]??""),
    uangMakan:String(display[2]??""),hariKerja:String(display[3]??""),
    persentase:String(display[4]??""),totalSalary:String(display[5]??""),
    kasbon:String(display[6]??""),sisaGaji:String(display[7]??"")}};
 }
 // A fresh re-read detects manual changes between preview and writing.
 const before=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:tabRange("A"+entry.row+":G"+entry.row),valueRenderOption:"FORMULA"});
 const live=before.data.values?.[0]??[];
 if(String(live[1]??"").trim()!==entry.name || String(live[6]??"")!==existing)
  throw Error("SALARY_ROW_CHANGED_RETRY");
 await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:cell,valueInputOption:"RAW",requestBody:{values:[[entry.amount]]}});
 const check=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:cell,valueRenderOption:"UNFORMATTED_VALUE"});
 if(Number(check.data.values?.[0]?.[0])!==entry.amount)throw Error("SALARY_READBACK_FAILED");
 return {status:"synced" as const,...report};
}
