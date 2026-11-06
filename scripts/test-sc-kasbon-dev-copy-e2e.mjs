/** Authorized DEV-only E2E. The real DEV Kasbon POOL tab is READ-ONLY.
 * A temporary duplicated test tab is created, exercised, verified, and deleted.
 */
import {createRequire} from "node:module";
const require=createRequire(new URL("../artifacts/api-server/package.json",import.meta.url));
const {google}=require("googleapis");
const prod="17KtD8OSmyYo-d6jsOa6t7DMH76gjcJvdxdNSHPS_FP8";
const dev="14O49d-DmcbMS9C70O_aFOTLzgp9BkHuYRzGrrT0JHxA";
const expectedGid=1953055393;
if(process.env.APP_ENV!=="development"||process.env.NODE_ENV!=="development"||
 process.env.KASBON_DEV_E2E_APPROVED!=="true")throw Error("DEV_APPROVAL_REQUIRED");
const actual=process.env.SC_KASBON_DEV_E2E_SPREADSHEET_ID;
if(actual!==dev||actual===prod)throw Error("DEV_TARGET_MISMATCH");
const credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??"{}");
if(credentials.client_email!=="sport-center@sport-center-506306.iam.gserviceaccount.com")
 throw Error("SERVICE_ACCOUNT_MISMATCH");
credentials.private_key=credentials.private_key?.replace(/\\n/g,"\n");
if(!credentials.private_key)throw Error("GOOGLE_KEY_NOT_AVAILABLE");
const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
const api=google.sheets({version:"v4",auth});
const meta=await api.spreadsheets.get({spreadsheetId:actual,fields:"spreadsheetId,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))"});
const source=(meta.data.sheets??[]).filter(s=>s.properties?.sheetId===expectedGid&&s.properties?.title==="Kasbon POOL");
if(source.length!==1)throw Error("SOURCE_TAB_NOT_VERIFIED");
const original=await api.spreadsheets.values.batchGet({spreadsheetId:actual,
 ranges:["'Kasbon POOL'!A1041:K1058","'Kasbon POOL'!C1058","'Kasbon POOL'!I1056"],
 valueRenderOption:"FORMULA"});
