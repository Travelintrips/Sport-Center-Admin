import {Router} from "express";
import {google} from "googleapis";
import {adminMiddleware} from "../lib/auth";
import {parsePeriod,planNewPeriod,buildPeriodCells,type CarryMode} from "../lib/scKasbonPeriodPlan";

const router=Router();
let creating=false;
const knownProd="17KtD8OSmyYo-d6jsOa6t7DMH76gjcJvdxdNSHPS_FP8";
type RequestBody={period?:unknown;carryMode?:unknown};
const parseBody=(body:RequestBody):{period:string;carryMode:CarryMode}=>{
 const period=typeof body?.period==="string"?body.period:"";
 parsePeriod(period);
 if(body?.carryMode!=="febri_andi_only")throw Error("CARRY_MODE_REQUIRED");
 return {period,carryMode:body.carryMode};
};
async function context(){
 const prod=process.env.APP_ENV==="production"&&process.env.NODE_ENV==="production";
 const dev=process.env.APP_ENV==="development"&&process.env.NODE_ENV==="development";
 if(!prod&&!dev)throw Error("ENVIRONMENT_UNVERIFIED");
 const spreadsheetId=prod?process.env.SC_KASBON_POOL_SPREADSHEET_ID?.trim()
  :process.env.SC_KASBON_PERIOD_DEV_SPREADSHEET_ID?.trim();
 if(!spreadsheetId||(prod && spreadsheetId!==knownProd)||(!prod && spreadsheetId===knownProd))
  throw Error("SHEET_ENVIRONMENT_MISMATCH");
 const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!raw)throw Error("GOOGLE_SERVICE_ACCOUNT_MISSING");
 const credentials=JSON.parse(raw);
 if(typeof credentials.private_key==="string")
  credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
 const auth=new google.auth.GoogleAuth({credentials,scopes:[prod?"https://www.googleapis.com/auth/spreadsheets.readonly":"https://www.googleapis.com/auth/spreadsheets"]});
 const sheets=google.sheets({version:"v4",auth});
 const meta=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),merges,protectedRanges)"});
 const target=(meta.data.sheets??[]).filter(s=>s.properties?.title==="Kasbon POOL");
 if(target.length!==1)throw Error("TARGET_TAB_NOT_FOUND");
 const t=target[0];
 const sheetId=t.properties?.sheetId,rowCount=t.properties?.gridProperties?.rowCount??0;
 if(!Number.isInteger(sheetId)||rowCount<20||rowCount>20000)throw Error("SHEET_LAYOUT_UNSAFE");
 return {sheets,spreadsheetId,sheetId:sheetId!,rowCount,
  merges:t.merges??[],protectedRanges:t.protectedRanges??[]};
}
async function preview(body:RequestBody){
 const args=parseBody(body);
 const ctx=await context();
 const range="'Kasbon POOL'!A1:AK"+ctx.rowCount;
 const [f,u]=await Promise.all([
  ctx.sheets.spreadsheets.values.get({spreadsheetId:ctx.spreadsheetId,range,valueRenderOption:"FORMATTED_VALUE"}),
  ctx.sheets.spreadsheets.values.get({spreadsheetId:ctx.spreadsheetId,range,valueRenderOption:"UNFORMATTED_VALUE"})
 ]);
 const plan=planNewPeriod(f.data.values??[],u.data.values??[],args.period,args.carryMode);
 const from=plan.sourceStart-1,to=plan.sourceEnd;
 const intersections=(ranges:Array<{startRowIndex?:number|null;endRowIndex?:number|null}>)=>
  ranges.some(r=>(r.startRowIndex??0)<to && (r.endRowIndex??Number.MAX_SAFE_INTEGER)>from);
 if(intersections(ctx.merges)||intersections(ctx.protectedRanges.map(r=>r.range??{})))
  throw Error("TEMPLATE_HAS_MERGED_OR_PROTECTED_ROWS");
 if(plan.destinationEnd>20000)throw Error("DESTINATION_LIMIT_EXCEEDED");
 return {plan,ctx};
}
router.post("/admin/sc-kasbon-periods/preview",adminMiddleware,async(req,res)=>{
 try{
  const {plan}=await preview(req.body??{});
  res.json({...plan,mode:process.env.APP_ENV==="production"?"PROD_READ_ONLY":"DEV_PREVIEW",
   writeEnabled:process.env.APP_ENV==="development"&&process.env.NODE_ENV==="development"&&
    process.env.SC_KASBON_PERIOD_CREATION_ENABLED==="true"});
 }catch(error){res.status(422).json({error:error instanceof Error?error.message:"PREVIEW_FAILED"});}
});
router.post("/admin/sc-kasbon-periods/create",adminMiddleware,async(req,res)=>{
 if(process.env.SC_KASBON_PERIOD_CREATION_ENABLED!=="true" ||
   process.env.APP_ENV!=="development" || process.env.NODE_ENV!=="development"){
  res.status(403).json({error:"PERIOD_CREATION_DEV_ONLY_DISABLED"});return;
 }
 if(creating){res.status(409).json({error:"CREATION_ALREADY_RUNNING"});return;}
 creating=true;
 try{
  const {plan,ctx}=await preview(req.body??{});
  const top=plan.destinationStart-1,bottom=plan.destinationEnd;
  const rows=buildPeriodCells(plan);
  const requests:any[]=[];
  if(bottom>ctx.rowCount)requests.push({appendDimension:{
   sheetId:ctx.sheetId,dimension:"ROWS",length:bottom-ctx.rowCount+2
  }});
  requests.push({copyPaste:{
    source:{sheetId:ctx.sheetId,startRowIndex:plan.sourceStart-1,endRowIndex:plan.sourceEnd,startColumnIndex:0,endColumnIndex:35},
    destination:{sheetId:ctx.sheetId,startRowIndex:top,endRowIndex:bottom,startColumnIndex:0,endColumnIndex:35},
    pasteType:"PASTE_FORMAT",pasteOrientation:"NORMAL"
  }});
  requests.push({updateCells:{
   start:{sheetId:ctx.sheetId,rowIndex:top,columnIndex:0},
   rows:rows.map(r=>({values:r})),
   fields:"userEnteredValue"
  }});
  // Ensure the 31st is formatted as a date even when the source template
  // is November (which has only 30 dates in its header).
  requests.push({repeatCell:{
   range:{sheetId:ctx.sheetId,startRowIndex:top+1,endRowIndex:top+2,
     startColumnIndex:4,endColumnIndex:35},
   cell:{userEnteredFormat:{numberFormat:{type:"DATE",pattern:"m-d-yyyy"}}},
   fields:"userEnteredFormat.numberFormat"
  }});
  await ctx.sheets.spreadsheets.batchUpdate({spreadsheetId:ctx.spreadsheetId,requestBody:{requests}});
  const check=await ctx.sheets.spreadsheets.values.get({
   spreadsheetId:ctx.spreadsheetId,range:`'Kasbon POOL'!A${plan.destinationStart}:AI${plan.destinationEnd}`,
   valueRenderOption:"FORMULA"
  });
  const v=check.data.values??[];
  if(String(v[0]?.[0]??"").trim()!==parsePeriod(plan.period).monthLabel ||
   String(v[1]?.[1]??"").trim()!=="Keterangan" ||
   String(v[plan.employeeCount+2]?.[1]??"").trim()!=="Total")
   throw Error("PERIOD_READBACK_MISMATCH");
  res.json({created:true,period:plan.period,range:`A${plan.destinationStart}:AI${plan.destinationEnd}`,mode:"DEV_ONLY",readback:true});
 }catch(error){
  res.status(422).json({error:error instanceof Error?error.message:"CREATE_FAILED"});
 }finally{creating=false;}
});
export default router;
