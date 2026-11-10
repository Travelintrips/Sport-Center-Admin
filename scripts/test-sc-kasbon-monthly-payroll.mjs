import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assertKasbonPeriod,recordsForKasbonPeriod,monthlyKasbonTotal,salaryTabForKasbonPeriod} from "../artifacts/api-server/src/lib/scKasbonMonthlyPeriod.ts";
const records=[
 {id:4,kasbonDate:"2026-11-05",amount:"1500000.00"},
 {id:15,kasbonDate:"2026-12-04",amount:"10000.00"},
 {id:16,kasbonDate:"2027-01-09",amount:"20000.00"},
 {id:17,kasbonDate:"2027-02-09",amount:"30000.00"}
];
assert.equal(assertKasbonPeriod("2026-11"),"2026-11");
for(const bad of ["2026-09","2027-00","2027-13","2027-1","2027-01-01","all","2099-13"])assert.throws(()=>assertKasbonPeriod(bad),/SALARY_PERIOD_INVALID/);
for(const [period,total,ids,tab] of [
 ["2026-10",0,[],"Gaji Oktober 2026"],
 ["2026-11",1500000,[4],"Gaji November 2026"],
 ["2026-12",10000,[15],"Gaji Desember 2026"],
 ["2027-01",20000,[16],"Gaji Januari 2027"],
 ["2027-02",30000,[17],"Gaji Februari 2027"],
 ["2027-03",0,[],"Gaji Maret 2027"]
]){
 assert.equal(monthlyKasbonTotal(records,period),total,period);
 assert.deepEqual(recordsForKasbonPeriod(records,period).map(x=>x.id),ids,period);
 assert.equal(salaryTabForKasbonPeriod(period),tab,period);
}
const route=readFileSync("artifacts/api-server/src/routes/scEmployeeKasbon.ts","utf8");
const sheets=readFileSync("artifacts/api-server/src/lib/scKasbonSalaryGoogle.ts","utf8");
const ui=readFileSync("artifacts/sport-center/src/pages/admin/SCEmployeeKasbon.tsx","utf8");
assert.match(route,/assertKasbonPeriod\(period\)/);
assert.match(route,/recordsForKasbonPeriod\(records,period\)/);
assert.match(route,/monthlyKasbonTotal\(records,period\)/);
assert.match(route,/recordsForKasbonPeriod\(latest,period\)/);
assert.match(route,/after:\{\.\.\.outcome,period,records:snapshot\}/);
assert.ok(route.includes("->>'period'"),"monthly receipt must be filtered by audit period");
assert.match(sheets,/filter\(s=>s\.properties\?\.title===tab\)/);
assert.match(sheets,/SALARY_WORKSHEET_NOT_VERIFIED/);
assert.match(sheets,/if\(!dryRun\)throw Error\("SALARY_EMPLOYEE_NAME_NOT_FOUND"\)/);
assert.match(sheets,/employeeMissing:true,matched:false/);
assert.match(route,/if\("employeeMissing" in outcome && outcome.employeeMissing\)/);
assert.match(route,/allSynced:false,syncedRecordIds:\[\]/);
assert.match(ui,/syncEvidence\?\.employeeMissing/);
assert.match(ui,/Sync Total dinonaktifkan/);
assert.match(sheets,/SALARY_NOVEMBER_WORKSHEET_ID_CHANGED/);
assert.match(sheets,/period,tab/);
assert.match(sheets,/salaryTabForKasbonPeriod\(period\)/);
assert.match(ui,/type="month" min="2026-10"/);
assert.match(ui,/visibleRecords=showAllMonths\?records:monthlyRecords/);
assert.match(ui,/const totalKasbon = monthlyRecords\.reduce/);
assert.match(ui,/queryKey:syncKey/);
assert.match(ui,/action:"preview",period:selectedPeriod/);
assert.match(ui,/action:"sync",period:selectedPeriod/);
assert.match(ui,/showAllMonths\|\|isSalaryChecking/);
assert.match(ui,/salaryPreview\.period!==selectedPeriod/);
assert.match(ui,/Insert Password/);
assert.doesNotMatch(ui,/Tujuan: Gaji November 2026/);
console.log("PASS: November, December, January rollover and February/March; no cross-month balances or receipt reuse");
