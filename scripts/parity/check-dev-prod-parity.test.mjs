import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareParity } from "./check-dev-prod-parity.mjs";
const baseline=JSON.parse(readFileSync(new URL("./prod-baseline-20261114.json",import.meta.url),"utf8"));
const fixtures=()=>({
 functions:baseline.functions.map(x=>({...x})),
 triggers:baseline.triggers.map(x=>({...x}))
});
test("the pinned PROD contract passes unchanged",()=>{
 const {functions,triggers}=fixtures();
 assert.equal(compareParity(baseline,functions,triggers).ok,true);
});
test("a stale journal definition blocks DEV parity",()=>{
 const {functions,triggers}=fixtures();
 functions.find(x=>x.proname==="sync_payment_accounting_journal").hash="00000000000000000000000000000000";
 const result=compareParity(baseline,functions,triggers);
 assert.equal(result.ok,false);
 assert.ok(result.changed.some(x=>x.includes("sync_payment_accounting_journal")));
});
test("a missing X904 function blocks DEV parity",()=>{
 const {functions,triggers}=fixtures();
 const result=compareParity(baseline,functions.filter(x=>x.proname!=="x904_publish_access_snapshot"),triggers);
 assert.equal(result.ok,false);
 assert.ok(result.missing.some(x=>x.includes("x904_publish_access_snapshot")));
});
test("a missing check-in trigger blocks DEV parity",()=>{
 const {functions,triggers}=fixtures();
 const result=compareParity(baseline,functions,triggers.filter(x=>x.tgname!=="gym_x904_auto_checkin_on_log"));
 assert.equal(result.ok,false);
 assert.ok(result.missing.some(x=>x.includes("gym_x904_auto_checkin_on_log")));
});
test("DEV-only helper functions do not count as PROD behavior drift",()=>{
 const {functions,triggers}=fixtures();
 functions.push({proname:"x904_dev_evidence_eligible",args:"",hash:"extra"});
 assert.equal(compareParity(baseline,functions,triggers).ok,true);
});
test("malformed or partial manifest is rejected",()=>{
 const {functions,triggers}=fixtures();
 assert.throws(()=>compareParity({...baseline,functions:baseline.functions.slice(1)},functions,triggers),/INVALID_PINNED_BASELINE/);
});
