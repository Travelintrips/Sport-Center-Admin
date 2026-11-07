import assert from "node:assert/strict";
import {discoverKasbonSection} from "../artifacts/api-server/src/lib/scKasbonPoolDiscovery.ts";
import {readFile,writeFile,unlink} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
const sourceUrl=new URL("../artifacts/api-server/src/lib/scKasbonPoolDynamicPlan.ts",import.meta.url);
const tempUrl=new URL("../artifacts/api-server/src/lib/scKasbonPoolDynamicPlan.testonly.ts",import.meta.url);
const source=await readFile(sourceUrl,"utf8");
await writeFile(tempUrl,source.replace('from "./scKasbonPoolDiscovery"','from "./scKasbonPoolDiscovery.ts"'));
const {planDynamicKasbon}=await import(tempUrl.href);
await unlink(tempUrl);
const make=(h,month,year)=>{
 const raw=Array.from({length:150},()=>[]);
 const formulas=Array.from({length:150},()=>[]);
 const formatted=Array.from({length:150},()=>[]);
 const put=(rows,r,c,v)=>{rows[r-1][c-1]=v;};
 put(formatted,h-1,1,month===12?"Desember":"Januari");
 put(formatted,h,1,"Tanggal");put(formatted,h,2,"Keterangan");
 const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
 for(let d=1;d<=lastDay;d++)put(formatted,h,4+d,`${month}-${d}-${year}`);
 put(formatted,h+1,2,"Kasbon Robby");
 put(formatted,h+2,2,"sonic");
 put(formatted,h+3,2,"Total");
 for(const [r,c,v] of [[h+1,4,0],[h+1,5,0],[h+2,4,0],[h+1,3,0],[h+2,3,0],[h+3,3,0],[h+3,5,0]])
  put(raw,r,c,v);
 // Existing zero-valued subtotal hardcodes are eligible for audited repair.
 put(formulas,h+1,3,0);
 put(formulas,h+3,3,0);
 put(formulas,h+3,5,0);
 return {raw,formulas,formatted};
};
for(const [h,month,year,day] of [[12,12,2026,5],[55,1,2027,3]]) {
 const {raw,formulas,formatted}=make(h,month,year);
 const date=`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
 raw[h+2][day+3]=0;
 formulas[h+2][day+3]=0;
 const section=discoverKasbonSection(formatted,raw,date,"Kasbon Robby");
 const plan=planDynamicKasbon(section,formulas,raw,"1500000.00");
 assert.equal(plan.status,"ready",JSON.stringify(plan));
 assert.equal(plan.destination,(day+4===9?"I":day+4===7?"G":"UNKNOWN")+(h+1));
 assert.equal(plan.repairs.length,3);
 // Legacy truncated SUM ranges can be extended only after verifying that
 // the live calculated subtotal equals the sum of all expected source cells.
 const col=day+4;
 const colLetter=col===9?"I":"G";
 formulas[h+2][col-1]=`=SUM(${colLetter}${h+1}:${colLetter}${h+1})`;
 const expandable=planDynamicKasbon(section,formulas,raw,"1500000.00");
 assert.equal(expandable.status,"ready",JSON.stringify(expandable));
 assert.ok(expandable.repairs.some(r=>r.cell===colLetter+(h+3)),"repair truncated day subtotal");
 formulas[h+2][col-1]=`=SUM(Z${h+1}:Z${h+2})`;
 const rejected=planDynamicKasbon(section,formulas,raw,"1500000.00");
 assert.equal(rejected.status,"blocked");
 assert.equal(rejected.reason,"KASBON_SUBTOTAL_FORMULA_INCOMPLETE");
 formulas[h+2][col-1]=`=SUM(${colLetter}${h+1}:${colLetter}${h+1})`;
 raw[h+2][col-1]=500;
 const mismatch=planDynamicKasbon(section,formulas,raw,"1500000.00");
 assert.equal(mismatch.status,"blocked");
 assert.equal(mismatch.reason,"KASBON_SUBTOTAL_INCONSISTENT");
}
console.log("PASS: month-agnostic subtotal planning and incomplete-formula rejection");

// Regression: creation of a December section must NOT redirect November events.
const grid=Array.from({length:1200},()=>[]);
const amounts=Array.from({length:1200},()=>[]);
const formulas=Array.from({length:1200},()=>[]);
const put=(arr,row,col,val)=>{arr[row-1][col-1]=val;};
for(const [header,month,year,label] of [[1042,11,2026,"November"],[1062,12,2026,"Desember"]]){
 put(grid,header-1,1,label);put(grid,header,1,"Tanggal");put(grid,header,2,"Keterangan");
 for(let day=1;day<=new Date(Date.UTC(year,month,0)).getUTCDate();day++)
  put(grid,header,day+4,`${month}-${day}-${year}`);
 put(grid,header+1,2,"Kasbon Robby");put(grid,header+2,2,"sonic");put(grid,header+3,2,"Total");
 for(const r of [header+1,header+2]){
  put(amounts,r,3,0);put(formulas,r,3,0);put(amounts,r,4,0);
 }
 for(const col of [3,9]){put(amounts,header+3,col,0);put(formulas,header+3,col,0);}
}
const november=discoverKasbonSection(grid,amounts,"2026-11-05","Kasbon Robby");
const december=discoverKasbonSection(grid,amounts,"2026-12-05","Kasbon Robby");
assert.equal(november.dayColumn,9);
assert.equal(december.dayColumn,9);
assert.equal(november.employeeRow,1043);
assert.equal(december.employeeRow,1063);
assert.equal(planDynamicKasbon(november,formulas,amounts,"1500000").destination,"I1043");
assert.equal(planDynamicKasbon(december,formulas,amounts,"1500000").destination,"I1063");
put(formulas,1043,9,1500000);
const repeat=planDynamicKasbon(november,formulas,amounts,"1500000");
assert.equal(repeat.status,"blocked");
assert.equal(repeat.reason,"KASBON_TARGET_OCCUPIED");
console.log("PASS: November transaction stays in November after December exists; retry blocked");
