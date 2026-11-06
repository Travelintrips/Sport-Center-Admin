/** Pure month section planner: no network, database, or Sheets mutations. */
export const monthNames = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
export type CarryMode = "zero" | "previous_total";
export type PeriodPlan = {
 period:string; sourcePeriod:string; sourceStart:number; sourceEnd:number;
 destinationStart:number; destinationEnd:number; employeeCount:number;
 employeeLabels:string[]; carryMode:CarryMode; columns:number;
};
const canon = (x:unknown) => String(x??"").toLocaleLowerCase("id-ID").trim().replace(/\s+/g," ");
export function parsePeriod(period:string):{year:number;month:number;monthLabel:string} {
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)) throw Error("INVALID_PERIOD");
 const [year,month]=period.split("-").map(Number);
 return {year,month,monthLabel:monthNames[month-1]};
}
export function nextPeriod(period:string):string {
 const {year,month}=parsePeriod(period);
 return `${year+(month===12?1:0)}-${String(month===12?1:month+1).padStart(2,"0")}`;
}
const headerMatches=(v:unknown,year:number,month:number):boolean=>{
 const str=String(v??"").trim();
 if(typeof v==="number" || /^\d{5}(?:\.0+)?$/.test(str)){
  const serial=Number(v);
  const date=new Date(Date.UTC(1899,11,30)+serial*86400000);
  return date.getUTCFullYear()===year&&date.getUTCMonth()+1===month&&date.getUTCDate()===1;
 }
 return str===`${month}-1-${year}` || str===`1/${month}/${year}`;
};
const get=(rows:unknown[][],r:number,c:number):unknown=>rows[r-1]?.[c-1]??"";
export function planNewPeriod(
 formatted:unknown[][],unformatted:unknown[][],period:string,carryMode:CarryMode
):PeriodPlan {
 const {year,month,monthLabel}=parsePeriod(period);
 if(carryMode!=="zero"&&carryMode!=="previous_total")throw Error("CARRY_MODE_REQUIRED");
 const prevMonth=month===1?12:month-1,prevYear=month===1?year-1:year;
 const prevPeriod=`${prevYear}-${String(prevMonth).padStart(2,"0")}`;
 const max=Math.max(formatted.length,unformatted.length);
 const sections:Array<{period:string;start:number;end:number;labels:string[]}>= [];
 for(let r=1;r<max;r++){
  if(canon(get(formatted,r+1,1))!=="tanggal"||canon(get(formatted,r+1,2))!=="keterangan")continue;
  const title=canon(get(formatted,r,1));
  const idx=monthNames.findIndex(n=>canon(n)===title);
  if(idx<0)continue;
  const firstDay=get(unformatted,r+1,5) || get(formatted,r+1,5);
  for(const candidateYear of new Set([prevYear,year])){
   if(!headerMatches(firstDay,candidateYear,idx+1))continue;
   let total:number|undefined;
   for(let n=r+3;n<Math.min(r+205,max+1);n++){
    if(canon(get(formatted,n,2))==="total"){total=n;break;}
    if(monthNames.some(m=>canon(m)===canon(get(formatted,n,1))))break;
   }
   if(!total)throw Error("SOURCE_TOTAL_ROW_MISSING");
   const labels=Array.from({length:total-r-2},(_,i)=>String(get(formatted,r+i+2,2)).trim());
   if(!labels.length || labels.some(x=>!x) || new Set(labels.map(canon)).size!==labels.length)
    throw Error("SOURCE_EMPLOYEE_LABELS_UNSAFE");
   sections.push({period:`${candidateYear}-${String(idx+1).padStart(2,"0")}`,start:r,end:total,labels});
  }
 }
 if(sections.some(s=>s.period===period))throw Error("PERIOD_ALREADY_EXISTS");
 const source=sections.filter(s=>s.period===prevPeriod);
 if(source.length!==1)throw Error("PREVIOUS_PERIOD_NOT_UNIQUE_OR_MISSING");
 // An older layout beyond this source can be present, but never insert into
 // the middle of historical rows; only append after the final occupied cell.
 const occupied=formatted.reduce((last,values,index)=>values?.some(v=>v!==""&&v!=null)?index+1:last,0);
 if(occupied>source[0].end+1)throw Error("HISTORICAL_DATA_AFTER_SOURCE_BLOCK");
 const start=occupied+3;
 return {period,sourcePeriod:prevPeriod,sourceStart:source[0].start,sourceEnd:source[0].end,
  destinationStart:start,destinationEnd:start+(source[0].end-source[0].start),
  employeeCount:source[0].labels.length,employeeLabels:source[0].labels,
  carryMode,columns:35};
}
export function buildPeriodCells(plan:PeriodPlan):Array<Array<{userEnteredValue?:{stringValue?:string;numberValue?:number;formulaValue?:string}}>> {
 const {period,destinationStart:top,employeeCount:count,sourceStart:src,carryMode}=plan;
 const {year,month,monthLabel}=parsePeriod(period);
 const dateEnd=new Date(Date.UTC(year,month,0)).getUTCDate();
 const value=(x:string|number,formula=false)=>typeof x==="number"?{userEnteredValue:{numberValue:x}}:
  formula?{userEnteredValue:{formulaValue:x}}:{userEnteredValue:{stringValue:x}};
 const blank=()=>({} as {userEnteredValue?:{stringValue?:string;numberValue?:number;formulaValue?:string}});
 const rows=Array.from({length:plan.destinationEnd-top+1},()=>Array.from({length:35},blank));
 rows[0][0]=value(monthLabel);
 rows[1][0]=value("Tanggal");rows[1][1]=value("Keterangan");rows[1][2]=value("TOTAL");
 rows[1][3]=value("sisa kasbon "+monthNames[(month+10)%12]);
 for(let day=1;day<=dateEnd;day++){
  const dateSerial=(Date.UTC(year,month-1,day)-Date.UTC(1899,11,30))/86400000;
  rows[1][day+3]=value(dateSerial);
 }
 for(let i=0;i<count;i++){
  const newRow=top+2+i,sourceRow=src+2+i;
  rows[i+2][0]=value(i+1);rows[i+2][1]=value(plan.employeeLabels[i]);
  rows[i+2][2]=value(`=SUM(D${newRow}:AI${newRow})`,true);
  rows[i+2][3]=carryMode==="previous_total"?value(`=C${sourceRow}`,true):value(0);
 }
 const last=top+2+count,idx=2+count;
 rows[idx][1]=value("Total");
 rows[idx][2]=value(`=SUM(C${top+2}:C${last-1})`,true);
 rows[idx][3]=value(`=SUM(D${top+2}:D${last-1})`,true);
 for(let day=1;day<=dateEnd;day++){
  const col=columnName(day+4);
  rows[idx][day+3]=value(`=SUM(${col}${top+2}:${col}${last-1})`,true);
 }
 return rows;
}
export function columnName(n:number):string {
 let s="";while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;
}
