// Pure, fail-closed planner. Existing transaction cells are never overwritten.
// Only matching, mathematically verified *subtotal* constants may become formulas.
export type PoolPlan =
 | {status:"blocked";reason:string}
 | {status:"ready";cell:string;row:number;col:string;expectedAmount:string;
     subtotalRepairs:Array<{cell:string;formula:string}>};
export type PoolInput = {
 employeeId:string;employeeName:string;kasbonDate:string;amount:string;
 configuredRow:number|null;rowDescription:string;headings:Record<string,string>;
 currentCell:string;employeeTotalFormula:string;dailyTotalFormula:string;
 employeeTotalCurrent:string;employeeTotalCalculated:number;
 dailyTotalCurrent:string;dailyTotalCalculated:number;
 monthlyTotalFormula:string;totalRowLabel:string;
};
const alias:Record<string,RegExp>={
 SC003:/^kasbon robby$/i,
 SC005:/^kasbon seno$/i,
 SC006:/^kabon mustopa$/i,
 SC007:/^kasbon sandi$/i,
 SC008:/^sonic$/i,
};
const employeeNames:Record<string,RegExp>={
 SC003:/^robby$/i,SC005:/^seno$/i,SC006:/^mustofa$/i,
 SC007:/^sandi$/i,SC008:/^dede saefulah\s*\/\s*sonik$/i,
};
const normalize=(x:string)=>x.trim().replace(/\s+/g," ");
function safeSubtotal(input:{
 formula:string;expectedFormula:string;current:string;calculated:number;cell:string;
}):{blocked?:string;repair?:{cell:string;formula:string}} {
 const norm=(s:string)=>s.replace(/\s/g,"").toUpperCase();
 if(norm(input.formula).startsWith("=")){
  if(norm(input.formula)!==norm(input.expectedFormula)) return {blocked:"SUBTOTAL_FORMULA_INCOMPLETE"};
  return {};
 }
 // Blank or malformed subtotal cannot be proven safe.
 if(input.current.trim()==="" || !/^-?\d+(?:\.\d+)?$/.test(input.current.trim()))
  return {blocked:"SUBTOTAL_UNVERIFIED"};
 if(!Number.isFinite(input.calculated) || Math.abs(Number(input.current)-input.calculated)>0.001)
  return {blocked:"SUBTOTAL_INCONSISTENT"};
 return {repair:{cell:input.cell,formula:input.expectedFormula}};
}
export function planPoolKasbon(input:PoolInput):PoolPlan {
 const {employeeId,kasbonDate,configuredRow,rowDescription,headings,amount,currentCell,totalRowLabel}=input;
 if(!configuredRow||!Number.isSafeInteger(configuredRow)||configuredRow<=1042||configuredRow>=1057)
  return {status:"blocked",reason:"EMPLOYEE_MAPPING_REQUIRED"};
 if(!alias[employeeId]?.test(normalize(rowDescription)))
  return {status:"blocked",reason:"EMPLOYEE_ROW_NOT_VERIFIED"};
 if(!employeeNames[employeeId]?.test(normalize(input.employeeName)))
  return {status:"blocked",reason:"EMPLOYEE_MASTER_NAME_CHANGED"};
 if(!/^2026-11-(0[1-9]|[12]\d|30)$/.test(kasbonDate))
  return {status:"blocked",reason:"MONTH_NOT_AUDITED"};
 const day=Number(kasbonDate.slice(-2));
 const columns=Object.entries(headings).filter(([,label])=>label==="11-"+day+"-2026");
 if(columns.length!==1)return {status:"blocked",reason:"DATE_COLUMN_NOT_UNIQUE"};
 const [col]=columns[0];
 if(!/^[A-Z]+$/.test(col))return {status:"blocked",reason:"INVALID_COLUMN"};
 if(!/^(0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(amount)||Number(amount)<=0)
  return {status:"blocked",reason:"INVALID_AMOUNT"};
 if(currentCell.trim()!=="")return {status:"blocked",reason:"TARGET_OCCUPIED"};
 if(totalRowLabel.trim().toLowerCase()!=="total")
  return {status:"blocked",reason:"TOTAL_ROW_UNVERIFIED"};
 // Existing C1058 includes only 1043:1056, so all allowed employee rows
 // are deliberately <=1056. Never silently populate row 1057.
 if(!/^=SUM\(C1043:C1056\)$/i.test(input.monthlyTotalFormula.replace(/\s/g,"")) &&
    !/^=SUM\(C1043:C1057\)$/i.test(input.monthlyTotalFormula.replace(/\s/g,"")))
  return {status:"blocked",reason:"MONTH_TOTAL_FORMULA_UNVERIFIED"};
 const employeeSubtotal=safeSubtotal({
  formula:input.employeeTotalFormula,
  expectedFormula:`=SUM(D${configuredRow}:AI${configuredRow})`,
  current:input.employeeTotalCurrent,
  calculated:input.employeeTotalCalculated,cell:"C"+configuredRow,
 });
 if(employeeSubtotal.blocked)return {status:"blocked",reason:employeeSubtotal.blocked};
 const dailySubtotal=safeSubtotal({
  formula:input.dailyTotalFormula,
  expectedFormula:`=SUM(${col}1043:${col}1057)`,
  current:input.dailyTotalCurrent,calculated:input.dailyTotalCalculated,cell:col+"1058",
 });
 if(dailySubtotal.blocked)return {status:"blocked",reason:dailySubtotal.blocked};
 const repairs=[employeeSubtotal.repair,dailySubtotal.repair].filter(
  (x):x is {cell:string;formula:string}=>!!x
 );
 return {status:"ready",cell:col+configuredRow,row:configuredRow,col,expectedAmount:amount,
  subtotalRepairs:repairs};
}
