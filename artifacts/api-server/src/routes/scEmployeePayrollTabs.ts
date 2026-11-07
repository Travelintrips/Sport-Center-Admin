import {Router} from "express";
import {google} from "googleapis";
import {adminMiddleware} from "../lib/auth";
import {logAudit,getClientInfo,getUserFromReq} from "../lib/auditLog";
import {planPayrollDraft,salaryTabTitle} from "../lib/scEmployeePayrollTabPlan";

const router=Router();
const PROD_SPREADSHEET="1_Zq5gX7xW35YdI46zeLNguvc6TNb6qP7_vGhTqDAtXg";
const NOVEMBER_GID=1429288652;
const EXPECTED_ACCOUNT="sport-center@sport-center-506306.iam.gserviceaccount.com";
let writing=false;

function input(body:any):string {
 const period=typeof body?.period==="string"?body.period:"";
 if(Object.keys(body??{}).some(key=>key!=="period")||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))
  throw Error("PAYROLL_PERIOD_INVALID");
 return period;
}
async function inspect(period:string) {
 // Never let a DEV instance read or mutate the production salary workbook.
 if(process.env.APP_ENV!=="production"||process.env.NODE_ENV!=="production")
  throw Error("PAYROLL_PRODUCTION_ONLY");
 const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!raw)throw Error("GOOGLE_SERVICE_ACCOUNT_MISSING");
 const credentials=JSON.parse(raw);
 if(credentials.client_email!==EXPECTED_ACCOUNT)throw Error("GOOGLE_SERVICE_ACCOUNT_UNEXPECTED");
 if(typeof credentials.private_key==="string")credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
 const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
 const sheets=google.sheets({version:"v4",auth});
 const meta=await sheets.spreadsheets.get({spreadsheetId:PROD_SPREADSHEET,
  fields:"sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)),protectedRanges)"});
 const targetTitle=salaryTabTitle(period);
 if(meta.data.sheets?.some(s=>s.properties?.title?.toLocaleLowerCase("id-ID")===targetTitle.toLocaleLowerCase("id-ID")))
  throw Error("PAYROLL_TAB_ALREADY_EXISTS");
 const sourceTitle=salaryTabTitle((()=>{const [y,m]=period.split("-").map(Number);return `${m===1?y-1:y}-${String(m===1?12:m-1).padStart(2,"0")}`;})());
 const sources=(meta.data.sheets??[]).filter(s=>s.properties?.title===sourceTitle);
 if(sources.length!==1)throw Error("PAYROLL_PREVIOUS_TAB_MISSING");
 const source=sources[0];
 const sourceId=source.properties?.sheetId;
 const count=source.properties?.gridProperties?.rowCount??0;
 const cols=source.properties?.gridProperties?.columnCount??0;
 // Google Sheets gridProperties describes allocated cells (often 1000+ blank rows),
 // not the number of populated payroll records. Validate grid safety separately
 // from the actual populated A:M range returned by values.get.
 if(!Number.isSafeInteger(sourceId)||count<20||count>20000||cols<13||cols>2000)
  throw Error("PAYROLL_TEMPLATE_LAYOUT_UNSAFE");
 if(sourceId===NOVEMBER_GID && sourceTitle!=="Gaji November 2026")throw Error("PAYROLL_TEMPLATE_ID_MISMATCH");
 if(sourceTitle==="Gaji November 2026"&&sourceId!==NOVEMBER_GID)throw Error("PAYROLL_TEMPLATE_ID_MISMATCH");
 const values=await sheets.spreadsheets.values.get({
  spreadsheetId:PROD_SPREADSHEET,range:"'"+sourceTitle.replace(/'/g,"''")+"'!A:M",
  valueRenderOption:"FORMULA"
 });
 // Unbounded A:M returns only used rows, even when the grid has 1000+ blank
 // allocated rows. Never silently ignore populated rows past the safe limit.
 const rows=values.data.values??[];
 if(rows.length<20||rows.length>200)throw Error("PAYROLL_TEMPLATE_POPULATED_ROWS_UNSAFE");
 const plan=planPayrollDraft(period,rows);
 return {sheets,plan,sourceId:sourceId!,spreadsheetId:PROD_SPREADSHEET,rowCount:rows.length,sourceRows:rows,
  sheetIds:(meta.data.sheets??[]).map(x=>x.properties?.sheetId).filter((id):id is number=>Number.isSafeInteger(id))};
}
router.post("/admin/sc-employees/payroll-tabs/preview",adminMiddleware,async(req,res)=>{
 try{
  const period=input(req.body);
  const {plan}=await inspect(period);
  res.setHeader("Cache-Control","no-store");
  res.json({...plan,writeEnabled:process.env.SC_SALARY_TAB_CREATE_ENABLED==="true"});
 }catch(e){res.status(422).json({error:e instanceof Error?e.message:"PAYROLL_PREVIEW_FAILED"});}
});
router.post("/admin/sc-employees/payroll-tabs/create",adminMiddleware,async(req,res)=>{
 if(process.env.SC_SALARY_TAB_CREATE_ENABLED!=="true"){
  res.status(503).json({error:"PAYROLL_TAB_CREATE_DISABLED"});return;
 }
 if(writing){res.status(409).json({error:"PAYROLL_TAB_CREATE_BUSY"});return;}
 writing=true;
 try{
  const period=input(req.body);
  const {sheets,plan,sourceId,spreadsheetId,rowCount,sheetIds,sourceRows}=await inspect(period);
  // The copy and hidden flag are committed in one Sheets batch to avoid
  // briefly exposing the previous month's payroll amounts.
  const newId=Math.max(...sheetIds)+1;
  if(!Number.isSafeInteger(newId)||newId>=2147483647)throw Error("PAYROLL_SHEET_ID_LIMIT");
  const response=await sheets.spreadsheets.batchUpdate({spreadsheetId,
   requestBody:{requests:[
    {duplicateSheet:{sourceSheetId:sourceId,newSheetId:newId,newSheetName:plan.targetTitle}},
    {updateSheetProperties:{properties:{sheetId:newId,hidden:true},fields:"hidden"}}
   ]}});
  if(response.data.replies?.[0]?.duplicateSheet?.properties?.sheetId!==newId)
   throw Error("PAYROLL_DUPLICATE_ID_MISSING");
  const escaped=plan.targetTitle.replace(/'/g,"''");
  // A full sheet duplication already preserves ALL data, formulas and formatting.
  // Never clear payroll amounts: the user explicitly requires the new tab to
  // start with the exact previous-month column values.
  const check=await sheets.spreadsheets.values.get({spreadsheetId,
   range:`'${escaped}'!A1:M${rowCount}`,valueRenderOption:"FORMULA"});
  const after=check.data.values??[];
  if(after.length!==sourceRows.length||sourceRows.some((row,i)=>
    row.some((value,c)=>String(after[i]?.[c]??"")!==String(value??""))))
   throw Error("PAYROLL_FULL_COPY_READBACK_FAILED");
  const metadata=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(sheetId,title,hidden))"});
  const draft=metadata.data.sheets?.find(s=>s.properties?.sheetId===newId);
  if(draft?.properties?.title!==plan.targetTitle||draft.properties.hidden!==true)
   throw Error("PAYROLL_DRAFT_METADATA_FAILED");
  await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[
   {updateSheetProperties:{properties:{sheetId:newId,hidden:false},fields:"hidden"}}
  ]}});
  const audit={period,sourceTitle:plan.sourceTitle,targetTitle:plan.targetTitle,sheetId:newId,
   employeeCount:plan.employeeCount,copiedCells:sourceRows.reduce((n,row)=>n+row.filter(v=>v!==""&&v!==null&&v!==undefined).length,0)};
  await logAudit({...getUserFromReq(req),action:"SC_PAYROLL_MONTHLY_TAB_CREATED",
   entity:"sc_employee_payroll_tab",after:audit,...getClientInfo(req)});
  res.json({created:true,...audit,url:`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${newId}#gid=${newId}`});
 }catch(e){
  // If a copy was created but not fully verified, it remains hidden for manual recovery.
  res.status(422).json({error:e instanceof Error?e.message:"PAYROLL_TAB_CREATE_FAILED"});
 }finally{writing=false;}
});

