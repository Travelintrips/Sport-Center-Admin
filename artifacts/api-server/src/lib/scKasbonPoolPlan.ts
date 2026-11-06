// Pure, fail-closed target planner for the legacy Kasbon POOL grid.
// Does not modify data or guess employee identity.
export type PoolPlan =
  | {status:"blocked"; reason:string}
  | {status:"ready"; cell:string; row:number; col:string; expectedAmount:string};
export type PoolInput = {
  employeeId:string; kasbonDate:string; amount:string;
  configuredRow:number|null;
  employeeName:string;
  headings:Record<string,string>;
  rowDescription:string;
  currentCell:string;
  employeeTotalFormula:string;
  dailyTotalFormula:string;
  totalRowLabel:string;
};
const alias:Record<string,RegExp>={
  SC003:/^kasbon robby$/i,
  SC005:/^kasbon seno$/i,
  SC006:/^kabon mustopa$/i,
  SC007:/^kasbon sandi$/i,
  SC008:/^sonic$/i,
};
const normalize=(x:string)=>x.trim().replace(/\s+/g," ");
export function planPoolKasbon(input:PoolInput):PoolPlan {
 const {employeeId,kasbonDate,configuredRow,rowDescription,headings,amount,currentCell,employeeTotalFormula,dailyTotalFormula,totalRowLabel}=input;
 // No assumption that Tri or a renamed employee has a defined row.
 if (!configuredRow || !Number.isSafeInteger(configuredRow) || configuredRow<=1042 || configuredRow>=1058)
   return {status:"blocked",reason:"EMPLOYEE_MAPPING_REQUIRED"};
 if (!alias[employeeId] || !alias[employeeId].test(normalize(rowDescription)))
   return {status:"blocked",reason:"EMPLOYEE_ROW_NOT_VERIFIED"};
 if (!/^2026-11-(0[1-9]|[12]\d|30)$/.test(kasbonDate))
   return {status:"blocked",reason:"MONTH_NOT_AUDITED"};
 const day=Number(kasbonDate.slice(-2));
 const expectedHeader="11-"+day+"-2026";
 const columns=Object.entries(headings).filter(([,label])=>label===expectedHeader);
 if(columns.length!==1)return {status:"blocked",reason:"DATE_COLUMN_NOT_UNIQUE"};
 const [col]=columns[0];
 if(!/^[A-Z]+$/.test(col))return {status:"blocked",reason:"INVALID_COLUMN"};
 if(!/^(0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(amount) || Number(amount)<=0)
   return {status:"blocked",reason:"INVALID_AMOUNT"};
 if(currentCell.trim()!=="")return {status:"blocked",reason:"TARGET_OCCUPIED"};
 if(totalRowLabel.trim().toLowerCase()!=="total")return {status:"blocked",reason:"TOTAL_ROW_UNVERIFIED"};
 // Must be FORMULA, never a hardcoded subtotal, before writing any daily amount.
 const norm=(v:string)=>v.replace(/\s/g, "").toUpperCase();
 if (norm(employeeTotalFormula)!==`=SUM(D${configuredRow}:AI${configuredRow})` ||
     norm(dailyTotalFormula)!==`=SUM(${col}1043:${col}1057)`)
   return {status:"blocked",reason:"SUBTOTAL_FORMULAS_MISSING_OR_INCOMPLETE"};
 return {status:"ready",cell:col+configuredRow,row:configuredRow,col,expectedAmount:amount};
}
