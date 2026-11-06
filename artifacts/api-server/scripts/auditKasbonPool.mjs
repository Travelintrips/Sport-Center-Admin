/**
 * Read-only inspection of an existing monthly Kasbon POOL Google worksheet.
 * NO sheets.spreadsheets.values.update / append / clear / batchUpdate calls.
 */
import {google} from "googleapis";

const WORKBOOK_ID=process.env.SC_KASBON_POOL_SPREADSHEET_ID?.trim() || "";
const TAB_ID=Number(process.env.SC_KASBON_POOL_SHEET_GID || 0);
const TAB_NAME="Kasbon POOL";
const q=(name)=>"'"+name.replace(/'/g,"''")+"'";

export function summarizeKasbonPool(formulaRows, valueRows, properties={}) {
 const formula=(row,col)=>String(formulaRows?.[row-1]?.[col-1]??"").trim();
 const value=(row,col)=>valueRows?.[row-1]?.[col-1]??"";
 const last=Math.max(formulaRows.length,valueRows.length);
 const months=[];
 for(let row=1;row<=last-1;row++){
   const label=formula(row,1).toLowerCase();
   if(!/^(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)$/.test(label))continue;
   const header=row+1;
   const headings=[];
   for(let col=5;col<=45;col++) {
    const h=formula(header,col);
    if(h) headings.push({column:col,text:h});
   }
   const parsedYear=headings.map(h=>h.text.match(/(?:^|[-\/ ])(20\d{2})$/)).find(Boolean);
   const end=Array.from({length:Math.min(250,last-header)},(_,i)=>header+i+1).find(r=> /^(total|jumlah)$/i.test(formula(r,1)) || /^(total|jumlah)$/i.test(formula(r,2)));
   const totalRow=end??null;
   const cells=totalRow===null?[]:Array.from({length:totalRow-header-1},(_,i)=>header+i+1);
   const formulaCells=[],occupiedDaily=[];
   for(const r of [...cells,...(totalRow===null?[]:[totalRow])]){
    for(let col=3;col<=45;col++){
     const f=formula(r,col);
     if(f.startsWith("="))formulaCells.push({row:r,column:col});
     if(cells.includes(r)&&col>=5&&value(r,col)!=="" && value(r,col)!==null)occupiedDaily.push({row:r,column:col});
    }
   }
   months.push({
    month:label, year:parsedYear?.[1]??null, monthHeadingRow:row, headerRow:header,
    firstDataRow:header+1,totalRow,headings,formulaCells,
    occupiedDailyCells:occupiedDaily.length,employeeRows:cells.map(r=>({
      row:r,description:formula(r,2),daysWithValues:occupiedDaily.filter(x=>x.row===r).length,
      hasFormulaTotal:formula(r,3).startsWith("="),
      hasPriorBalance:value(r,4)!=="" && Number(value(r,4))!==0
    }))
   });
 }
 const november=months.filter(m=>m.month==="november"&&m.year==="2026");
 const warnings=[];
 if(!november.length)warnings.push("NOVEMBER_2026_NOT_FOUND");
 if(november.length!==1)warnings.push("MONTH_SECTION_NOT_UNIQUE");
 for(const month of november){
  if(month.totalRow===null)warnings.push("TOTAL_ROW_NOT_FOUND");
  if(month.formulaCells.length)warnings.push("FORMULA_PROTECTED_CELLS_PRESENT");
  if(month.occupiedDailyCells)warnings.push("EXISTING_DAILY_ENTRIES_PRESENT");
  if(month.employeeRows.some(r=>!r.description))warnings.push("ROW_WITHOUT_NAME");
 }
 return {
   spreadsheetId:WORKBOOK_ID,tabId:TAB_ID,tabName:TAB_NAME,
   sheetMetadata:properties,sectionCount:months.length,
   november2026:november,
   warnings,
   writePermission:"DISABLED_READ_ONLY_AUDIT"
 };
}

export async function auditGoogleSheet() {
 if(!/^[A-Za-z0-9_-]{20,100}$/.test(WORKBOOK_ID)||!Number.isSafeInteger(TAB_ID)||TAB_ID<1)throw Error("TARGET_NOT_CONFIGURED: SC_KASBON_POOL_SPREADSHEET_ID and SC_KASBON_POOL_SHEET_GID are required");
 const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
 if(!raw)throw Error("SERVICE_ACCOUNT_MISSING: audit requires existing server-side Google Sheets service account; no browser-token extraction");
 let creds;
 try {creds=JSON.parse(raw);}catch{throw Error("SERVICE_ACCOUNT_INVALID");}
 if(typeof creds.private_key==="string")creds.private_key=creds.private_key.replace(/\\n/g,"\n");
 const auth=new google.auth.GoogleAuth({credentials:creds,scopes:["https://www.googleapis.com/auth/spreadsheets.readonly"]});
 const client=google.sheets({version:"v4",auth});
 const meta=await client.spreadsheets.get({spreadsheetId:WORKBOOK_ID,fields:"properties(title),sheets(properties(sheetId,title,gridProperties),protectedRanges(range,description),merges)"});
 const target=(meta.data.sheets??[]).find(x=>x.properties?.sheetId===TAB_ID);
 if(!target||target.properties?.title!==TAB_NAME)throw Error("TARGET_SHEET_MISMATCH: refusing audit based on stale gid/title");
 const range=q(TAB_NAME)+"!A1:AS1300";
 const [f,v]=await Promise.all([
  client.spreadsheets.values.get({spreadsheetId:WORKBOOK_ID,range,valueRenderOption:"FORMULA"}),
  client.spreadsheets.values.get({spreadsheetId:WORKBOOK_ID,range,valueRenderOption:"UNFORMATTED_VALUE"})
 ]);
 const report=summarizeKasbonPool(f.data.values??[],v.data.values??[],{
  title:meta.data.properties?.title,
  protectedRanges:target.protectedRanges?.length??0,
  mergedRanges:target.merges?.length??0
 });
 // Output non-sensitive diagnostics; never print names, bank data or credentials.
 const sanitized={...report,november2026:report.november2026.map(m=>({
  month:m.month,year:m.year,monthHeadingRow:m.monthHeadingRow,headerRow:m.headerRow,
  firstDataRow:m.firstDataRow,totalRow:m.totalRow,
  headingCount:m.headings.length,formulaCellCount:m.formulaCells.length,
  occupiedDailyCells:m.occupiedDailyCells,employeeRowCount:m.employeeRows.length,
  duplicateDescriptions:m.employeeRows.length-new Set(m.employeeRows.map(x=>x.description.toLowerCase())).size,
  rowNumbers:m.employeeRows.map(x=>x.row)
 }))};
 process.stdout.write(JSON.stringify(sanitized,null,2)+"\n");
 return report;
}

if(process.argv[1] && import.meta.url===new URL("file://"+process.argv[1]).href){
 auditGoogleSheet().catch(e=>{console.error("AUDIT_BLOCKED",e?.message??String(e));process.exitCode=1;});
}
