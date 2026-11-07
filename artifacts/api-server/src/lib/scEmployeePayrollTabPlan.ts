import {monthNames,parsePeriod,nextPeriod} from "./scKasbonPeriodPlan";

/** Payroll tabs are independent from the Kasbon POOL monthly sections. */
export function salaryTabTitle(period:string):string {
 const {year,month}=parsePeriod(period);
 return `Gaji ${monthNames[month-1]} ${year}`;
}
export function previousPayrollPeriod(period:string):string {
 const {year,month}=parsePeriod(period);
 return `${month===1?year-1:year}-${String(month===1?12:month-1).padStart(2,"0")}`;
}
export type PayrollDraftPlan={
 period:string; sourcePeriod:string; sourceTitle:string;targetTitle:string;
 employeeCount:number;clearCells:string[];retainedFormulas:number;
};
/** Build a new-month draft: retain names, banking details, formatting, formulas,
 * and headers; remove copied numeric attendance, salary, kasbon and payout data.
 * This routine works ONLY from the previous month's verified template, never
 * from arbitrary metadata supplied by a browser.
 */
export function planPayrollDraft(period:string,sourceRows:unknown[][]):PayrollDraftPlan {
 const sourcePeriod=previousPayrollPeriod(period);
 if(nextPeriod(sourcePeriod)!==period)throw Error("PAYROLL_PERIOD_NOT_SEQUENTIAL");
 if(sourceRows.length<20||sourceRows.length>200)throw Error("PAYROLL_TEMPLATE_ROWS_UNEXPECTED");
 const clearCells:string[]=[];
 let employeeCount=0,retainedFormulas=0;
 const col=(n:number)=>String.fromCharCode(65+n);
 for(let i=0;i<sourceRows.length;i++){
  const row=sourceRows[i]??[];
  const number=String(row[0]??"").trim();
  const name=String(row[1]??"").trim();
  const employee=/^[1-9]\d{0,2}$/.test(number)&&name.length>1&&name.toUpperCase()!=="TOTAL";
  const subtotal=/^TOTAL$/i.test(number)||(/^TOTAL$/i.test(String(row[6]??"").trim())&&/^(\s*|TOTAL)$/i.test(number));
  if(employee)employeeCount++;
  if(employee||subtotal){
   for(let c=2;c<=7;c++){
    const v=row[c];
    if(typeof v==="string"&&v.startsWith("=")){retainedFormulas++;continue;}
    if(v===null||v===undefined||String(v).trim()==="")continue;
    // Preserve explicit "TOTAL" header markers in G.
    if(c===6&&/^TOTAL$/i.test(String(v).trim()))continue;
    clearCells.push(`${col(c)}${i+1}`);
   }
  }
  // Summary labels in L and values in M, including grand total.
  const label=String(row[11]??"").trim();
  if(/^(gaji\b|total gaji\b)/i.test(label)){
   const v=row[12];
   if(typeof v==="string"&&v.startsWith("=")){retainedFormulas++;continue;}
   if(v!==undefined&&v!==null&&String(v).trim()!=="")clearCells.push(`M${i+1}`);
  }
 }
 if(employeeCount<4||employeeCount>100)throw Error("PAYROLL_TEMPLATE_EMPLOYEE_COUNT_UNSAFE");
 if(clearCells.length<employeeCount)throw Error("PAYROLL_TEMPLATE_NOTHING_TO_CLEAR");
 return {period,sourcePeriod,sourceTitle:salaryTabTitle(sourcePeriod),targetTitle:salaryTabTitle(period),
  employeeCount,clearCells,retainedFormulas};
}
