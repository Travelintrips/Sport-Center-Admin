/** Read-only reconciliation: neither DB nor Sheets is mutated. */
import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {Client}=require('pg');
const {google}=require('googleapis');
const sheetId='1W4m_DLxlFSwUybo1cUrx4k8Mm5MSm69fIqwet5pD5cU';
const tab='PAYMENT EVENTS OKTOBER 2026';
const rawDb=process.env.SUPABASE_DATABASE_URL_DEV;
if(!rawDb||!process.env.GOOGLE_SERVICE_ACCOUNT_JSON)throw Error('DEV_CREDENTIALS_MISSING');
const u=new URL(rawDb),dev='xssrfshdrtdfupgqwfdw';
if(!(u.hostname.includes(dev)||(u.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(u.username).endsWith('.'+dev))))throw Error('DB_NOT_DEV');
if(process.env.APP_ENV!=='development'||process.env.NODE_ENV!=='development'||process.env.SHEETS_PAYMENT_EVENTS_ENABLED!=='false'||process.env.GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID!==sheetId)throw Error('DEV_GUARD');
const creds=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
if(creds.type!=='service_account')throw Error('INVALID_ACCOUNT');
creds.private_key=creds.private_key.replace(/\\n/g,'\n');
const auth=new google.auth.GoogleAuth({credentials:creds,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
const sheets=google.sheets({version:'v4',auth});
const [sheet]=await Promise.all([sheets.spreadsheets.values.get({spreadsheetId:sheetId,range:`'${tab}'!A:J`,valueRenderOption:'FORMATTED_VALUE'})]);
const rows=sheet.data.values||[];
const db=new Client({connectionString:rawDb,connectionTimeoutMillis:10000,statement_timeout:15000});
await db.connect();
let ledgers;
try {await db.query('BEGIN READ ONLY');ledgers=(await db.query('select source_key,source_type,booking_id,payment_id,allocation_id,company_invoice_id,membership_payment_key,amount,payment_at,target_tab,sheet_row,status from sport_center.booking_sheets_payment_event_ledger order by id')).rows;await db.query('ROLLBACK');}finally{await db.end();}
const norm=x=>String(x??'').trim();
const money=x=>Math.round(Number(norm(x).replace(/,/g,''))*100);
const failures=[],extras=[];
const keys=new Map();
for(let i=1;i<rows.length;i++){const k=norm(rows[i]?.[0]);if(!k)continue;keys.set(k,[...(keys.get(k)||[]),i+1]);}
for(const x of ledgers){const row=rows[Number(x.sheet_row)-1]||[];const positions=keys.get(x.source_key)||[];const expectedDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x.payment_at));
 const issues=[];
 if(x.status!=='written')issues.push('status');if(x.target_tab!==tab)issues.push('tab');if(positions.length!==1||positions[0]!==Number(x.sheet_row))issues.push('key_or_row');
 if(norm(row[1])!==({'corporate_invoice':'corporate_invoice'}[x.source_type]||x.source_type))issues.push('type');
 if(norm(row[2])!==norm(x.booking_id))issues.push('booking');if(norm(row[3])!==norm(x.payment_id))issues.push('payment');if(norm(row[4])!==norm(x.allocation_id))issues.push('allocation');if(norm(row[5])!==norm(x.company_invoice_id))issues.push('invoice');
 if(money(row[8])!==money(x.amount))issues.push('amount');if(norm(row[7])!==expectedDate)issues.push('date');
 if(issues.length)failures.push({source_key:x.source_key,issues});
}
const known=new Set(ledgers.map(x=>x.source_key));for(const [key,positions] of keys){if(!known.has(key))extras.push({source_key:key,rows:positions});if(positions.length>1)failures.push({source_key:key,issues:['duplicate_sheet_key']});}
console.log(JSON.stringify({ok:failures.length===0,ledgerCount:ledgers.length,sheetDataRows:keys.size,matched:ledgers.length-failures.length,failures,untrackedRows:extras}));
if(failures.length)process.exitCode=1;
