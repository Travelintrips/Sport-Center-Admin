/** Safe dynamic target preflight for Kasbon POOL.
 * All section positions derive from the workbook; a missing month fails closed.
 */
import {columnName, sheetCell, type Section} from "./scKasbonPoolDiscovery";

export type Repair={cell:string;formula:string};
export type DynamicPlan=
 | {status:"blocked";reason:string}
 | {status:"ready";destination:string;employeeTotalCell:string;dayTotalCell:string;
    monthTotalCell:string;repairs:Repair[];before:{employee:number;day:number;month:number}};
const num=(s:unknown):number=>{
 const n=Number(s??0);
 if(!Number.isFinite(n)||!Number.isSafeInteger(Math.round(n*100))||Math.abs(Math.round(n*100)-n*100)>0.001)throw Error("KASBON_NON_NUMERIC_VALUE");
 return n;
};
const money=(s:unknown)=>typeof s==="string"?num(s):num(s);
const norm=(s:string)=>s.replace(/\s/g,"").toUpperCase();
/** A shortened legacy SUM may be safely expanded only if its exact range is
 * entirely inside the expected range AND the live displayed subtotal equals
 * the full recomputed sum. Unknown/arbitrary formulas are never overwritten.
 */
const sumArea=(formula:string)=>{
 const m=norm(formula).match(/^=SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/);
 if(!m)return null;
 const column=(col:string)=>[...col].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);
 return {firstCol:column(m[1]),firstRow:Number(m[2]),lastCol:column(m[3]),lastRow:Number(m[4])};
};
const safeSubsetSum=(current:string,expected:string)=>{
 const old=sumArea(current),target=sumArea(expected);
 return !!old&&!!target && old.firstCol>=target.firstCol && old.lastCol<=target.lastCol &&
  old.firstRow>=target.firstRow && old.lastRow<=target.lastRow &&
  old.firstCol<=old.lastCol && old.firstRow<=old.lastRow;
};
const safeSubtotal=(
 currentFormula:string, numericValue:number, expectedNumber:number,
 expectedFormula:string, cell:string, acceptable:(f:string)=>boolean
):{error?:string;repair?:Repair}=>{
 if(Math.abs(numericValue-expectedNumber)>0.001)
  return {error:"KASBON_SUBTOTAL_INCONSISTENT"};
 if(currentFormula.startsWith("=")) {
  if(acceptable(norm(currentFormula)))return {};
  // Never silently extend a legacy formula unless both SUM area and numeric
  // completeness are proven. numericValue===expectedNumber is checked above.
  if(safeSubsetSum(currentFormula,expectedFormula))
   return {repair:{cell,formula:expectedFormula}};
  return {error:"KASBON_SUBTOTAL_FORMULA_INCOMPLETE"};
 }
 return {repair:{cell,formula:expectedFormula}};
};
export function planDynamicKasbon(
 section:Section, formulas:unknown[][], raw:unknown[][], amount:string
):DynamicPlan {
 if(!/^(0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(amount)||num(amount)<=0)
  return {status:"blocked",reason:"KASBON_AMOUNT_INVALID"};
 const {firstDataRow:first,totalRow:lastPlus,employeeRow:r,dayColumn:c,monthEndColumn:lastCol}=section;
 const last=lastPlus-1;
 const col=columnName(c),endCol=columnName(lastCol);
 const get=(arr:unknown[][],row:number,c:number)=>sheetCell(arr,row,c);
 const dest=col+r;
 if(get(formulas,r,c)!=="")return {status:"blocked",reason:"KASBON_TARGET_OCCUPIED"};
 const sum=(locations:Array<[number,number]>)=>{
  let result=0;
  for(const [row,col] of locations) result+=money(get(raw,row,col)||"0");
  return result;
 };
 const employeeSum=sum(Array.from({length:lastCol-3},(_,i)=>[r,4+i] as [number,number]));
 const daySum=sum(Array.from({length:last-first+1},(_,i)=>[first+i,c] as [number,number]));
 const monthSum=sum(Array.from({length:last-first+1},(_,i)=>[first+i,3] as [number,number]));
 // An absent subtotal is not the same as an explicit numeric zero.
 for(const [row,col] of [[r,3],[lastPlus,c],[lastPlus,3]]){
  if(get(formulas,row,col)==="" && get(raw,row,col)==="")
   return {status:"blocked",reason:"KASBON_SUBTOTAL_MISSING"};
 }
 const employee=num(get(raw,r,3)||"0"), day=num(get(raw,lastPlus,c)||"0"),month=num(get(raw,lastPlus,3)||"0");
 const normalized=(s:string)=>norm(s);
 const checkEmployee=safeSubtotal(get(formulas,r,3),employee,employeeSum,
  `=SUM(D${r}:${endCol}${r})`,"C"+r,
  f=>{
    const m=f.match(/^=SUM\(D(\d+):([A-Z]+)(\d+)\)$/);
    if(!m||Number(m[1])!==r||Number(m[3])!==r)return false;
    const endIndex=m[2].split("").reduce((acc,ch)=>acc*26+ch.charCodeAt(0)-64,0);
    return endIndex>=lastCol;
  });
 if(checkEmployee.error)return {status:"blocked",reason:checkEmployee.error};
 const dayFormula=`=SUM(${col}${first}:${col}${last})`;
 const checkDay=safeSubtotal(get(formulas,lastPlus,c),day,daySum,
  dayFormula,col+lastPlus, f=>normalized(f)===normalized(dayFormula));
 if(checkDay.error)return {status:"blocked",reason:checkDay.error};
 const monthFormula=`=SUM(C${first}:C${last})`;
 const checkMonth=safeSubtotal(get(formulas,lastPlus,3),month,monthSum,
  monthFormula,"C"+lastPlus,f=>normalized(f)===normalized(monthFormula));
 // Existing 2026 November monthly total includes rows 1043:1056, not 1057.
 // If the omitted row is zero, old subtotal still matches and may safely be
 // upgraded to full coverage; otherwise refuse without overwriting.
 if(checkMonth.error==="KASBON_SUBTOTAL_FORMULA_INCOMPLETE"&&
    Math.abs(month-monthSum)<=0.001){
   checkMonth.error=undefined;
   checkMonth.repair={cell:"C"+lastPlus,formula:monthFormula};
 }
 if(checkMonth.error)return {status:"blocked",reason:checkMonth.error};
 const repairs=[checkEmployee.repair,checkDay.repair,checkMonth.repair]
  .filter((v):v is Repair=>v!==undefined);
 return {status:"ready",destination:dest,employeeTotalCell:"C"+r,
  dayTotalCell:col+lastPlus,monthTotalCell:"C"+lastPlus,repairs,
  before:{employee,day,month}};
}
