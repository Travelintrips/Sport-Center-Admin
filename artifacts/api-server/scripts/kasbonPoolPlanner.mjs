/** Pure preflight. This module NEVER performs Google Sheets writes. */
const normal=(s)=>String(s??"").toLowerCase().normalize("NFKC").replace(/\bkasbon\b/g,"").replace(/[^a-z0-9]+/g," ").trim();
const excelCol=(n)=>{let out="";while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}return out;};
/**
 * Preview a write to a single monthly cell. Never authorize production writes
 * from this preview alone; no reliable source-key exists in the legacy grid.
 */
export function previewKasbonPoolTarget({audit, employeeName, day, currentFormulaRows, currentValueRows}) {
 const month=audit?.november2026?.[0];
 if(!month||audit.november2026.length!==1 || !month.totalRow) return {status:"BLOCKED",reason:"MONTH_LAYOUT_UNVERIFIED"};
 const rows=month.employeeRows.filter(x=>normal(x.description)===normal(employeeName));
 if(rows.length!==1) return {status:"BLOCKED",reason:rows.length?"AMBIGUOUS_EMPLOYEE_ROW":"EMPLOYEE_ROW_NOT_FOUND"};
 if(!Number.isSafeInteger(day)||day<1||day>30) return {status:"BLOCKED",reason:"INVALID_DATE"};
 const header=month.headings.filter(x=>new RegExp("^11-"+day+"-2026$").test(x.text));
 if(header.length!==1) return {status:"BLOCKED",reason:"DATE_COLUMN_UNVERIFIED"};
 const row=rows[0].row,col=header[0].column;
 const formula=String(currentFormulaRows[row-1]?.[col-1]??"");
 const existing=currentValueRows[row-1]?.[col-1]??"";
 if(formula.startsWith("=")) return {status:"BLOCKED",reason:"TARGET_CONTAINS_FORMULA",cell:excelCol(col)+row};
 if(existing!=="" && existing!==null) return {status:"BLOCKED",reason:"TARGET_ALREADY_OCCUPIED",cell:excelCol(col)+row};
 return {status:"REVIEW_REQUIRED",reason:"SOURCE_KEY_LINK_MISSING",cell:excelCol(col)+row,description:rows[0].description};
}
