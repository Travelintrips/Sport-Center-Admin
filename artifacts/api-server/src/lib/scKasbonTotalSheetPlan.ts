/** Pure, non-mutating planner for syncing aggregate Kasbon balances to a NEW dedicated sheet.
 * Column A: ID Karyawan; B: Nama Lengkap; C: Total Kasbon.
 * The writer will replace C (not increment it) and must verify row identity first.
 */
export type KasbonTotal = {employeeId:string;fullName:string;total:string|number};
export type TotalWrite = {row:number;employeeId:string;name:string;amount:number};
export function planKasbonTotalSheet(input:KasbonTotal[],sheetRows:unknown[][]):TotalWrite[]{
 const known=new Map<string,KasbonTotal>();
 for(const x of input){
  if(!/^SC[0-9]{3,}$/.test(x.employeeId) || !x.fullName.trim() || known.has(x.employeeId))throw Error('EMPLOYEE_IDENTITY_INVALID');
  const n=Number(x.total);
  if(!Number.isSafeInteger(n)||n<0)throw Error('TOTAL_AMOUNT_INVALID');
  known.set(x.employeeId,x);
 }
 const header=(sheetRows[0]??[]).map(v=>String(v??'').trim());
 if(sheetRows.length && (header[0]!=='ID Karyawan'||header[1]!=='Nama Lengkap'||header[2]!=='Total Kasbon'))
  throw Error('TARGET_HEADERS_NOT_VERIFIED');
 const mapped=new Map<string,number>();
 for(let i=1;i<sheetRows.length;i++){
  const row=sheetRows[i]??[];
  if(row.every(v=>v===null||v===undefined||String(v).trim()===''))continue;
  const id=String(row[0]??'').trim();
  if(!known.has(id)||mapped.has(id))throw Error('TARGET_EMPLOYEE_UNKNOWN_OR_DUPLICATE');
  // Do not silently overwrite a renamed/mismatched employee.
  if(String(row[1]??'').trim()!==known.get(id)!.fullName.trim())throw Error('TARGET_EMPLOYEE_NAME_MISMATCH');
  mapped.set(id,i+1);
 }
 let next=Math.max(2,sheetRows.length+1);
 return [...known.values()].sort((a,b)=>a.employeeId.localeCompare(b.employeeId))
  .map(e=>({row:mapped.get(e.employeeId)??next++,employeeId:e.employeeId,name:e.fullName,amount:Number(e.total)}));
}
