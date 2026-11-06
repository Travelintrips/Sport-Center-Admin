import assert from "node:assert/strict";
import {planPoolKasbon} from "../artifacts/api-server/src/lib/scKasbonPoolPlan.ts";
const base={
 employeeId:"SC003",employeeName:"Robby",kasbonDate:"2026-11-06",amount:"1000000.00",
 configuredRow:1047,rowDescription:"Kasbon Robby",
 headings:{"I":"11-5-2026","J":"11-6-2026"},
 currentCell:"",employeeTotalFormula:"1500000",
 dailyTotalFormula:"0",employeeTotalCurrent:"1500000",
 employeeTotalCalculated:1500000,dailyTotalCurrent:"0",dailyTotalCalculated:0,
 monthlyTotalFormula:"=SUM(C1043:C1056)",totalRowLabel:"Total"
};
const ready=planPoolKasbon(base);
assert.equal(ready.status,"ready");
assert.equal(ready.cell,"J1047");
assert.deepEqual(ready.subtotalRepairs,[
 {cell:"C1047",formula:"=SUM(D1047:AI1047)"},
 {cell:"J1058",formula:"=SUM(J1043:J1057)"}
]);
const correctFormulas=planPoolKasbon({...base,
 employeeTotalFormula:"=SUM(D1047:AI1047)",
 dailyTotalFormula:"=SUM(J1043:J1057)"
});
assert.equal(correctFormulas.status,"ready");
assert.deepEqual(correctFormulas.subtotalRepairs,[]);
for(const [changes,reason] of [
 [{configuredRow:null},"EMPLOYEE_MAPPING_REQUIRED"],
 [{configuredRow:1057},"EMPLOYEE_MAPPING_REQUIRED"],
 [{employeeId:"SC004"},"EMPLOYEE_ROW_NOT_VERIFIED"],
 [{employeeName:"Someone else"},"EMPLOYEE_MASTER_NAME_CHANGED"],
 [{rowDescription:"Kasbon orang lain"},"EMPLOYEE_ROW_NOT_VERIFIED"],
 [{kasbonDate:"2026-12-06"},"MONTH_NOT_AUDITED"],
 [{headings:{"I":"11-5-2026"}},"DATE_COLUMN_NOT_UNIQUE"],
 [{headings:{"J":"11-6-2026","K":"11-6-2026"}},"DATE_COLUMN_NOT_UNIQUE"],
 [{currentCell:"1500000"},"TARGET_OCCUPIED"],
 [{employeeTotalFormula:"=SUM(D1047:AH1047)"},"SUBTOTAL_FORMULA_INCOMPLETE"],
 [{dailyTotalFormula:"=SUM(J1043:J1055)"},"SUBTOTAL_FORMULA_INCOMPLETE"],
 [{employeeTotalCurrent:"1200000"},"SUBTOTAL_INCONSISTENT"],
 [{dailyTotalCurrent:"100000"},"SUBTOTAL_INCONSISTENT"],
 [{employeeTotalCurrent:""},"SUBTOTAL_UNVERIFIED"],
 [{totalRowLabel:"Not total"},"TOTAL_ROW_UNVERIFIED"],
 [{monthlyTotalFormula:"=SUM(C1043:C1055)"},"MONTH_TOTAL_FORMULA_UNVERIFIED"],
 [{amount:"1.000.000"},"INVALID_AMOUNT"]
]){
 const result=planPoolKasbon({...base,...changes});
 assert.equal(result.status,"blocked",JSON.stringify(changes));
 assert.equal(result.reason,reason,JSON.stringify(changes));
}
console.log("PASS: 19 Kasbon POOL safety scenarios: scoped formula repairs, consistency, occupied cell, name/date and total validation");
