import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {Client}=require('pg'),{google}=require('googleapis');
const dev='xssrfshdrtdfupgqwfdw',prod='nzdweipzckfszczzqtuw';
const id='1W4m_DLxlFSwUybo1cUrx4k8Mm5MSm69fIqwet5pD5cU';
const dburl=process.env.SUPABASE_DATABASE_URL_DEV,dbu=new URL(dburl??'postgres://invalid/');
const host=dbu.hostname.toLowerCase(),user=decodeURIComponent(dbu.username).toLowerCase();
if(process.env.NODE_ENV!=='development'||process.env.APP_ENV!=='development'||process.env.SPORT_CENTER_E2E_PAYMENT_EVENTS!=='true'||process.env.SHEETS_PAYMENT_EVENTS_ENABLED!=='true'||process.env.SUPABASE_DATABASE_URL||process.env.ALLOW_DEV_ON_PROD_STORAGE||!(host.includes(dev)||(host.endsWith('.pooler.supabase.com')&&user.endsWith('.'+dev)))||host.includes(prod)||user.includes(prod)||process.env.GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID!==id)throw Error('E2E_ISOLATION_FAILED');
if(!process.env.SESSION_SECRET||!process.env.GOOGLE_SERVICE_ACCOUNT_JSON)throw Error('E2E_SECRETS_MISSING');
const db=new Client({connectionString:dburl,application_name:'sc-dev-api-e2e-payment',connectionTimeoutMillis:10000,statement_timeout:15000});
await db.connect();
let activated=false;
const base='http://127.0.0.1:38888/api';
const eventKeyPrefix='payment:';
const creds=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
if(creds.type!=='service_account')throw Error('SA_INVALID');
const sheets=google.sheets({version:'v4',auth:new google.auth.GoogleAuth({credentials:creds,scopes:['https://www.googleapis.com/auth/spreadsheets']})});
const keyDate=new Date().toISOString().slice(0,10);
const nonce=crypto.randomBytes(4).toString('hex');
async function api(path,method,body,token){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error('API_'+method+'_'+path+'_'+r.status+'_'+String(j.code??j.error??'unknown').slice(0,100));return j;}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
try{
 const cfg=await db.query('select enabled from sport_center.booking_sheets_payment_event_config where id=true');
 if(cfg.rows[0]?.enabled!==false)throw Error('EVENT_CONFIG_ALREADY_ENABLED');
 const existing=await db.query("select count(*)::int n from sport_center.booking_sheets_payment_event_candidates c where c.validation_status='CANDIDATE' and not exists(select 1 from sport_center.booking_sheets_payment_event_ledger l where l.source_key=c.source_key and l.status='written')");
 if(existing.rows[0].n!==0)throw Error('NONEMPTY_DEV_PAYMENT_CANDIDATES');
 const tokenData=JSON.stringify({userId:1,role:'admin',tenantId:null,exp:Date.now()+15*60*1000});
 const token=Buffer.from(tokenData).toString('base64')+'.'+crypto.createHmac('sha256',process.env.SESSION_SECRET).update(tokenData).digest('hex');
 const b=await api('/bookings','POST',{customerName:'E2E-DEV-PAYMENT-'+nonce,customerPhone:'0000000000',facilityId:2,bookingDate:'2026-11-23',startTime:'11:00',durationHours:1,source:'admin',customerType:'personal',customerId:null,notes:'DEV synthetic payment event E2E, not real income'});
 if(!b.id||Number(b.grandTotal??b.totalPrice)<=0)throw Error('BOOKING_RESPONSE_INVALID');
 console.log('DEV_BOOKING_API_CREATED',b.id);
 const full=Number(b.grandTotal??b.totalPrice);
 const dp=Math.round(full*0.3);
 await api('/bookings/'+b.id+'/dp','PATCH',{downPaymentAmount:dp});
 console.log('DEV_DP_CONFIGURED',dp);
 const p=await api('/payments','POST',{bookingId:b.id,amount:dp,paymentMethod:'Transfer Bank',proofUrl:'dev-e2e-synthetic-'+nonce,notes:'SYNTHETIC DEV ONLY'});
 if(!p.id)throw Error('PAYMENT_RESPONSE_INVALID');
 console.log('DEV_PAYMENT_API_CREATED',p.id);
 await db.query('update sport_center.booking_sheets_payment_event_config set enabled=true,start_at=now()-interval \'30 seconds\',updated_at=now() where id=true and enabled=false');
 activated=true;
 const confirmed=await api('/payments/'+p.id,'PATCH',{status:'confirmed',paymentMethod:'Transfer Bank'},token);
 console.log('DEV_PAYMENT_CONFIRM_API',confirmed.status);
 let row,ledger;
 for(let i=0;i<18;i++){
  const c=await db.query('select source_key,validation_status from sport_center.booking_sheets_payment_event_candidates where booking_id=$1 and payment_id=$2',[b.id,p.id]);
  if(c.rows.length===1&&c.rows[0].validation_status==='CANDIDATE'){
   row=c.rows[0];
   const l=await db.query('select status,target_tab,sheet_row from sport_center.booking_sheets_payment_event_ledger where source_key=$1',[row.source_key]);
   if(l.rows[0]?.status==='written'){ledger=l.rows[0];break;}
   if(l.rows[0]?.status==='needs_review')throw Error('LEDGER_NEEDS_REVIEW');
  }
  await sleep(5000);
 }
 if(!row||!ledger)throw Error('WORKER_LEDGER_NOT_WRITTEN');
 const values=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'"+ledger.target_tab+"'!A:A"});
 const matches=(values.data.values??[]).filter(v=>String(v[0]??'')===row.source_key).length;
 if(matches!==1)throw Error('GOOGLE_SHEETS_COUNT_NOT_ONE_'+matches);
 console.log('LEDGER_WRITTEN_SHEETS_ONE',JSON.stringify({bookingId:b.id,paymentId:p.id,sourceKey:row.source_key,status:ledger.status,sheetRow:ledger.sheet_row,matches}));
 await api('/payments/'+p.id,'PATCH',{status:'confirmed'},token);
 await sleep(2000);
 const after=await db.query('select count(*)::int n from sport_center.booking_sheets_payment_event_ledger where source_key=$1',[row.source_key]);
 const check=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'"+ledger.target_tab+"'!A:A"});
 const afterMatches=(check.data.values??[]).filter(v=>String(v[0]??'')===row.source_key).length;
 if(after.rows[0].n!==1||afterMatches!==1)throw Error('REPLAY_DUPLICATED');
 const p2=await api('/payments','POST',{bookingId:b.id,amount:full-dp,paymentMethod:'Transfer Bank',proofUrl:'dev-e2e-final-'+nonce,notes:'SYNTHETIC DEV ONLY FINAL'});
 if(p2.paymentType!=='pelunasan')throw Error('EXPECTED_PELUNASAN');
 const confirmed2=await api('/payments/'+p2.id,'PATCH',{status:'confirmed',paymentMethod:'Transfer Bank'},token);
 if(confirmed2.status!=='confirmed')throw Error('FINAL_PAYMENT_NOT_CONFIRMED');
 let finalRow, finalLedger;
 for(let i=0;i<20;i++){
  const c=await db.query('select source_key,validation_status from sport_center.booking_sheets_payment_event_candidates where booking_id=$1 and payment_id=$2',[b.id,p2.id]);
  if(c.rows.length===1&&c.rows[0].validation_status==='CANDIDATE'){
   finalRow=c.rows[0];
   const l=await db.query('select status,target_tab,sheet_row from sport_center.booking_sheets_payment_event_ledger where source_key=$1',[finalRow.source_key]);
   if(l.rows[0]?.status==='written'){finalLedger=l.rows[0];break;}
   if(l.rows[0]?.status==='needs_review')throw Error('FINAL_LEDGER_NEEDS_REVIEW');
  }
  await sleep(5000);
 }
 if(!finalRow||!finalLedger)throw Error('FINAL_LEDGER_NOT_WRITTEN');
 await api('/payments/'+p2.id,'PATCH',{status:'confirmed'},token);
 const sheet=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'"+finalLedger.target_tab+"'!A:A"});
 const keys=(sheet.data.values??[]).map(v=>String(v[0]??''));
 if(keys.filter(k=>k===row.source_key).length!==1||keys.filter(k=>k===finalRow.source_key).length!==1)throw Error('DP_FINAL_DUPLICATION');
 const ledgerRows=await db.query('select source_key,status from sport_center.booking_sheets_payment_event_ledger where source_key=any($1::text[])',[[row.source_key,finalRow.source_key]]);
 if(ledgerRows.rows.length!==2||ledgerRows.rows.some(r=>r.status!=='written'))throw Error('DP_FINAL_LEDGER_COUNT');
 console.log('DEV_DP_FINAL_E2E_PASS',JSON.stringify({bookingId:b.id,dpPaymentId:p.id,finalPaymentId:p2.id,ledgerRows:2,sheetRows:2,duplicates:0}));
}finally{
 if(activated){await db.query('update sport_center.booking_sheets_payment_event_config set enabled=false,start_at=null,updated_at=now() where id=true').catch(()=>{});}
 await db.end();
}
