import assert from "node:assert/strict";
import {discoverKasbonSection,columnName,matchingDate} from "../artifacts/api-server/src/lib/scKasbonPoolDiscovery.ts";
const make=()=>{
 const rows=Array.from({length:1200},()=>[]);
 const put=(r,c,v)=>{rows[r-1][c-1]=v;};
 const block=(monthName,month,year,header,labels)=>{
  put(header-1,1,monthName);put(header,1,"Tanggal");put(header,2,"Keterangan");
  for(let d=1;d<=new Date(Date.UTC(year,month,0)).getUTCDate();d++)put(header,4+d,`${month}-${d}-${year}`);
  labels.forEach((label,i)=>put(header+1+i,2,label));
  put(header+1+labels.length,2,"Total");
 };
 block("November",11,2026,1042,["Kasbon Robby","sonic"]);
 block("Desember",12,2026,1080,["Kasbon Robby","sonic"]);
 block("Januari",1,2027,1120,["Kasbon Robby","sonic"]);
 return {rows,put};
};
const {rows,put}=make();
assert.equal(columnName(9),"I");assert.equal(columnName(36),"AJ");
assert.equal(matchingDate("11-5-2026","2026-11-05"),true);
const nov=discoverKasbonSection(rows,rows,"2026-11-05","sonic");
assert.equal(discoverKasbonSection(rows,rows,"2026-11-05","Robby").employeeRow,1043);
assert.deepEqual(nov,{headerRow:1042,firstDataRow:1043,totalRow:1045,
 dayColumn:9,employeeRow:1044,monthEndColumn:34});
const dec=discoverKasbonSection(rows,rows,"2026-12-31","Kasbon Robby");
assert.equal(dec.headerRow,1080);assert.equal(dec.dayColumn,35);
const jan=discoverKasbonSection(rows,rows,"2027-01-02","sonic");
assert.equal(jan.headerRow,1120);assert.equal(jan.employeeRow,1122);
assert.throws(()=>discoverKasbonSection(rows,rows,"2027-02-05","sonic"),/MONTH_SECTION_MISSING/);
assert.throws(()=>discoverKasbonSection(rows,rows,"2026-11-30","Tri"),/EMPLOYEE_ROW_MISSING/);
put(1044,2,"Kasbon Robby");
assert.throws(()=>discoverKasbonSection(rows,rows,"2026-11-05","Kasbon Robby"),/DUPLICATE_EMPLOYEE_LABEL/);
assert.throws(()=>discoverKasbonSection(rows,rows,"2026-11-31","Kasbon Robby"),/DATE_INVALID/);
console.log("PASS: dynamic November, December, January 2027, missing month, missing employee, duplicate label and date validation");
