import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolvePayrollIdentity} from "../artifacts/api-server/src/lib/scKasbonSalaryVerifiedIdentity.ts";
import {planKasbonSalaryColumnG} from "../artifacts/api-server/src/lib/scKasbonTotalSheetPlan.ts";

function payrollRows(name,row,kasbon){
 const rows=Array.from({length:34},()=>[]);
 rows[row-1]=["1",name,"","","","",kasbon,""];
 return rows;
}
const user={employeeId:"SC003",fullName:"Robby Rahman",total:0};
for(const [period,name,row,g] of [
 ["2026-10","ROBY RAHMAN",8,2500000],
 ["2026-11","ROBBY RAHMAN",9,""]
]){
 const alias=resolvePayrollIdentity(user.employeeId,user.fullName,period);
 assert.equal(alias.name,name);
 assert.equal(alias.expectedRow,row);
 const plan=planKasbonSalaryColumnG([user],payrollRows(name,row,g),{SC003:alias.name});
 assert.equal(plan.writes.length,1);
 assert.equal(plan.writes[0].row,row);
 assert.equal(plan.writes[0].range,"G"+row);
 assert.equal(plan.writes[0].name,name);
}
assert.equal(resolvePayrollIdentity("SC003","Robby Rahman","2026-12").name,"Robby Rahman");
assert.throws(()=>resolvePayrollIdentity("SC003","Other Employee","2026-11"),/SALARY_EMPLOYEE_ALIAS_IDENTITY_CHANGED/);
for(const [period,row,name] of [["2026-10",8,"ROBBY RAHMAN"],["2026-11",9,"ROBY RAHMAN"]]){
 const alias=resolvePayrollIdentity("SC003","Robby Rahman",period);
 const p=planKasbonSalaryColumnG([user],payrollRows(name,row,0),{SC003:alias.name});
 assert.equal(p.writes.length,0,"wrong-month alias must not be accepted");
}
const google=readFileSync("artifacts/api-server/src/lib/scKasbonSalaryGoogle.ts","utf8");
const route=readFileSync("artifacts/api-server/src/routes/scEmployeeKasbon.ts","utf8");
const ui=readFileSync("artifacts/sport-center/src/pages/admin/SCEmployeeKasbon.tsx","utf8");
assert.match(google,/resolvePayrollIdentity\(input.employeeId,input.fullName,period\)/);
assert.match(google,/SALARY_VERIFIED_EMPLOYEE_ROW_CHANGED/);
assert.match(route,/SALARY_HISTORICAL_OCTOBER_READ_ONLY/);
assert.match(route,/SALARY_MONTH_HAS_NO_KASBON_RECORDS/);
assert.match(ui,/selectedPeriod==="2026-10"\|\|monthlyRecords.length===0/);
assert.match(ui,/Check Sync hanya membaca Google Sheets/);
assert.match(google,/aliases\[input.employeeId\]\?\?identity.name/);
console.log("PASS historical verified payroll row mappings Oct G8, Nov G9; no accidental overwrite of October");
