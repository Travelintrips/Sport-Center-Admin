/**
 * One-shot authorized DEV clone of the existing Kasbon workbook.
 * Drive files.copy preserves formula, formatting, tabs and history source values.
 * This NEVER modifies or deletes the production original.
 */
import {createRequire} from "node:module";
const require=createRequire(new URL("../artifacts/api-server/package.json",import.meta.url));
const {google}=require("googleapis");
const SOURCE_ID="17KtD8OSmyYo-d6jsOa6t7DMH76gjcJvdxdNSHPS_FP8";
const gid=1953055393;
if(process.env.KASBON_COPY_DEV_APPROVED!=="true" ||
   process.env.APP_ENV!=="development" || process.env.NODE_ENV!=="development")
 throw Error("DEV_COPY_APPROVAL_REQUIRED");
const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if(!raw)throw Error("GOOGLE_SERVICE_ACCOUNT_JSON_REQUIRED");
const credentials=JSON.parse(raw);
if(credentials.client_email!=="sport-center@sport-center-506306.iam.gserviceaccount.com")
 throw Error("SERVICE_ACCOUNT_MISMATCH");
credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
const auth=new google.auth.GoogleAuth({credentials,scopes:[
 "https://www.googleapis.com/auth/drive",
 "https://www.googleapis.com/auth/spreadsheets.readonly"
]});
const sheets=google.sheets({version:"v4",auth});
const drive=google.drive({version:"v3",auth});
const before=await sheets.spreadsheets.get({
 spreadsheetId:SOURCE_ID, fields:"spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties))"
});
if(before.data.spreadsheetId!==SOURCE_ID ||
 !(before.data.sheets??[]).some(s=>s.properties?.sheetId===gid && s.properties?.title==="Kasbon POOL"))
 throw Error("SOURCE_UNVERIFIED");
const name="DEV ONLY - KASBON POOL COPY - "+(process.env.GITHUB_RUN_ID||new Date().toISOString()).replace(/[^a-z0-9-]/gi,"_");
const clone=await drive.files.copy({fileId:SOURCE_ID,requestBody:{
 name,description:"DEV only, private test copy. DO NOT USE FOR PAYROLL or production."
},fields:"id,name,mimeType,webViewLink",supportsAllDrives:true});
const cloneId=clone.data.id;
if(!cloneId || cloneId===SOURCE_ID)throw Error("CLONE_INVALID");
const after=await sheets.spreadsheets.get({
 spreadsheetId:cloneId,fields:"spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties))"
});
const originalNames=(before.data.sheets??[]).map(s=>s.properties?.title);
const copyNames=(after.data.sheets??[]).map(s=>s.properties?.title);
if(originalNames.length!==copyNames.length || originalNames.some((name,i)=>name!==copyNames[i]))
 throw Error("CLONE_TABS_NOT_EQUAL");
const orig=await sheets.spreadsheets.values.get({
 spreadsheetId:SOURCE_ID,range:"'Kasbon POOL'!A1041:K1058",valueRenderOption:"FORMULA"});
const copied=await sheets.spreadsheets.values.get({
 spreadsheetId:cloneId,range:"'Kasbon POOL'!A1041:K1058",valueRenderOption:"FORMULA"});
if(JSON.stringify(orig.data.values)!==JSON.stringify(copied.data.values))
 throw Error("CLONE_VALUES_OR_FORMULAS_MISMATCH");
console.log(JSON.stringify({
 status:"PASS",devCloneId:cloneId,devCloneUrl:clone.data.webViewLink||
 "https://docs.google.com/spreadsheets/d/"+cloneId+"/edit",
 tabs:copyNames.length,formulaAndValueComparison:"PASS",
 sourcePreserved:true,devOnly:true
}));
