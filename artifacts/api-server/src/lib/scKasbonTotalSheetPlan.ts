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

/** Salary workbook target: gid 1429288652, name in B, kasbon in G.
 * Pure preview only: never create rows, alter other cells, or guess employee identity.
 * Explicit aliases must be verified externally and keyed by SC employee ID.
 */
export type SalaryKasbonWrite = {employeeId:string;name:string;row:number;range:string;amount:number};
export type SalaryKasbonPlan = {writes:SalaryKasbonWrite[];unmatched:{employeeId:string;name:string}[]};
const salaryName=(v:unknown)=>String(v??'').trim().replace(/\s+/g,' ').toLocaleUpperCase('id-ID');
export function planKasbonSalaryColumnG(
 input:KasbonTotal[],
 sheetRows:unknown[][],
 verifiedAliases:Record<string,string>={}
):SalaryKasbonPlan {
 const names=new Map<string,number[]>();
 for(let i=0;i<sheetRows.length;i++){
  const row=sheetRows[i]??[];
  const name=salaryName(row[1]);
  if(!name || name==='NAMA' || name==='TOTAL')continue;
  const rowNumber=i+1;
  // Only ordinary employee rows; never header/total/group rows.
  if(!/^\d+$/.test(String(row[0]??'').trim()))continue;
  names.set(name,[...(names.get(name)??[]),rowNumber]);
 }
 const seenIds=new Set<string>(), claimedRows=new Set<number>();
 const writes:SalaryKasbonWrite[]=[], unmatched:SalaryKasbonPlan['unmatched']=[];
 for(const employee of input){
  if(!/^SC\d{3,}$/.test(employee.employeeId)||!employee.fullName.trim()||seenIds.has(employee.employeeId))
   throw Error('EMPLOYEE_IDENTITY_INVALID');
  seenIds.add(employee.employeeId);
  const amount=Number(employee.total);
  if(!Number.isSafeInteger(amount)||amount<0)throw Error('TOTAL_AMOUNT_INVALID');
  const alias=verifiedAliases[employee.employeeId];
  if(alias!==undefined && (!alias.trim()||salaryName(alias)==='NAMA'))throw Error('EMPLOYEE_ALIAS_INVALID');
  const target=salaryName(alias??employee.fullName);
  const rows=names.get(target)??[];
  if(rows.length===0){unmatched.push({employeeId:employee.employeeId,name:employee.fullName});continue;}
  if(rows.length!==1)throw Error('SALARY_NAME_AMBIGUOUS');
  const row=rows[0];
  if(claimedRows.has(row))throw Error('SALARY_ROW_CLAIMED_TWICE');
  // Protect existing formulas and manual values until writer explicitly verifies ownership.
  const current=String(sheetRows[row-1]?.[6]??'').trim();
  if(current.startsWith('='))throw Error('SALARY_KASBON_FORMULA_PROTECTED');
  if(current && !/^(?:Rp\s*)?[\d.,]+$/i.test(current))throw Error('SALARY_KASBON_CELL_UNEXPECTED');
  claimedRows.add(row);
  writes.push({employeeId:employee.employeeId,name:String(sheetRows[row-1]?.[1]).trim(),row,range:'G'+row,amount});
 }
 return {writes: writes.sort((a,b)=>a.row-b.row),unmatched};
}
