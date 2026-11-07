import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync("artifacts/sport-center/src/pages/admin/SCEmployeeKasbon.tsx","utf8");
const section=ui.slice(ui.indexOf('<Card><CardHeader'),ui.indexOf('</CardHeader><CardContent>'));
assert.match(section,/disabled=\{isSalaryChecking\|\|isSalaryCheckError\|\|checkSalary\.isPending\|\|isSalarySynced/);
assert.match(section,/isSalaryChecking\|\|checkSalary\.isPending\|\|previewSalary\.isPending\?"Memeriksa Sheets\.\.\."/);
assert.match(section,/Pemeriksaan Sheets gagal/);
assert.match(ui,/const isSalarySynced=Boolean\(!isSalaryChecking&&!isSalaryCheckError/);
console.log("PASS: Sync Total disabled during Sheets loading and errors; never blindly overwrite G");