// One-time, fail-closed repair for the already-created December 2026 tab.
// Copy only cells cleared by the older implementation; never overwrite user
// changes or create/delete a worksheet in this repair operation.
async function decemberRepairPlan(){
 if(process.env.APP_ENV!=="production"||process.env.NODE_ENV!=="production")
  throw Error("PAYROLL_PRODUCTION_ONLY");
 const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!raw)throw Error("GOOGLE_SERVICE_ACCOUNT_MISSING");
 const credentials=JSON.parse(raw);
 if(credentials.client_email!==EXPECTED_ACCOUNT)throw Error("GOOGLE_SERVICE_ACCOUNT_UNEXPECTED");
 if(typeof credentials.private_key==="string")credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
 const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
 const sheets=google.sheets({version:"v4",auth});
 const spreadsheetId=PROD_SPREADSHEET;
 const meta=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))"});
 const source=meta.data.sheets?.filter(x=>x.properties?.sheetId===NOVEMBER_GID&&x.properties.title==="Gaji November 2026");
 const destination=meta.data.sheets?.filter(x=>x.properties?.title==="Gaji Desember 2026");
 if(source?.length!==1||destination?.length!==1||destination[0].properties?.hidden)
  throw Error("PAYROLL_REPAIR_SHEETS_UNVERIFIED");
 const destId=destination[0].properties!.sheetId;
 if(!Number.isSafeInteger(destId)||destId===NOVEMBER_GID)throw Error("PAYROLL_REPAIR_DESTINATION_UNSAFE");
 const [a,b]=await Promise.all([
  sheets.spreadsheets.values.get({spreadsheetId,range:"'Gaji November 2026'!A:M",valueRenderOption:"FORMULA"}),
  sheets.spreadsheets.values.get({spreadsheetId,range:"'Gaji Desember 2026'!A:M",valueRenderOption:"FORMULA"})
 ]);
 const sourceRows=a.data.values??[],destRows=b.data.values??[];
 if(sourceRows.length<20||sourceRows.length>200||destRows.length>200)
  throw Error("PAYROLL_REPAIR_ROWS_UNSAFE");
 const planned=planPayrollDraft("2026-12",sourceRows);
 if(planned.employeeCount<4)throw Error("PAYROLL_REPAIR_TEMPLATE_UNSAFE");
 const missing:Array<{r:number;c:number;cell:string}>=[];
 const conflicts:string[]=[];
 for(let r=0;r<sourceRows.length;r++){
  const row=sourceRows[r]??[],to=destRows[r]??[];
  for(let c=0;c<13;c++){
   const from=String(row[c]??"").trim(),current=String(to[c]??"").trim();
   if(!from&&!current)continue;
   if(!from&&current){conflicts.push(String.fromCharCode(65+c)+(r+1));continue;}
   if(from===current)continue;
   const cell=String.fromCharCode(65+c)+(r+1);
   if(!current)missing.push({r,c,cell});
   else conflicts.push(cell);
  }
 }
 if(conflicts.length)throw Error("PAYROLL_REPAIR_CONFLICT_NONEMPTY_CELLS:"+conflicts.slice(0,8).join(","));
 if(missing.length>600)throw Error("PAYROLL_REPAIR_TOO_MANY_CELLS");
 return {sheets,spreadsheetId,sourceId:NOVEMBER_GID,destId:destId!,missing,
  sourceRows,employeeCount:planned.employeeCount};
}
router.post("/admin/sc-employees/payroll-tabs/restore-december-preview",adminMiddleware,async(_req,res)=>{
 try{
  const plan=await decemberRepairPlan();
  res.setHeader("Cache-Control","no-store");
  res.json({sourceTitle:"Gaji November 2026",targetTitle:"Gaji Desember 2026",
   employeeCount:plan.employeeCount,missingCells:plan.missing.length,
   sampleCells:plan.missing.slice(0,12).map(x=>x.cell),
   writeEnabled:process.env.SC_SALARY_TAB_CREATE_ENABLED==="true"});
 }catch(e){res.status(422).json({error:e instanceof Error?e.message:"PAYROLL_REPAIR_PREVIEW_FAILED"});}
});
router.post("/admin/sc-employees/payroll-tabs/restore-december",adminMiddleware,async(req,res)=>{
 if(process.env.SC_SALARY_TAB_CREATE_ENABLED!=="true"){
  res.status(503).json({error:"PAYROLL_TAB_CREATE_DISABLED"});return;
 }
 if(writing){res.status(409).json({error:"PAYROLL_TAB_CREATE_BUSY"});return;}
 writing=true;
 try{
  if(Object.keys(req.body??{}).length!==0)throw Error("PAYROLL_REPAIR_BODY_FORBIDDEN");
  const plan=await decemberRepairPlan();
  if(plan.missing.length){
   // Copy only empty cells in target. PASTE_NORMAL retains original cell
   // value/formula as well as number format; same grid coordinates.
   const requests=plan.missing.map(({r,c})=>({copyPaste:{
    source:{sheetId:plan.sourceId,startRowIndex:r,endRowIndex:r+1,startColumnIndex:c,endColumnIndex:c+1},
    destination:{sheetId:plan.destId,startRowIndex:r,endRowIndex:r+1,startColumnIndex:c,endColumnIndex:c+1},
    pasteType:"PASTE_NORMAL" as const,pasteOrientation:"NORMAL" as const
   }}));
   await plan.sheets.spreadsheets.batchUpdate({spreadsheetId:plan.spreadsheetId,requestBody:{requests}});
  }
  const read=await plan.sheets.spreadsheets.values.get({spreadsheetId:plan.spreadsheetId,
   range:"'Gaji Desember 2026'!A1:M"+plan.sourceRows.length,valueRenderOption:"FORMULA"});
  const after=read.data.values??[];
  if(plan.sourceRows.some((row,r)=>row.some((v,c)=>String(v??"").trim()!==String(after[r]?.[c]??"").trim())))
   throw Error("PAYROLL_REPAIR_READBACK_MISMATCH");
  await logAudit({...getUserFromReq(req),action:"SC_PAYROLL_DECEMBER_VALUES_RESTORED",
   entity:"sc_employee_payroll_tab",after:{month:"2026-12",sourceGid:NOVEMBER_GID,
    targetGid:plan.destId,restoredCells:plan.missing.length},...getClientInfo(req)});
  res.json({restored:true,restoredCells:plan.missing.length,targetTitle:"Gaji Desember 2026",
   url:`https://docs.google.com/spreadsheets/d/${plan.spreadsheetId}/edit?gid=${plan.destId}#gid=${plan.destId}`});
 }catch(e){res.status(422).json({error:e instanceof Error?e.message:"PAYROLL_REPAIR_FAILED"});}
 finally{writing=false;}
});
export default router;
