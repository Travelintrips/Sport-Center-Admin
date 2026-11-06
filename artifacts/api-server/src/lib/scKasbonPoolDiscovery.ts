/** Read-only discovery of monthly sections in the existing legacy Kasbon POOL worksheet.
 * All positions are derived from the date and the live sheet content, never ENV.
 */
export type Section = {
 headerRow:number; firstDataRow:number; totalRow:number; dayColumn:number;
 employeeRow:number; monthEndColumn:number;
};
const months=["januari","februari","maret","april","mei","juni","juli","agustus","september","oktober","november","desember"];
export const columnName=(n:number):string=>{
 let name="";while(n>0){n--;name=String.fromCharCode(65+n%26)+name;n=Math.floor(n/26);}
 return name;
};
export const sheetCell=(rows:unknown[][],row:number,col:number):string=>
 String(rows[row-1]?.[col-1]??"").trim();
const normalized=(s:string)=>s.toLocaleLowerCase("id-ID").trim().replace(/\s+/g," ")
 .replace(/^kasbon\s+/,"");
export const matchingDate=(header:unknown, date:string):boolean=>{
 if(typeof header==="number") {
  const d=new Date(Date.UTC(1899,11,30)+header*86400000);
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;
 }
 const text=String(header??"").trim();
 if(/^\d{5}(?:\.0+)?$/.test(text)) {
  const d=new Date(Date.UTC(1899,11,30)+Number(text)*86400000);
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;
 }
 const match=text.match(/^(\d{1,2})[-/]([0-9]{1,2})[-/](20\d{2})$/);
 if(!match)return false;
 const [month,day,year]=[Number(match[1]),Number(match[2]),Number(match[3])];
 return date===`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
};
export function discoverKasbonSection(
 formatted:unknown[][], unformatted:unknown[][],
 date:string, verifiedEmployeeLabel:string
): Section {
 if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) ||
  Number.isNaN(Date.parse(date+"T00:00:00Z")) ||
  new Date(date+"T00:00:00Z").toISOString().slice(0,10)!==date)
   throw Error("KASBON_DATE_INVALID");
 const month=months[Number(date.slice(5,7))-1];
 const candidates:Section[]=[];
 const maxRows=Math.max(formatted.length,unformatted.length);
 for(let h=2;h<=maxRows;h++){
  if(normalized(sheetCell(formatted,h,1))!=="tanggal"||
   normalized(sheetCell(formatted,h,2))!=="keterangan")continue;
  if(normalized(sheetCell(formatted,h-1,1))!==month)continue;
  const headF=formatted[h-1]??[],headU=unformatted[h-1]??[];
  const dateColumns:number[]=[];
  const monthCols:number[]=[];
  for(let col=5;col<=Math.max(headF.length,headU.length);col++){
    const val=headU[col-1]??headF[col-1];
    if(matchingDate(val,date)||matchingDate(headF[col-1],date))dateColumns.push(col);
    // Detect header cells belonging to this month, including dates from other days.
    for(let day=1;day<=31;day++){
      const candidate=date.slice(0,8)+String(day).padStart(2,"0");
      if(matchingDate(val,candidate)||matchingDate(headF[col-1],candidate)){
       monthCols.push(col);break;
      }
    }
  }
  if(dateColumns.length!==1)continue;
  const firstDataRow=h+1;
  const totalRows:number[]=[];
  for(let r=firstDataRow;r<=Math.min(maxRows,h+200);r++){
    if(normalized(sheetCell(formatted,r,2))==="total") {totalRows.push(r);break;}
    // A new month without a total row is not safe to use.
    if(r>firstDataRow && months.includes(normalized(sheetCell(formatted,r,1))))break;
  }
  if(totalRows.length!==1)throw Error("KASBON_TOTAL_ROW_NOT_FOUND");
  const totalRow=totalRows[0];
  const employeeRows:number[]=[];
  for(let r=firstDataRow;r<totalRow;r++){
    if(normalized(sheetCell(formatted,r,2))===normalized(verifiedEmployeeLabel))
      employeeRows.push(r);
  }
  if(employeeRows.length!==1)throw Error(employeeRows.length?"KASBON_DUPLICATE_EMPLOYEE_LABEL":"KASBON_EMPLOYEE_ROW_MISSING");
  if(monthCols.length<1)throw Error("KASBON_MONTH_DATE_GRID_MISSING");
  candidates.push({headerRow:h,firstDataRow,totalRow,dayColumn:dateColumns[0],
   employeeRow:employeeRows[0],monthEndColumn:Math.max(...monthCols)});
 }
 if(candidates.length!==1)throw Error(candidates.length?"KASBON_MONTH_SECTION_AMBIGUOUS":"KASBON_MONTH_SECTION_MISSING");
 return candidates[0];
}
