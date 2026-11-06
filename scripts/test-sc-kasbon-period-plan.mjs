import assert from "node:assert/strict";
import {planNewPeriod,buildPeriodCells,nextPeriod} from "../artifacts/api-server/src/lib/scKasbonPeriodPlan.ts";
const formatted=Array.from({length:1080},()=>[]);
const unformatted=Array.from({length:1080},()=>[]);
const put=(rows,r,c,value)=>{while(rows.length<r)rows.push([]);rows[r-1][c-1]=value;};
put(formatted,1041,1,"November");
put(formatted,1042,1,"Tanggal");put(formatted,1042,2,"Keterangan");
put(unformatted,1042,5,(Date.UTC(2026,10,1)-Date.UTC(1899,11,30))/86400000);
const employees=["Roly","Kasbon Febri","Kasbon Robby","Kasbon Andi","sonic"];
employees.forEach((label,i)=>put(formatted,1043+i,2,label));
put(formatted,1048,2,"Total");
const mode="febri_andi_only";
const plan=planNewPeriod(formatted,unformatted,"2026-12",mode);
assert.equal(plan.sourceStart,1041);
assert.equal(plan.sourceEnd,1048);
assert.equal(plan.employeeCount,5);
assert.equal(nextPeriod("2026-12"),"2027-01");
const cells=buildPeriodCells(plan);
assert.equal(cells[0][0].userEnteredValue.stringValue,"Desember");
assert.equal(cells[1][4].userEnteredValue.numberValue,(Date.UTC(2026,11,1)-Date.UTC(1899,11,30))/86400000);
assert.equal(cells[2][3].userEnteredValue.numberValue,0);
assert.equal(cells[3][3].userEnteredValue.formulaValue,"=C1044"); // Febri
assert.equal(cells[4][3].userEnteredValue.numberValue,0); // Robby
assert.equal(cells[5][3].userEnteredValue.formulaValue,"=C1046"); // Andi
assert.equal(cells[6][3].userEnteredValue.numberValue,0); // Sonik
for(let i=2;i<7;i++){
 assert.equal(cells[i][2].userEnteredValue.formulaValue,
   `=SUM(D${plan.destinationStart+i}:AI${plan.destinationStart+i})`);
 for(let col=4;col<35;col++)
  assert.equal(cells[i][col].userEnteredValue,undefined,"Transaction date must be blank");
}
assert.equal(cells[7][2].userEnteredValue.formulaValue,
 `=SUM(C${plan.destinationStart+2}:C${plan.destinationEnd-1})`);
const decFormatted=formatted.map(r=>r.slice());
const decRaw=unformatted.map(r=>r.slice());
put(decFormatted,plan.destinationStart,1,"Desember");
put(decFormatted,plan.destinationStart+1,1,"Tanggal");
put(decFormatted,plan.destinationStart+1,2,"Keterangan");
put(decRaw,plan.destinationStart+1,5,(Date.UTC(2026,11,1)-Date.UTC(1899,11,30))/86400000);
employees.forEach((label,i)=>put(decFormatted,plan.destinationStart+i+2,2,label));
put(decFormatted,plan.destinationEnd,2,"Total");
const january=planNewPeriod(decFormatted,decRaw,"2027-01",mode);
const janCells=buildPeriodCells(january);
assert.equal(janCells[0][0].userEnteredValue.stringValue,"Januari");
assert.equal(janCells[3][3].userEnteredValue.formulaValue,`=C${plan.destinationStart+3}`);
assert.equal(janCells[5][3].userEnteredValue.formulaValue,`=C${plan.destinationStart+5}`);
assert.equal(janCells[2][3].userEnteredValue.numberValue,0);
assert.throws(()=>planNewPeriod(formatted,unformatted,"2026-10",mode),/PREVIOUS_PERIOD/);
assert.throws(()=>planNewPeriod(formatted,unformatted,"2026-11",mode),/PERIOD_ALREADY_EXISTS/);
const missing=formatted.map(r=>r.slice());
put(missing,1044,2,"not Febri");
assert.throws(()=>planNewPeriod(missing,unformatted,"2026-12",mode),/REQUIRED_CARRYOVER_EMPLOYEE/);
const extra=formatted.map(r=>r.slice());
put(extra,1061,2,"historical protected");
assert.throws(()=>planNewPeriod(extra,unformatted,"2026-12",mode),/HISTORICAL_DATA_AFTER_SOURCE_BLOCK/);
assert.throws(()=>planNewPeriod(formatted,unformatted,"2026-12","previous_total"),/CARRY_MODE_REQUIRED/);
assert.throws(()=>planNewPeriod(formatted,unformatted,"2026-12","zero"),/CARRY_MODE_REQUIRED/);
console.log("PASS: only Febri and Andi carried; other employees zero; daily cells blank; totals formulas; December+January; fail-closed cases");
