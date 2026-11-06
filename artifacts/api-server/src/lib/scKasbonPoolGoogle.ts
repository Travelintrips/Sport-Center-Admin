import { google } from "googleapis";
import { planPoolKasbon } from "./scKasbonPoolPlan";

const PROD_ID = "17KtD8OSmyYo-d6jsOa6t7DMH76gjcJvdxdNSHPS_FP8";
const PROD_GID = 1953055393;
const TAB = "Kasbon POOL";

const colName=(n:number)=>{let s="";while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;};
const cols=Array.from({length:35},(_,i)=>colName(i+1));
const asMoney=(v:unknown):number=>{
 const n=Number(v??0);
 if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(n*100))throw Error("INVALID_SHEET_AMOUNT");
 return n;
};
const asRows=(res:{data:{values?:unknown[][]|null}})=>res.data.values??[];
const quote = "'Kasbon POOL'";

export async function writeNewKasbonToPool(input:{
  id:number; employeeId:string; employeeName:string; kasbonDate:string; amount:string;
}):Promise<{cell:string;sheetId:string;amount:string}> {
 if(process.env.SC_KASBON_POOL_SYNC_ENABLED!=="true")throw Error("SYNC_DISABLED");
 const appProd=process.env.APP_ENV==="production", nodeProd=process.env.NODE_ENV==="production";
 if(appProd!==nodeProd)throw Error("ENVIRONMENT_MISMATCH");
 const spreadsheetId=process.env.SC_KASBON_POOL_SPREADSHEET_ID?.trim();
 const sheetGid=Number(process.env.SC_KASBON_POOL_SHEET_GID);
 if(!spreadsheetId||!Number.isSafeInteger(sheetGid))throw Error("TARGET_NOT_CONFIGURED");
 if(appProd ? (spreadsheetId!==PROD_ID||sheetGid!==PROD_GID) : (spreadsheetId===PROD_ID))
   throw Error("SPREADSHEET_ENVIRONMENT_MISMATCH");
 const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!raw)throw Error("GOOGLE_SERVICE_ACCOUNT_MISSING");
 const creds=JSON.parse(raw);
 if(typeof creds.private_key==="string")creds.private_key=creds.private_key.replace(/\\n/g,"\n");
 const auth=new google.auth.GoogleAuth({credentials:creds,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
 const sheets=google.sheets({version:"v4",auth});
 const meta=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(sheetId,title))"});
 if((meta.data.sheets??[]).filter(x=>x.properties?.sheetId===sheetGid&&x.properties?.title===TAB).length!==1)
   throw Error("TARGET_TAB_UNVERIFIED");
 let rowMap:Record<string,number>;
 try{rowMap=JSON.parse(process.env.SC_KASBON_POOL_EMPLOYEE_ROW_MAP_JSON||"{}");}
 catch{throw Error("INVALID_EMPLOYEE_MAP");}
 const row= rowMap[input.employeeId]??null;
 if(Object.values(rowMap).filter(v=>v===row).length!==1||row===null)throw Error("EMPLOYEE_MAP_AMBIGUOUS");
 const range=quote+"!A1041:AI1058";
 const [formatted,formulas,rawValues]=await Promise.all([
  sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:"FORMATTED_VALUE"}),
  sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:"FORMULA"}),
  sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:"UNFORMATTED_VALUE"})
 ]);
 const fm=asRows(formatted), ff=asRows(formulas), rv=asRows(rawValues);
 const at=(arr:unknown[][],r:number,c:number)=>String(arr[r-1041]?.[c-1]??"").trim();
 if(at(fm,1041,1).toLowerCase()!=="november" ||
    at(fm,1042,1).toLowerCase()!=="tanggal" ||
    at(fm,1042,2).toLowerCase()!=="keterangan")throw Error("NOVEMBER_LAYOUT_UNVERIFIED");
 const headings:Record<string,string>={};
 for(let c=5;c<=35;c++)headings[colName(c)]=at(fm,1042,c);
 const day=Number(input.kasbonDate.slice(-2));
 const targetCol=4+day;
 if(targetCol>35)throw Error("DATE_OUTSIDE_GRID");
 const sumRow=Array.from({length:32},(_,i)=>i+4)
   .reduce((sum,c)=>sum+asMoney(rv[(row??0)-1041]?.[c-1]),0);
 const sumDay=Array.from({length:15},(_,i)=>i+1043)
   .reduce((sum,r)=>sum+asMoney(rv[r-1041]?.[targetCol-1]),0);
 const rowTotal=at(rv,row??0,3), dayTotal=at(rv,1058,targetCol);
 // A manually entered subtotal, even when correct now, is not guaranteed to update
 // after writing. Require both formulas before any write.
 if(at(ff,row??0,3).startsWith("=") && Math.abs(Number(rowTotal)-sumRow)>0.001)throw Error("EMPLOYEE_TOTAL_INCONSISTENT");
 if(at(ff,1058,targetCol).startsWith("=") && Math.abs(Number(dayTotal)-sumDay)>0.001)throw Error("DAILY_TOTAL_INCONSISTENT");
 const result=planPoolKasbon({
  employeeId:input.employeeId,employeeName:input.employeeName,kasbonDate:input.kasbonDate,
  amount:input.amount,configuredRow:row,rowDescription:at(fm,row??0,2),
  headings,currentCell:at(ff,row??0,targetCol),
  employeeTotalFormula:at(ff,row??0,3),
  dailyTotalFormula:at(ff,1058,targetCol),
  totalRowLabel:at(fm,1058,2),
 });
 if(result.status!=="ready")throw Error(result.reason);
 // Re-read exactly the destination moments before the update. If anyone edited
 // it between the initial read and this step, fail without changing any cell.
 const before=await sheets.spreadsheets.values.get({spreadsheetId,range:quote+"!"+result.cell,valueRenderOption:"FORMULA"});
 if(String(before.data.values?.[0]?.[0]??"").trim()!=="")throw Error("TARGET_CHANGED_BEFORE_WRITE");
 await sheets.spreadsheets.values.update({
  spreadsheetId,range:quote+"!"+result.cell,valueInputOption:"RAW",
  requestBody:{values:[[Number(input.amount)]]}
 });
 const after=await sheets.spreadsheets.values.get({
  spreadsheetId,range:quote+"!"+result.cell,valueRenderOption:"UNFORMATTED_VALUE"
 });
 if(Math.abs(Number(after.data.values?.[0]?.[0])-Number(input.amount))>0.001)
  throw Error("WRITE_READBACK_MISMATCH");
 return {cell:result.cell,sheetId:spreadsheetId,amount:input.amount};
}
