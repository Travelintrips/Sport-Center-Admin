import {createRequire} from "node:module";
const require=createRequire(new URL("../artifacts/api-server/package.json",import.meta.url));
const {google}=require("googleapis");
const DOC="1_Zq5gX7xW35YdI46zeLNguvc6TNb6qP7_vGhTqDAtXg";
const GID=1429288652, TAB="Gaji November 2026";
const TARGETS=[
 {id:"SC003",name:"ROBBY",row:11,amount:1500000},
 {id:"SC004",name:"TRI WISUDO",row:19,amount:2000000},
 {id:"SC005",name:"SENO",row:5,amount:2000000},
 {id:"SC006",name:"MUSTOPA",row:21,amount:1500000},
 {id:"SC007",name:"SANDI",row:20,amount:0},
 {id:"SC008",name:"SONIK",row:30,amount:1000000},
 {id:"SC009",name:"RIAN",row:26,amount:2571000},
];
if(process.env.SC_KASBON_GAJI_NOV_2026_APPROVED!=="true")throw Error("EXPLICIT_ONE_SHOT_APPROVAL_REQUIRED");
const creds=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??"{}");
if(creds.client_email!=="sport-center@sport-center-506306.iam.gserviceaccount.com")throw Error("SERVICE_ACCOUNT_MISMATCH");
creds.private_key=creds.private_key?.replace(/\\n/g,"\n");
const auth=new google.auth.GoogleAuth({credentials:creds,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
const api=google.sheets({version:"v4",auth});
const meta=await api.spreadsheets.get({spreadsheetId:DOC,fields:"sheets(properties(sheetId,title),merges,protectedRanges)"});
const matched=(meta.data.sheets??[]).filter(s=>s.properties?.sheetId===GID&&s.properties?.title===TAB);
if(matched.length!==1)throw Error("WORKBOOK_GID_TAB_MISMATCH");
const sheet=matched[0];
if((sheet.protectedRanges??[]).some(p=>(p.range?.startColumnIndex??0)<=6&&(p.range?.endColumnIndex??100)>6))
 throw Error("COLUMN_G_PROTECTED");
const ranges=[...TARGETS.map(t=>"'"+TAB+"'!B"+t.row),...TARGETS.map(t=>"'"+TAB+"'!G"+t.row),
 ...[1,10,18,24,29].map(r=>"'"+TAB+"'!G"+r)];
async function batchGet(valueRenderOption){
 const r=await api.spreadsheets.values.batchGet({spreadsheetId:DOC,ranges,valueRenderOption});
 return (r.data.valueRanges??[]).map(x=>x.values?.[0]?.[0]??"");
}
const before=await batchGet("FORMULA");
const normalized=s=>String(s??"").trim().toUpperCase();
for(let i=0;i<TARGETS.length;i++){
 const target=TARGETS[i];
 if(normalized(before[i])!==target.name)throw Error("EMPLOYEE_ROW_LABEL_MISMATCH_"+target.id);
 const existing=String(before[TARGETS.length+i]??"").trim();
 if(existing.startsWith("="))throw Error("G_FORMULA_PROTECTED_"+target.id);
 if(existing!==""&&Number(existing)!==target.amount)
  throw Error("G_EXISTING_VALUE_REVIEW_REQUIRED_"+target.id);
}
for(let i=TARGETS.length*2;i<before.length;i++)
 if(normalized(before[i])!=="KASBON")throw Error("KASBON_HEADER_MISMATCH");
const updates=TARGETS.filter((t,i)=>String(before[TARGETS.length+i]).trim()==="");
if(updates.length){
 await api.spreadsheets.values.batchUpdate({spreadsheetId:DOC,
  requestBody:{valueInputOption:"RAW",data:updates.map(t=>({range:"'"+TAB+"'!G"+t.row,values:[[t.amount]]}))}});
}
const after=await batchGet("UNFORMATTED_VALUE");
for(let i=0;i<TARGETS.length;i++){
 if(normalized(after[i])!==TARGETS[i].name||
    Number(after[TARGETS.length+i])!==TARGETS[i].amount)
   throw Error("WRITE_READBACK_MISMATCH_"+TARGETS[i].id);
}
for(let i=TARGETS.length*2;i<after.length;i++)
 if(normalized(after[i])!=="KASBON")throw Error("HEADER_CHANGED");
console.log(JSON.stringify({result:"PASS",workbook:DOC,tab:TAB,gid:GID,
 written:updates.map(x=>({employeeId:x.id,cell:"G"+x.row,amount:x.amount})),
 verified:TARGETS.map(x=>({employeeId:x.id,cell:"G"+x.row,amount:x.amount})),
 repeatedSafe:true,untouchedColumns:"A-F,H onward"}));
