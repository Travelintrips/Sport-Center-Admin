/** Calendar-month isolation: no Kasbon from a different month can enter salary Sync Total. */
export function assertKasbonPeriod(value:unknown):string{
 if(typeof value!=="string"||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)
   ||value<"2026-10"||value>"2099-12")throw Error("SALARY_PERIOD_INVALID");
 return value;
}
export function recordsForKasbonPeriod<T extends {kasbonDate:string}>(records:T[],period:string):T[]{
 assertKasbonPeriod(period);
 return records.filter(r=>r.kasbonDate.slice(0,7)===period);
}
export function monthlyKasbonTotal<T extends {amount:string|number;kasbonDate:string}>(records:T[],period:string):number{
 const total=recordsForKasbonPeriod(records,period).reduce((sum,r)=>sum+Number(r.amount),0);
 if(!Number.isSafeInteger(total)||total<0)throw Error("INVALID_KASBON_TOTAL");
 return total;
}

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
export function salaryTabForKasbonPeriod(period:string):string{
 assertKasbonPeriod(period);
 const [year,month]=period.split("-").map(Number);
 return `Gaji ${MONTHS[month-1]} ${year}`;
}
