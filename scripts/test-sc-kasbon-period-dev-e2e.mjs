/** DEV-only end-to-end month creation on a disposable duplicated worksheet.
 * The user-created DEV Kasbon POOL tab and the PROD workbook remain read-only.
 */
import {createRequire} from "node:module";
import {planNewPeriod,buildPeriodCells,parsePeriod} from "../artifacts/api-server/src/lib/scKasbonPeriodPlan.ts";
const require=createRequire(new URL("../artifacts/api-server/package.json",import.meta.url));
const {google}=require("googleapis");
const DEV="14O49d-DmcbMS9C70O_aFOTLzgp9BkHuYRzGrrT0JHxA";
const PROD="17KtD8OSmyYo-d6jsOa6t7DMH76gjcJvdxdNSHPS_FP8";
if(process.env.KASBON_PERIOD_DEV_E2E_APPROVED!=="true"||
 process.env.NODE_ENV!=="development"||process.env.APP_ENV!=="development"||
 process.env.KASBON_PERIOD_DEV_SHEET_ID!==DEV||DEV===PROD)
 throw Error("DEV_ONLY_SAFETY_CHECK_FAILED");
const credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??"{}");
if(credentials.client_email!=="sport-center@sport-center-506306.iam.gserviceaccount.com")
 throw Error("SERVICE_ACCOUNT_MISMATCH");
credentials.private_key=credentials.private_key?.replace(/\\n/g,"\n");
if(!credentials.private_key)throw Error("SERVICE_ACCOUNT_KEY_MISSING");
const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
const api=google.sheets({version:"v4",auth});
const original=await api.spreadsheets.get({spreadsheetId:DEV,
 fields:"sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))"});
