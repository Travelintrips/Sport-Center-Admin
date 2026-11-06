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
 const monthTotal=asMoney(rv[1058-1041]?.[2]);
 const monthSum=Array.from({length:14},(_,i)=>1043+i)
   .reduce((sum,r)=>sum+asMoney(rv[r-1041]?.[2]),0);
 if(Math.abs(monthTotal-monthSum)>0.001)throw Error("MONTH_TOTAL_INCONSISTENT");
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
  employeeTotalCurrent:rowTotal,employeeTotalCalculated:sumRow,
  dailyTotalCurrent:dayTotal,dailyTotalCalculated:sumDay,
  monthlyTotalFormula:at(ff,1058,3),
  totalRowLabel:at(fm,1058,2),
 });
 if(result.status!=="ready")throw Error(result.reason);
 // Re-read every intended destination immediately before changing any value.
 const targets=[result.cell,...result.subtotalRepairs.map(x=>x.cell)];
 const before=await sheets.spreadsheets.values.batchGet({
  spreadsheetId,ranges:targets.map(cell=>quote+"!"+cell),valueRenderOption:"FORMULA"
 });
 for(let i=0;i<targets.length;i++){
  const cell=targets[i];
  const match=cell.match(/^([A-Z]+)(\d+)$/);
  if(!match)throw Error("DESTINATION_INVALID");
  const ci=cols.indexOf(match[1])+1,rowNumber=Number(match[2]);
  if(ci<1)throw Error("DESTINATION_INVALID");
  const earlier=at(ff,rowNumber,ci);
  const actual=String(before.data.valueRanges?.[i]?.values?.[0]?.[0]??"").trim();
  if(actual!==earlier)throw Error("SHEET_CHANGED_DURING_PREFLIGHT");
 }
 // One batch changes ONLY the empty transaction cell and, when safe,
 // mathematically verified manual subtotal cells (converting to full SUM).
 await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,requestBody:{valueInputOption:"USER_ENTERED",data:[
   {range:quote+"!"+result.cell,values:[[Number(input.amount)]]},
   ...result.subtotalRepairs.map(x=>({range:quote+"!"+x.cell,values:[[x.formula]]}))
  ]}
 });
 const after=await sheets.spreadsheets.values.batchGet({
  spreadsheetId,ranges:[result.cell,"C"+result.row,result.col+"1058","C1058"].map(c=>quote+"!"+c),
  valueRenderOption:"UNFORMATTED_VALUE"
 });
 const observed=(i:number)=>Number(after.data.valueRanges?.[i]?.values?.[0]?.[0]);
 if(Math.abs(observed(0)-Number(input.amount))>0.001 ||
    Math.abs(observed(1)-(sumRow+Number(input.amount)))>0.001 ||
    Math.abs(observed(2)-(sumDay+Number(input.amount)))>0.001 ||
    Math.abs(observed(3)-(monthTotal+Number(input.amount)))>0.001)
  throw Error("SHEETS_READBACK_TOTALS_MISMATCH");
 return {cell:result.cell,sheetId:spreadsheetId,amount:input.amount};
}
