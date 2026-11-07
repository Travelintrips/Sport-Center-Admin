import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {getKasbonReceiptStatus,snapshotKasbonRecords} from "../artifacts/api-server/src/lib/scKasbonSalarySnapshot.ts";
const d=(v)=>new Date(v);
const base=[
 {id:10,amount:"700.00",kasbonDate:"2026-11-02",updatedAt:d("2026-11-02T04:00:00Z")},
 {id:11,amount:"1871.00",kasbonDate:"2026-11-04",updatedAt:d("2026-11-04T04:00:00Z")}
];
const two=snapshotKasbonRecords(base);
const receipt={employeeId:"SC009",cell:"G20",amount:2571,records:two};
assert.deepEqual(getKasbonReceiptStatus(two,null,true),{syncedRecordIds:[],allSynced:false,hasReceipt:false},"matching Sheets alone isn't individual receipt");
assert.deepEqual(getKasbonReceiptStatus(two,receipt,true),{syncedRecordIds:[10,11],allSynced:true,hasReceipt:true});
const appended=snapshotKasbonRecords([...base,{id:12,amount:"500.00",kasbonDate:"2026-11-07",updatedAt:d("2026-11-07T04:00:00Z")}]);
assert.deepEqual(getKasbonReceiptStatus(appended,receipt,false).syncedRecordIds,[10,11],"new kasbon must not revoke older synced");
assert.equal(getKasbonReceiptStatus(appended,receipt,false).allSynced,false);
assert.deepEqual(getKasbonReceiptStatus(appended,{...receipt,amount:3071,records:appended},true).syncedRecordIds,[10,11,12]);
assert.equal(getKasbonReceiptStatus(appended,{...receipt,amount:3071,records:appended},true).allSynced,true);
const edited=snapshotKasbonRecords([{...base[0],amount:"800.00",updatedAt:d("2026-11-08T04:00:00Z")},base[1]]);
assert.deepEqual(getKasbonReceiptStatus(edited,receipt,false).syncedRecordIds,[11],"edited row must lose receipt status");
assert.deepEqual(getKasbonReceiptStatus([two[0]],receipt,false).syncedRecordIds,[10],"deleted row disappears and requires aggregate resync");
assert.equal(getKasbonReceiptStatus(two,receipt,false).allSynced,false,"Sheets readback mismatch keeps Sync enabled");
const ui=readFileSync("artifacts/sport-center/src/pages/admin/SCEmployeeKasbon.tsx","utf8");
assert.match(ui,/Sync Total/);
assert.match(ui,/disabled=\{isSalaryChecking\|\|isSalaryCheckError\|\|checkSalary\.isPending\|\|isSalarySynced/);
assert.match(ui,/syncedRecordIds\.has\(r\.id\)/);
assert.doesNotMatch(ui,/setSyncRecordId\(/);
console.log("PASS: one Sync Total, durable per-record receipts, append/edit/delete/readback, no Sheets writes");
