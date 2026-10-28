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
 const existing=await db.query('select count(*)::int n from sport_center.booking_sheets_payment_event_candidates');
 if(existing.rows[0].n!==0)throw Error('NONEMPTY_DEV_PAYMENT_CANDIDATES');
 const tokenData=JSON.stringify({userId:1,role:'admin',tenantId:null,exp:Date.now()+15*60*1000});
 const token=Buffer.from(tokenData).toString('base64')+'.'+crypto.createHmac('sha256',process.env.SESSION_SECRET).update(tokenData).digest('hex');
 const group=await api('/bookings/recurring','POST',{customerName:'E2E-DEV-GROUP-'+nonce,customerPhone:'0000000000',facilityId:2,startDate:'2026-11-25',specificDates:['2026-11-25','2026-11-26'],startTime:'11:00',durationHours:1,repeatType:'daily',repeatCount:2,notes:'DEV synthetic recurring allocation',payerType:'personal',customerType:'umum'});
 if(group.created?.length!==2||!group.groupRef||Number(group.grandTotal)<=0)throw Error('GROUP_BOOKING_FIXTURE_INVALID');
 const b=group.created[0];
 console.log('DEV_GROUP_API_CREATED',JSON.stringify({bookingIds:group.created.map(x=>x.id),groupRef:group.groupRef,total:group.grandTotal}));
 const p=await api('/payments','POST',{bookingId:b.id,amount:Number(group.grandTotal),paymentMethod:'Transfer Bank',proofUrl:'dev-e2e-group-'+nonce,notes:'SYNTHETIC DEV GROUP ONLY'});
 if(!p.id)throw Error('GROUP_PAYMENT_RESPONSE_INVALID');
 await db.query('update sport_center.booking_sheets_payment_event_config set enabled=true,start_at=now()-interval \'30 seconds\',updated_at=now() where id=true and enabled=false');
 activated=true;
 const confirmed=await api('/payments/'+p.id,'PATCH',{status:'confirmed',paymentMethod:'Transfer Bank'},token);
 if(confirmed.status!=='confirmed')throw Error('GROUP_PAYMENT_CONFIRM_FAILED');
 let candidates=[], ledgers=[];
 for(let i=0;i<24;i++){
  const c=await db.query('select source_key,source_type,amount,validation_status from sport_center.booking_sheets_payment_event_candidates where payment_id=$1 order by source_key',[p.id]);
  if(c.rows.length===2&&c.rows.every(x=>x.source_type==='allocation'&&x.validation_status==='CANDIDATE')){
   candidates=c.rows;
   const l=await db.query('select source_key,status,target_tab,sheet_row from sport_center.booking_sheets_payment_event_ledger where source_key=any($1::text[])', [c.rows.map(x=>x.source_key)]);
   if(l.rows.some(x=>x.status==='needs_review'))throw Error('GROUP_LEDGER_NEEDS_REVIEW');
   if(l.rows.length===2&&l.rows.every(x=>x.status==='written')){ledgers=l.rows;break;}
  }
  await sleep(5000);
 }
 if(candidates.length!==2||ledgers.length!==2)throw Error('GROUP_LEDGER_NOT_WRITTEN');
 const totalCents=candidates.reduce((n,x)=>n+Math.round(Number(x.amount)*100),0);
 if(totalCents!==Math.round(Number(group.grandTotal)*100))throw Error('GROUP_ALLOCATION_AMOUNT_MISMATCH');
 const tab=ledgers[0].target_tab;
 if(!ledgers.every(x=>x.target_tab===tab))throw Error('GROUP_EVENT_TABS_MISMATCH');
 const sourceKeys=candidates.map(x=>x.source_key);
 const values=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'"+tab+"'!A:A"});
 const keys=(values.data.values??[]).map(x=>String(x[0]??''));
 if(sourceKeys.some(k=>keys.filter(x=>x===k).length!==1))throw Error('GROUP_SHEETS_NOT_ONE_PER_ALLOCATION');
 await api('/payments/'+p.id,'PATCH',{status:'confirmed'},token);
 await sleep(2000);
 const rows=await db.query('select source_key,status from sport_center.booking_sheets_payment_event_ledger where source_key=any($1::text[])',[sourceKeys]);
 if(rows.rows.length!==2||rows.rows.some(x=>x.status!=='written'))throw Error('GROUP_REPLAY_LEDGER_DUPLICATED');
 const second=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'"+tab+"'!A:A"});
 const keysAfter=(second.data.values??[]).map(x=>String(x[0]??''));
 if(sourceKeys.some(k=>keysAfter.filter(x=>x===k).length!==1))throw Error('GROUP_REPLAY_SHEETS_DUPLICATED');
 console.log('DEV_GROUP_ALLOCATION_E2E_PASS',JSON.stringify({bookingIds:group.created.map(x=>x.id),paymentId:p.id,allocations:2,ledgerRows:2,sheetRows:2,duplicates:0,total:Number(group.grandTotal)}));
}finally{
 if(activated){await db.query('update sport_center.booking_sheets_payment_event_config set enabled=false,start_at=null,updated_at=now() where id=true').catch(()=>{});}
 await db.end();
}
