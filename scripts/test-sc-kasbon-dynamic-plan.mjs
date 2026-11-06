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
 // Formulas that do not cover complete day rows must not pass.
 const col=day+4;
 formulas[h+2][col-1]=`=SUM(I${h+1}:I${h+1})`;
 const rejected=planDynamicKasbon(section,formulas,raw,"1500000.00");
 assert.equal(rejected.status,"blocked");
 assert.equal(rejected.reason,"KASBON_SUBTOTAL_FORMULA_INCOMPLETE");
}
console.log("PASS: month-agnostic subtotal planning and incomplete-formula rejection");
