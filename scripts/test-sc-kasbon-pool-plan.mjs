import assert from "node:assert/strict";
import {planPoolKasbon} from "../artifacts/api-server/src/lib/scKasbonPoolPlan.ts";
const base={
  employeeId:"SC003",employeeName:"Robby",kasbonDate:"2026-11-06",amount:"1000000.00",
  configuredRow:1047,rowDescription:"Kasbon Robby",
  headings:{"I":"11-5-2026","J":"11-6-2026"},
  currentCell:"",employeeTotalFormula:"=SUM(D1047:AI1047)",
  dailyTotalFormula:"=SUM(J1043:J1057)",totalRowLabel:"Total"
};
assert.deepEqual(planPoolKasbon(base),{status:"ready",cell:"J1047",row:1047,col:"J",expectedAmount:"1000000.00"});
for(const [changes,reason] of [
  [{configuredRow:null},"EMPLOYEE_MAPPING_REQUIRED"],
  [{employeeId:"SC004"},"EMPLOYEE_ROW_NOT_VERIFIED"],
  [{rowDescription:"Kasbon orang lain"},"EMPLOYEE_ROW_NOT_VERIFIED"],
  [{kasbonDate:"2026-12-06"},"MONTH_NOT_AUDITED"],
  [{headings:{"I":"11-5-2026"}},"DATE_COLUMN_NOT_UNIQUE"],
  [{headings:{"J":"11-6-2026","K":"11-6-2026"}},"DATE_COLUMN_NOT_UNIQUE"],
  [{currentCell:"1500000"},"TARGET_OCCUPIED"],
  [{employeeTotalFormula:"0"},"SUBTOTAL_FORMULAS_MISSING_OR_INCOMPLETE"],
  [{dailyTotalFormula:"3000000"},"SUBTOTAL_FORMULAS_MISSING_OR_INCOMPLETE"],
  [{dailyTotalFormula:"=SUM(J1043:J1055)"},"SUBTOTAL_FORMULAS_MISSING_OR_INCOMPLETE"],
  [{employeeTotalFormula:"=SUM(D1047:AH1047)"},"SUBTOTAL_FORMULAS_MISSING_OR_INCOMPLETE"],
  [{totalRowLabel:"Not total"},"TOTAL_ROW_UNVERIFIED"],
  [{amount:"1.000.000"},"INVALID_AMOUNT"]
]){
 const result=planPoolKasbon({...base,...changes});
 assert.equal(result.status,"blocked");
 assert.equal(result.reason,reason);
}
console.log("PASS: 12 fail-closed cases including ID/date/formula/occupied-cell protection");