const source=(original.data.sheets??[]).filter(x=>x.properties?.title==="Kasbon POOL"&&x.properties?.sheetId===1953055393);
if(source.length!==1)throw Error("DEV_SOURCE_TAB_NOT_VERIFIED");
const originalRange="'Kasbon POOL'!A1041:AI1058";
const originalBefore=await api.spreadsheets.values.get({spreadsheetId:DEV,range:originalRange,valueRenderOption:"FORMULA"});
const originalJson=JSON.stringify(originalBefore.data.values??[]);
const scratch="_KASBON_PERIOD_E2E_"+String(process.env.GITHUB_RUN_ID||"manual").slice(-11);
const q="'"+scratch+"'";
let scratchId;
const fetchRows=async(rowCount)=>{
 const [f,u]=await Promise.all([
  api.spreadsheets.values.get({spreadsheetId:DEV,range:q+"!A1:AK"+rowCount,valueRenderOption:"FORMATTED_VALUE"}),
  api.spreadsheets.values.get({spreadsheetId:DEV,range:q+"!A1:AK"+rowCount,valueRenderOption:"UNFORMATTED_VALUE"})
 ]);
 return {f:f.data.values??[],u:u.data.values??[]};
};
const cell=async(range,format="FORMULA")=>{
 const r=await api.spreadsheets.values.get({spreadsheetId:DEV,range:q+"!"+range,valueRenderOption:format});
 return r.data.values?.[0]?.[0]??"";
};
const create=async(period,carryMode)=>{
 const meta=await api.spreadsheets.get({spreadsheetId:DEV,
  fields:"sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))"});
 const sheet=(meta.data.sheets??[]).find(s=>s.properties?.sheetId===scratchId);
 if(!sheet)throw Error("SCRATCH_MISSING");
 const rowCount=sheet.properties?.gridProperties?.rowCount??0;
 const {f,u}=await fetchRows(rowCount);
 const plan=planNewPeriod(f,u,period,carryMode);
 const top=plan.destinationStart-1,bottom=plan.destinationEnd;
 const requests=[];
 if(bottom>rowCount)requests.push({appendDimension:{sheetId:scratchId,dimension:"ROWS",length:bottom-rowCount+2}});
 requests.push({copyPaste:{
  source:{sheetId:scratchId,startRowIndex:plan.sourceStart-1,endRowIndex:plan.sourceEnd,startColumnIndex:0,endColumnIndex:35},
  destination:{sheetId:scratchId,startRowIndex:top,endRowIndex:bottom,startColumnIndex:0,endColumnIndex:35},
  pasteType:"PASTE_FORMAT",pasteOrientation:"NORMAL"
 }});
 requests.push({updateCells:{
  start:{sheetId:scratchId,rowIndex:top,columnIndex:0},
  rows:buildPeriodCells(plan).map(r=>({values:r})),fields:"userEnteredValue"
 }});
 requests.push({repeatCell:{
  range:{sheetId:scratchId,startRowIndex:top+1,endRowIndex:top+2,startColumnIndex:4,endColumnIndex:35},
  cell:{userEnteredFormat:{numberFormat:{type:"DATE",pattern:"m-d-yyyy"}}},
  fields:"userEnteredFormat.numberFormat"
 }});
 await api.spreadsheets.batchUpdate({spreadsheetId:DEV,requestBody:{requests}});
 const header=await cell("A"+plan.destinationStart);
 if(header!==parsePeriod(period).monthLabel)throw Error("MONTH_HEADER_READBACK_FAILED");
 if(await cell("B"+plan.destinationEnd)!=="Total")throw Error("TOTAL_ROW_READBACK_FAILED");
 if(await cell("C"+(plan.destinationStart+2))!==
  `=SUM(D${plan.destinationStart+2}:AI${plan.destinationStart+2})`)
  throw Error("EMPLOYEE_FORMULA_READBACK_FAILED");
 if(await cell("C"+plan.destinationEnd)!==
  `=SUM(C${plan.destinationStart+2}:C${plan.destinationEnd-1})`)
  throw Error("MONTH_TOTAL_FORMULA_READBACK_FAILED");
 const lastDay=Number(await cell("AI"+(plan.destinationStart+1),"UNFORMATTED_VALUE"));
 const days=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).getUTCDate();
 if(days===31&&!Number.isFinite(lastDay))throw Error("LAST_DAY_DATE_MISSING");
 return plan;
};
try{
 const dup=await api.spreadsheets.batchUpdate({spreadsheetId:DEV,requestBody:{requests:[
  {duplicateSheet:{sourceSheetId:1953055393,insertSheetIndex:(original.data.sheets??[]).length,newSheetName:scratch}}
 ]}});
 scratchId=dup.data.replies?.[0]?.duplicateSheet?.properties?.sheetId;
 if(!Number.isInteger(scratchId))throw Error("DEV_SCRATCH_DUPLICATE_FAILED");
 const mode="febri_andi_only";
 const validateCarryover=async(plan)=>{
  let carried=0,zeroed=0;
  for(let i=0;i<plan.employeeCount;i++){
   const row=plan.destinationStart+2+i;
   const prev=plan.sourceStart+2+i;
   const label=String(await cell("B"+row,"FORMATTED_VALUE")).trim().toLowerCase();
   const carry=["kasbon febri","kasbon andi"].includes(label);
   const opening=await cell("D"+row);
   if(carry){
    if(opening!==`=C${prev}`)throw Error("CARRYOVER_FORMULA_INCORRECT_"+label);
    carried++;
   }else{
    if(Number(await cell("D"+row,"UNFORMATTED_VALUE"))!==0)
     throw Error("OTHER_EMPLOYEE_OPENING_NOT_ZERO_"+label);
    zeroed++;
   }
   if((await cell("E"+row,"FORMULA"))!=="")
    throw Error("DATE_TRANSACTION_NOT_EMPTY_"+label);
   if((await cell("AI"+row,"FORMULA"))!=="")
    throw Error("LAST_DATE_TRANSACTION_NOT_EMPTY_"+label);
   if((await cell("C"+row))!==`=SUM(D${row}:AI${row})`)
    throw Error("EMPLOYEE_TOTAL_FORMULA_MISSING_"+label);
  }
  if(carried!==2 || zeroed!==plan.employeeCount-2)throw Error("UNEXPECTED_CARRYOVER_EMPLOYEE_COUNT");
  return {carried,zeroed};
 };
 const dec=await create("2026-12",mode);
 const december=await validateCarryover(dec);
 const jan=await create("2027-01",mode);
 const january=await validateCarryover(jan);
 const sheet=await api.spreadsheets.get({spreadsheetId:DEV,fields:"sheets(properties(sheetId,gridProperties(rowCount)))"});
 const rowCount=sheet.data.sheets?.find(s=>s.properties?.sheetId===scratchId)?.properties?.gridProperties?.rowCount??0;
 const {f,u}=await fetchRows(rowCount);
 let duplicateRejected=false;
 try{planNewPeriod(f,u,"2026-12",mode);}catch(e){duplicateRejected=String(e.message)==="PERIOD_ALREADY_EXISTS";}
 if(!duplicateRejected)throw Error("DUPLICATE_PERIOD_WAS_NOT_REJECTED");
 console.log(JSON.stringify({result:"PASS",workbook:"DEV_ONLY",decemberRows:[dec.destinationStart,dec.destinationEnd],
  januaryRows:[jan.destinationStart,jan.destinationEnd],decemberCarry:december,januaryCarry:january,otherEmployeesStartZero:true,datesEmpty:true,
  formulaReadback:true,duplicateRejected:true,sourceOriginalUntouched:true}));
}finally{
 if(Number.isInteger(scratchId)){
  await api.spreadsheets.batchUpdate({spreadsheetId:DEV,requestBody:{requests:[{deleteSheet:{sheetId:scratchId}}]}});
  console.log("TEMPORARY_PERIOD_TEST_TAB_DELETED");
 }
 const originalAfter=await api.spreadsheets.values.get({spreadsheetId:DEV,range:originalRange,valueRenderOption:"FORMULA"});
 if(JSON.stringify(originalAfter.data.values??[])!==originalJson)throw Error("CRITICAL_ORIGINAL_DEV_TAB_CHANGED");
 console.log("ORIGINAL_DEV_KASBON_POOL_UNCHANGED");
}
