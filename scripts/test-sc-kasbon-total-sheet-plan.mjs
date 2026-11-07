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

import {planKasbonSalaryColumnG} from '../artifacts/api-server/src/lib/scKasbonTotalSheetPlan.ts';
const salaryRows=[
 ['NO','NAMA','UANG MAKAN','Hari Kerja','PERSENTASE','Total Salary','kasbon','Sisa Gaji'],
 [1,'ROLLY','','','','','',''],
 [2,'ANDI','','','','','',''],
 [3,'FEBRIANSYAH','','','','','',''],
 [4,'SENO','','','','','',''],
 ['TOTAL','','','','','','TOTAL',10020000],
 [],[],[],
 ['NO','NAMA','UANG MAKAN','Hari Kerja','PERSENTASE','Total Salary','kasbon','Sisa Gaji'],
 [1,'ROBBY','','','','','',''],
 [2,'MELSA','','','','','',''],
 [3,'FELICIA JUSTI','','','','','',''],
 [4,'ANGELIA NIRW','','','','','',''],
 [5,'RIPAN','','','','','',''],
 ['TOTAL','','','','','','TOTAL',28135000],
 [],
 ['NO','NAMA','UANG MAKAN','Hari Kerja','PERSENTASE','Total Salary','kasbon','Sisa Gaji'],
 [1,'TRI WISUDO','','','','','',''],
 [2,'SANDI','','','','','',''],
 [3,'MUSTOPA','','','','','',''],
 [4,'RIAN UCOK','','','','',0,'',0],
 ['TOTAL','','','','','','Total',12900000],
];
const balances=[{employeeId:'SC003',fullName:'Robby Rahman',total:1500000},...data];
const preview=planKasbonSalaryColumnG(balances,salaryRows,{'SC003':'ROBBY'});
assert.deepEqual(preview.writes.map(x=>[x.employeeId,x.range,x.amount]),[
 ['SC005','G5',2000000],['SC003','G11',1500000],['SC009','G22',2571000]]);
assert.deepEqual(preview.unmatched.map(x=>x.employeeId),['SC004']);
const approved=planKasbonSalaryColumnG(balances,salaryRows,{'SC003':'ROBBY','SC004':'TRI WISUDO'});
assert.deepEqual(approved.writes.map(x=>x.range),['G5','G11','G19','G22']);
const rerun=planKasbonSalaryColumnG(balances,salaryRows,{'SC003':'ROBBY','SC004':'TRI WISUDO'});
assert.deepEqual(rerun,approved);
const duplicated=salaryRows.map(r=>[...r]);duplicated[10][1]='SENO';
assert.throws(()=>planKasbonSalaryColumnG(balances,duplicated,{'SC003':'ROBBY'}),/SALARY_NAME_AMBIGUOUS/);
const formula=salaryRows.map(r=>[...r]);formula[4][6]='=SUM(A1:A3)';
assert.throws(()=>planKasbonSalaryColumnG(balances,formula,{'SC003':'ROBBY'}),/FORMULA_PROTECTED/);
assert.throws(()=>planKasbonSalaryColumnG([...balances,balances[0]],salaryRows,{'SC003':'ROBBY'}),/IDENTITY_INVALID/);
assert.throws(()=>planKasbonSalaryColumnG(balances,salaryRows,{'SC003':'ROBBY','SC004':'SENO'}),/CLAIMED_TWICE/);
console.log('PASS: salary B->G row planning, skip headings/totals, explicit alias, idempotency, formula/duplicate guards; no sheet writes');