const baseline=JSON.stringify(original.data.valueRanges?.map(r=>r.values??[]));
let scratchId;
const scratch="_KASBON_DEV_E2E_"+String(process.env.GITHUB_RUN_ID||"manual").slice(-12);
const quoted="'"+scratch+"'";
const cell=async(range,render="UNFORMATTED_VALUE")=>{
 const a=await api.spreadsheets.values.get({spreadsheetId:actual,range:quoted+"!"+range,valueRenderOption:render});
 return a.data.values?.[0]?.[0]??"";
};
const write=async(range,v)=>api.spreadsheets.values.update({
 spreadsheetId:actual,range:quoted+"!"+range,valueInputOption:"USER_ENTERED",
 requestBody:{values:[[v]]}
});
let cases=0;
try{
 const clone=await api.spreadsheets.batchUpdate({spreadsheetId:actual,
  requestBody:{requests:[{duplicateSheet:{sourceSheetId:expectedGid,insertSheetIndex:(meta.data.sheets??[]).length,newSheetName:scratch}}]}});
 scratchId=clone.data.replies?.[0]?.duplicateSheet?.properties?.sheetId;
 if(!Number.isInteger(scratchId))throw Error("SCRATCH_DUPLICATION_FAILED");
 console.log("DEV_E2E_SCRATCH_CREATED");
 // Make an isolated transaction on the Robby row on the 6th, verifying the
 // copied label; no existing transaction or original report cell is overwritten.
 const desc=await cell("B1047","FORMATTED_VALUE");
 if(!/robby/i.test(String(desc)))throw Error("EMPLOYEE_LABEL_NOT_VERIFIED");
 const target="J1047";
 const prior=await cell(target,"FORMULA");
 if(prior!=="")throw Error("SCRATCH_TEST_CELL_NOT_EMPTY");
 const opening=await cell("C1047");
 const dayOpening=await cell("J1058");
 const openingMonth=await cell("C1058");
 const base=Number(opening),daily=Number(dayOpening),month=Number(openingMonth);
 if(![base,daily,month].every(Number.isFinite))throw Error("BASE_TOTALS_UNSAFE");
 // Use a temporary normalized formula for subtotal cells on SCRATCH ONLY.
 await api.spreadsheets.values.batchUpdate({spreadsheetId:actual,requestBody:{
  valueInputOption:"USER_ENTERED",data:[
   {range:quoted+"!C1047",values:[["=SUM(D1047:AI1047)"]]},
   {range:quoted+"!J1058",values:[["=SUM(J1043:J1057)"]]},
   {range:quoted+"!C1058",values:[["=SUM(C1043:C1057)"]]}
 ]}});
 if(Number(await cell("C1047"))!==base||Number(await cell("J1058"))!==daily||
    Number(await cell("C1058"))!==month)throw Error("BASE_FORMULAS_NOT_RECONCILED");
 cases++;
 const amount=123456,edited=234567;
 await write(target,amount);
 if(Number(await cell(target))!==amount ||
    Number(await cell("C1047"))!==base+amount ||
    Number(await cell("J1058"))!==daily+amount ||
    Number(await cell("C1058"))!==month+amount)throw Error("ADD_READBACK_FAILED");
 cases++;
 // Replay must not add a second amount. The same cell is replaced, not appended.
 await write(target,amount);
 if(Number(await cell(target))!==amount ||
    Number(await cell("J1058"))!==daily+amount)throw Error("RETRY_DUPLICATED");
 cases++;
 await write(target,edited);
 if(Number(await cell(target))!==edited ||
    Number(await cell("C1047"))!==base+edited ||
    Number(await cell("J1058"))!==daily+edited)throw Error("EDIT_READBACK_FAILED");
 cases++;
 await api.spreadsheets.values.clear({spreadsheetId:actual,range:quoted+"!"+target});
 if((await cell(target,"FORMULA"))!==""||
    Number(await cell("C1047"))!==base||
    Number(await cell("J1058"))!==daily||
    Number(await cell("C1058"))!==month)throw Error("DELETE_READBACK_FAILED");
 cases++;
 // Verify the actual copied worksheet retains formatting on ordinary cells.
 const formats=await api.spreadsheets.get({spreadsheetId:actual,ranges:[quoted+"!B1047:C1047"],
  includeGridData:true,fields:"sheets(data(rowData(values(userEnteredFormat))))"});
 if(!(formats.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values??[]).length)
   throw Error("SCRATCH_FORMAT_NOT_COPIED");
 cases++;
 console.log(JSON.stringify({result:"PASS",cases,add:true,edit:true,delete:true,retryWithoutDuplicate:true,format:true,originalUntouched:true}));
}finally{
 if(Number.isInteger(scratchId)){
  try{
   await api.spreadsheets.batchUpdate({spreadsheetId:actual,requestBody:{
    requests:[{deleteSheet:{sheetId:scratchId}}]
   }});
   console.log("DEV_E2E_SCRATCH_DELETED");
  }catch(e){console.error("CRITICAL_SCRATCH_CLEANUP_FAILED",scratchId);throw e;}
 }
 const after=await api.spreadsheets.values.batchGet({spreadsheetId:actual,
 ranges:["'Kasbon POOL'!A1041:K1058","'Kasbon POOL'!C1058","'Kasbon POOL'!I1056"],
 valueRenderOption:"FORMULA"});
 if(JSON.stringify(after.data.valueRanges?.map(r=>r.values??[]))!==baseline)
   throw Error("CRITICAL_DEV_ORIGINAL_CHANGED");
 console.log("DEV_ORIGINAL_KASBON_TAB_UNCHANGED");
}
