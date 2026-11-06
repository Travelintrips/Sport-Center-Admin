import assert from 'node:assert/strict';
import {planKasbonTotalSheet} from '../artifacts/api-server/src/lib/scKasbonTotalSheetPlan.ts';
const data=[{employeeId:'SC005',fullName:'Seno',total:'2000000.00'},{employeeId:'SC004',fullName:'Tri',total:'2000000.00'},{employeeId:'SC009',fullName:'Rian Ucok',total:'2571000.00'}];
const header=['ID Karyawan','Nama Lengkap','Total Kasbon'];
const first=planKasbonTotalSheet(data,[header]);
assert.deepEqual(first.map(x=>[x.employeeId,x.row,x.amount]),[['SC004',2,2000000],['SC005',3,2000000],['SC009',4,2571000]]);
const second=planKasbonTotalSheet(data,[header,...first.map(x=>[x.employeeId,x.name,x.amount])]);
assert.deepEqual(second,first); // retry overwrites same cells with same values; never adds
const modified=data.map(x=>x.employeeId==='SC009'?{...x,total:'2572000'}:x);
assert.equal(planKasbonTotalSheet(modified,[header,...first.map(x=>[x.employeeId,x.name,x.amount])])[2].amount,2572000);
assert.throws(()=>planKasbonTotalSheet(data,[['Something else']]),/TARGET_HEADERS/);
assert.throws(()=>planKasbonTotalSheet(data,[header,['SC009','Wrong Name',0]]),/NAME_MISMATCH/);
assert.throws(()=>planKasbonTotalSheet(data,[header,['SC777','Unknown',0]]),/UNKNOWN_OR_DUPLICATE/);
assert.throws(()=>planKasbonTotalSheet(data,[header,['SC009','Rian Ucok',0],['SC009','Rian Ucok',0]]),/UNKNOWN_OR_DUPLICATE/);
console.log('PASS: total sync insert/retry/update/identity validation; no sheet writes');
