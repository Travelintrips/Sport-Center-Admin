/** Strict read-only permission probe for Kasbon POOL; no writes, no key logs. */
import {createRequire} from "node:module";
const target="17KtD8OSmyYo-d6jsOa6t7DMH76gjcJvdxdNSHPS_FP8";
const tabGid=1953055393;
if(process.env.APP_ENV!=="development"||process.env.NODE_ENV!=="development")
 throw Error("DEV_PROBE_CONTEXT_REQUIRED");
const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if(!raw)throw Error("SERVICE_ACCOUNT_MISSING");
const credentials=JSON.parse(raw);
if(credentials.client_email!=="sport-center@sport-center-506306.iam.gserviceaccount.com")
 throw Error("UNEXPECTED_SERVICE_ACCOUNT");
credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
const require=createRequire(new URL("../artifacts/api-server/package.json",import.meta.url));
const {google}=require("googleapis");
const auth=new google.auth.GoogleAuth({credentials,
 scopes:["https://www.googleapis.com/auth/spreadsheets.readonly","https://www.googleapis.com/auth/drive.metadata.readonly"]});
const sheets=google.sheets({version:"v4",auth});
const found=await sheets.spreadsheets.get({spreadsheetId:target,
 fields:"spreadsheetId,sheets(properties(sheetId,title))"});
if(found.data.spreadsheetId!==target)throw Error("WORKBOOK_MISMATCH");
const correct=(found.data.sheets??[]).filter(x=>x.properties?.sheetId===tabGid&&x.properties?.title==="Kasbon POOL");
if(correct.length!==1)throw Error("TAB_NOT_FOUND");
let canEdit=null,driveProbe="unavailable";
try{
 const drive=google.drive({version:"v3",auth});
 const file=await drive.files.get({fileId:target,fields:"id,capabilities(canEdit)",supportsAllDrives:true});
 canEdit=file.data.capabilities?.canEdit??null;
 driveProbe="ok";
}catch(error){
 const status=error?.response?.status;
 driveProbe=typeof status==="number"?"http_"+status:"permission_unknown";
}
console.log(JSON.stringify({
 audit:"READ_ONLY",
 serviceAccount:credentials.client_email,
 workbookAccessible:true,tabVerified:true,
 canEdit,driveProbe,readyForWrite:canEdit===true
}));
