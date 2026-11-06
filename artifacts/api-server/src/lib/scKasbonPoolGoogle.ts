import {google} from "googleapis";
import {discoverKasbonSection, sheetCell} from "./scKasbonPoolDiscovery";
import {planDynamicKasbon} from "./scKasbonPoolDynamicPlan";

const PROD_ID="17KtD8OSmyYo-d6jsOa6t7DMH76gjcJvdxdNSHPS_FP8";
const PROD_GID=1953055393;
const TAB="'Kasbon POOL'";

/** Never infer a mapping from a similar name: the employeeID/label association is
 * already validated against a one-time verified row alias in PostgreSQL.
 */
export async function writeNewKasbonToPool(input:{
 id:number;employeeId:string;employeeName:string;verifiedSheetLabel:string;
 kasbonDate:string;amount:string;
}):Promise<{cell:string;sheetId:string;amount:string}> {
 if(process.env.SC_KASBON_POOL_SYNC_ENABLED!=="true")throw Error("SYNC_DISABLED");
 const prod=process.env.APP_ENV==="production",nodeProd=process.env.NODE_ENV==="production";
 if(prod!==nodeProd)throw Error("ENVIRONMENT_MISMATCH");
 const spreadsheetId=process.env.SC_KASBON_POOL_SPREADSHEET_ID?.trim();
 const gid=Number(process.env.SC_KASBON_POOL_SHEET_GID);
 if(!spreadsheetId||!Number.isSafeInteger(gid))throw Error("TARGET_NOT_CONFIGURED");
 if(prod?(spreadsheetId!==PROD_ID||gid!==PROD_GID):spreadsheetId===PROD_ID)
  throw Error("SPREADSHEET_ENVIRONMENT_MISMATCH");
 const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!raw)throw Error("GOOGLE_SERVICE_ACCOUNT_MISSING");
 const creds=JSON.parse(raw);
 if(typeof creds.private_key==="string")creds.private_key=creds.private_key.replace(/\\n/g,"\n");
 const auth=new google.auth.GoogleAuth({credentials:creds,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
 const sheets=google.sheets({version:"v4",auth});
 const meta=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(sheetId,title,gridProperties(rowCount)))"});
 const targets=(meta.data.sheets??[]).filter(s=>s.properties?.sheetId===gid&&s.properties?.title==="Kasbon POOL");
 if(targets.length!==1)throw Error("KASBON_TARGET_TAB_UNVERIFIED");
 const rowCount=targets[0]?.properties?.gridProperties?.rowCount??0;
 if(!Number.isSafeInteger(rowCount)||rowCount<1||rowCount>20000)throw Error("KASBON_SHEET_SIZE_UNEXPECTED");
 const range=TAB+"!A1:AK"+rowCount;
 const [f,u,v]=await Promise.all([
  sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:"FORMATTED_VALUE"}),
  sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:"UNFORMATTED_VALUE"}),
  sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:"FORMULA"})
 ]);
 const formatted=f.data.values??[],unformatted=u.data.values??[],formulas=v.data.values??[];
 const section=discoverKasbonSection(formatted,unformatted,input.kasbonDate,input.verifiedSheetLabel);
 const plan=planDynamicKasbon(section,formulas,unformatted,input.amount);
 if(plan.status!=="ready")throw Error(plan.reason);
 const changes=[{range:TAB+"!"+plan.destination,values:[[Number(input.amount)]]},
  ...plan.repairs.map(r=>({range:TAB+"!"+r.cell,values:[[r.formula]]}))];
 // Minimize races with humans / other workers: re-read every intended cell,
 // compare with the exact original formula/value before writing.
 const before=await sheets.spreadsheets.values.batchGet({
  spreadsheetId,ranges:changes.map(x=>x.range),valueRenderOption:"FORMULA"
 });
 for(let i=0;i<changes.length;i++){
  const m=changes[i].range.match(/!([A-Z]+)(\d+)$/);
  if(!m)throw Error("KASBON_RANGE_INVALID");
  const c=m[1].split("").reduce((acc,ch)=>acc*26+ch.charCodeAt(0)-64,0);
  const original=sheetCell(formulas,Number(m[2]),c);
  const live=String(before.data.valueRanges?.[i]?.values?.[0]?.[0]??"").trim();
  if(original!==live)throw Error("KASBON_SHEET_CHANGED_DURING_PREFLIGHT");
 }
 await sheets.spreadsheets.values.batchUpdate({spreadsheetId,
  requestBody:{valueInputOption:"USER_ENTERED",data:changes}});
 const readRanges=[plan.destination,plan.employeeTotalCell,plan.dayTotalCell,plan.monthTotalCell];
 const after=await sheets.spreadsheets.values.batchGet({
  spreadsheetId,ranges:readRanges.map(cell=>TAB+"!"+cell),valueRenderOption:"UNFORMATTED_VALUE"
 });
 const n=(i:number)=>Number(after.data.valueRanges?.[i]?.values?.[0]?.[0]);
 const amount=Number(input.amount);
 if(!Number.isFinite(amount)||
  Math.abs(n(0)-amount)>0.001 ||
  Math.abs(n(1)-(plan.before.employee+amount))>0.001 ||
  Math.abs(n(2)-(plan.before.day+amount))>0.001 ||
  Math.abs(n(3)-(plan.before.month+amount))>0.001)
   throw Error("KASBON_SHEETS_READBACK_MISMATCH");
 return {cell:plan.destination,sheetId:spreadsheetId,amount:input.amount};
}
