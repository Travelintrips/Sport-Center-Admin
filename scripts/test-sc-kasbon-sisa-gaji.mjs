import assert from "node:assert/strict";
import {calculateSisaGaji} from "../artifacts/sport-center/src/pages/admin/kasbonSalaryBalance.ts";
const records=[
 {id:3,kasbonDate:"2026-12-01",amount:"500000.00"},
 {id:2,kasbonDate:"2026-11-05",amount:"300000.00"},
 {id:4,kasbonDate:"2026-11-05",amount:"200000.00"},
 {id:1,kasbonDate:"2026-11-01",amount:"1000000.00"}
];
const balance=calculateSisaGaji("3500000.00",records);
assert.equal(balance.get(1),2500000);
assert.equal(balance.get(2),2200000);
assert.equal(balance.get(4),2000000);
assert.equal(balance.get(3),3000000);
assert.equal(calculateSisaGaji(null,records).get(1),null);
assert.equal(calculateSisaGaji("0.00",records).get(1),-1000000);
const edited=records.map(r=>r.id===2?{...r,amount:"500000.00"}:r);
assert.equal(calculateSisaGaji("3500000.00",edited).get(4),1800000);
assert.equal(calculateSisaGaji("3500000.00",records.filter(r=>r.id!==2)).get(4),2300000);
assert.equal(calculateSisaGaji("3500000.00",[{id:9,kasbonDate:"2026-11-07",amount:"bogus"}]).get(9),null);
assert.equal(calculateSisaGaji(undefined,records).get(4),null);
console.log("PASS: sisa gaji bulanan, cumulative, tie-break, null salary, overdraft, edit, delete, invalid amount");
