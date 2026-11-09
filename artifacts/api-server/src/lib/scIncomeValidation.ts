import {createHash} from "node:crypto";
export const INCOME_TAB="SC Uang Masuk";
export const INCOME_HEADERS=["SC Entry ID","Tanggal","Dana Masuk (Dari)","Bank Pengirim","Metode","Bank / Akun Penerima","Nominal IDR","Referensi Bank","Status Bank","Dibuat Pada"];
export type IncomeInput={entryKey:string;transactionDate:string;sourceName:string;senderBank:string;method:string;receivingAccount:string;amount:number;bankReference?:string|null};
export function validateIncome(data:unknown):IncomeInput{
 const o=(data&&typeof data==="object")?data as Record<string,unknown>:{};
 const s=(k:string)=>typeof o[k]==="string"?String(o[k]).trim():"";
 const entryKey=s("entryKey"),transactionDate=s("transactionDate"),sourceName=s("sourceName"),senderBank=s("senderBank"),method=s("method"),receivingAccount=s("receivingAccount"),bankReference=s("bankReference");
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(entryKey))throw Error("INVALID_ENTRY_KEY");
 const d=new Date(transactionDate+"T00:00:00Z");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==transactionDate)throw Error("INVALID_DATE");
 if(sourceName.length<2||sourceName.length>160||senderBank.length<2||senderBank.length>120||receivingAccount.length>160||
   (method==="Transfer Bank"&&receivingAccount.length<2)||!["Transfer Bank","Tunai","QRIS","Lainnya"].includes(method)||bankReference.length>120)throw Error("REQUIRED_FIELD_MISSING");
 if(typeof o.amount!=="number"||!Number.isSafeInteger(o.amount)||o.amount<=0||o.amount>=1e12)throw Error("INVALID_AMOUNT");
 return {entryKey,transactionDate,sourceName,senderBank,method,receivingAccount,amount:o.amount,bankReference:bankReference||null};
}
export function incomeFingerprint(x:IncomeInput):string{
 const n=(s:string|null|undefined)=>String(s??"").trim().toLowerCase().replace(/\s+/g," ");
 return createHash("sha256").update(JSON.stringify([x.transactionDate,n(x.sourceName),n(x.senderBank),n(x.method),n(x.receivingAccount),x.amount,n(x.bankReference)])).digest("hex");
}
export function incomeRowPositions(rows:unknown[][],key:string):number[]{return rows.reduce<number[]>((a,row,i)=>{if(String(row?.[0]??"")===key)a.push(i+1);return a},[])}
