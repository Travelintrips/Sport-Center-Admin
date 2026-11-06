import assert from "node:assert/strict";
import {parseEmployeeSalary} from "../artifacts/api-server/src/routes/scEmployeeSalary.ts";
import {formatKasbonAmount,normalizeKasbonAmount,fromDatabaseKasbonAmount} from "../artifacts/sport-center/src/pages/admin/kasbonAmount.ts";
for (const amount of ["0","10000","100000","3500000","4200000","1000000000000"]) {
 const form = formatKasbonAmount(amount);
 const raw = normalizeKasbonAmount(form);
 assert.equal(raw,amount);
 const checked = parseEmployeeSalary(raw);
 assert.ok("salary" in checked);
 assert.equal(checked.salary, amount+".00");
 assert.equal(formatKasbonAmount(fromDatabaseKasbonAmount(checked.salary)), form);
}
assert.deepEqual(parseEmployeeSalary(null),{salary:null});
assert.deepEqual(parseEmployeeSalary(""),{salary:null});
for(const bad of ["-1","1.000.000","1.50","1e6","10000000000000",12,{}, "00010"]) {
 assert.ok("error" in parseEmployeeSalary(bad), "Must reject "+String(bad));
}
console.log("PASS: salary IDR input, API parsing, DB roundtrip, null legacy values, invalid inputs");
