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
 if(!Number.isSafeInteger(sourceId)||count<20||count>200||cols<13||cols>200)
  throw Error("PAYROLL_TEMPLATE_LAYOUT_UNSAFE");
 if(sourceId===NOVEMBER_GID && sourceTitle!=="Gaji November 2026")throw Error("PAYROLL_TEMPLATE_ID_MISMATCH");
 if(sourceTitle==="Gaji November 2026"&&sourceId!==NOVEMBER_GID)throw Error("PAYROLL_TEMPLATE_ID_MISMATCH");
 const values=await sheets.spreadsheets.values.get({
  spreadsheetId:PROD_SPREADSHEET,range:"'"+sourceTitle.replace(/'/g,"''")+"'!A1:M"+count,
  valueRenderOption:"FORMULA"
 });
 const rows=values.data.values??[];
 const plan=planPayrollDraft(period,rows);
 return {sheets,plan,sourceId:sourceId!,spreadsheetId:PROD_SPREADSHEET,rowCount:count,sourceRows:rows,
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
  const ranges=plan.clearCells.map(cell=>`'${escaped}'!${cell}`);
  await sheets.spreadsheets.values.batchClear({spreadsheetId,requestBody:{ranges}});
  const check=await sheets.spreadsheets.values.get({spreadsheetId,
   range:`'${escaped}'!A1:M${rowCount}`,valueRenderOption:"FORMULA"});
  const after=check.data.values??[];
  const still=plan.clearCells.filter(cell=>{
   const match=/^([A-Z]+)(\d+)$/.exec(cell)!;
   const column=match[1].split("").reduce((sum,c)=>sum*26+c.charCodeAt(0)-64,0)-1;
   return String(after[Number(match[2])-1]?.[column]??"").trim()!=="";
  });
  const identityChanged=sourceRows.some((row,i)=>{
   const number=String(row?.[0]??"").trim(),name=String(row?.[1]??"").trim();
   if(!/^[1-9]\d{0,2}$/.test(number)||!name)return false;
   return String(after[i]?.[0]??"").trim()!==number||
    String(after[i]?.[1]??"").trim()!==name;
  });
  if(still.length||identityChanged)throw Error("PAYROLL_DRAFT_READBACK_FAILED");
  const metadata=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(sheetId,title,hidden))"});
  const draft=metadata.data.sheets?.find(s=>s.properties?.sheetId===newId);
  if(draft?.properties?.title!==plan.targetTitle||draft.properties.hidden!==true)
   throw Error("PAYROLL_DRAFT_METADATA_FAILED");
  await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[
   {updateSheetProperties:{properties:{sheetId:newId,hidden:false},fields:"hidden"}}
  ]}});
  const audit={period,sourceTitle:plan.sourceTitle,targetTitle:plan.targetTitle,sheetId:newId,
   employeeCount:plan.employeeCount,clearedCells:plan.clearCells.length};
  await logAudit({...getUserFromReq(req),action:"SC_PAYROLL_MONTHLY_TAB_CREATED",
   entity:"sc_employee_payroll_tab",after:audit,...getClientInfo(req)});
  res.json({created:true,...audit,url:`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${newId}#gid=${newId}`});
 }catch(e){
  // If a copy was created but not fully verified, it remains hidden for manual recovery.
  res.status(422).json({error:e instanceof Error?e.message:"PAYROLL_TAB_CREATE_FAILED"});
 }finally{writing=false;}
});
export default router;
