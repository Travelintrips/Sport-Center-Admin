import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {google}=require('googleapis');
const credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??'{}');
credentials.private_key=credentials.private_key?.replace(/\\n/g,'\n');
const sheets=google.sheets({version:'v4',auth:new google.auth.GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']})});
const spreadsheetId='1ZvHAydlYhdfnDZmOCcPNKtOnj-O3-l9bY84927bYN7E';
const tab='PAID OKTOBER 2026';
const values=(await sheets.spreadsheets.values.get({spreadsheetId,range:`'${tab}'!A1:N10000`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values??[];
const rows=values.slice(1).map((v,i)=>({row:i+2,order:String(v[0]??'').trim(),amount:Number(v[9]??0)})).filter(x=>x.order);
const counts=new Map();for(const r of rows)counts.set(r.order,(counts.get(r.order)??0)+1);
console.log(JSON.stringify({tab,headerColumns:values[0]?.length??0,physicalRows:rows.length,uniqueOrders:counts.size,duplicates:[...counts].filter(([,n])=>n>1).map(([order,n])=>({order,count:n})),orders:rows.map(x=>x.order),amountSum:rows.reduce((n,r)=>n+r.amount,0)}));

// Focused read-only proof for pre-existing ambiguous ledger claims.
const targets=new Set(['SC-1300','SC-1344','SC-1463','SC-1650']);
console.log(JSON.stringify({verifiedTargetRows:rows.filter(r=>targets.has(r.order))}));
