/** Pure formatting/identity helpers; no bank or Sheets writes. */
export const cashIncomeNumber=(id:number)=>`SC-IN-${String(id).padStart(6,"0")}`;
export function cashLedgerRow(record:{id:number;transaction_date:string;source_name:string;amount:string|number}){
  const id=Number(record.id),amount=Number(record.amount);
  if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(amount)||amount<=0)throw Error("INVALID_CASH_ENTRY");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(record.transaction_date).slice(0,10)))throw Error("INVALID_CASH_DATE");
  return [
    String(record.transaction_date).slice(0,10).split("-").reverse().join("/"),
    `Dana Masuk dari ${String(record.source_name).trim().toUpperCase()} | TUNAI - KAS BESAR SC | ${cashIncomeNumber(id)}`,
    amount,"", "", "Pemasukan"
  ];
}
export const cashLedgerPositions=(rows:unknown[][],number:string)=>rows.reduce<number[]>((out,row,i)=>{
  if(String(row?.[0]??"").endsWith(` | ${number}`))out.push(i+1);
  return out;
},[]);
