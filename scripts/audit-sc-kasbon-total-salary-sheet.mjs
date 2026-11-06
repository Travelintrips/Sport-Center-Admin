import {createRequire} from "node:module";
const require=createRequire(new URL("../artifacts/api-server/package.json",import.meta.url));
const {google}=require("googleapis");
const DOC="1_Zq5gX7xW35YdI46zeLNguvc6TNb6qP7_vGhTqDAtXg";
const GID=1429288652;
const creds=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??"{}");
if(creds.client_email!=="sport-center@sport-center-506306.iam.gserviceaccount.com")
 throw Error("SERVICE_ACCOUNT_UNEXPECTED");
creds.private_key=creds.private_key?.replace(/\\n/g,"\n");
const auth=new google.auth.GoogleAuth({credentials:creds,scopes:["https://www.googleapis.com/auth/spreadsheets.readonly","https://www.googleapis.com/auth/drive.metadata.readonly"]});
const api=google.sheets({version:"v4",auth});
const meta=await api.spreadsheets.get({spreadsheetId:DOC,fields:"sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),merges,protectedRanges)"});
const target=meta.data.sheets?.find(x=>x.properties?.sheetId===GID);
if(!target)throw Error("TARGET_GID_NOT_FOUND");
const title=target.properties.title;
const quote="'"+title.replace(/'/g,"''")+"'";
const rows=await api.spreadsheets.values.batchGet({spreadsheetId:DOC,ranges:[quote+"!A1:H100"],valueRenderOption:"FORMATTED_VALUE"});
const cells=rows.data.valueRanges?.[0]?.values??[];
const keyRows=[];
for(let i=0;i<cells.length;i++){
 const r=cells[i]??[];
 const name=String(r[1]??"").trim();
 if(name && /(?:ROBBY|SENO|TRI|UCOK|RIAN|SANDI|MUSTO|SONIK|DEDE|FEBRI|ANDI|NAMA|TOTAL)/i.test(name))
  keyRows.push({row:i+1,name,existingG:String(r[6]??"").trim()});
}
let canEdit=null;
try{
 const drive=google.drive({version:"v3",auth});
 const file=await drive.files.get({fileId:DOC,fields:"capabilities(canEdit)"});
 canEdit=file.data.capabilities?.canEdit??null;
}catch(e){canEdit="unknown";}
console.log(JSON.stringify({audit:"READ_ONLY",target:{spreadsheetId:DOC,gid:GID,title,rows:target.properties.gridProperties.rowCount,canEdit},matched:keyRows,merges:target.merges?.length??0,protectedRanges:target.protectedRanges?.length??0}));
