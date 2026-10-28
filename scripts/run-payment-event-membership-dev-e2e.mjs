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
async function api(path,method,body,token){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error('API_'+method+'_'+path+'_'+r.status+'_'+String(j.dbCode??j.error??'unknown').slice(0,100)+'_CONSTRAINT_'+String(j.dbConstraint??'none').slice(0,60));return j;}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
try{
 const cfg=await db.query('select enabled from sport_center.booking_sheets_payment_event_config where id=true');
 if(cfg.rows[0]?.enabled!==false)throw Error('EVENT_CONFIG_ALREADY_ENABLED');
 const existing=await db.query("select count(*)::int n from sport_center.booking_sheets_payment_event_candidates c where c.payment_ts >= '2026-10-30T00:00:00Z' and c.validation_status='CANDIDATE' and not exists(select 1 from sport_center.booking_sheets_payment_event_ledger l where l.source_key=c.source_key and l.status='written')");
 if(existing.rows[0].n!==0)throw Error('NONEMPTY_DEV_PAYMENT_CANDIDATES');
 const tokenData=JSON.stringify({userId:1,role:'admin',tenantId:null,exp:Date.now()+15*60*1000});
 const token=Buffer.from(tokenData).toString('base64')+'.'+crypto.createHmac('sha256',process.env.SESSION_SECRET).update(tokenData).digest('hex');
 const m=await api('/memberships','POST',{name:'E2E-DEV-MEMBER-'+nonce,email:'e2e-'+nonce+'@example.invalid',phone:'0800'+nonce,startDate:'2026-11-01',months:1,notes:'DEV synthetic membership only'});
 if(!m.id)throw Error('MEMBERSHIP_CREATE_INVALID');
 console.log('DEV_MEMBERSHIP_CREATED',m.id);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
 const body=new FormData();body.set('proof',new Blob([png],{type:'image/png'}),'e2e-dev-proof.png');body.set('paymentMethod','transfer');body.set('paymentDate','2026-10-29');
 const uploaded=await fetch(base+'/memberships/'+m.id+'/admin-payment-proof-upload',{method:'POST',headers:{authorization:'Bearer '+token},body,signal:AbortSignal.timeout(30000)});
 const up=await uploaded.json().catch(()=>({}));if(!uploaded.ok)throw Error('MEMBERSHIP_PROOF_UPLOAD_'+uploaded.status+'_'+String(up.error??''));
 const allPayments=await api('/memberships/'+m.id+'/payments','GET',null,token);
 const pending=allPayments.find(x=>x.status==='waiting_confirmation');if(!pending?.id)throw Error('MEMBERSHIP_PENDING_PROOF_NOT_FOUND');
 await db.query("update sport_center.booking_sheets_payment_event_config set enabled=true,start_at=now()-interval '30 seconds',updated_at=now() where id=true and enabled=false");activated=true;
 const confirmed=await api('/memberships/'+m.id,'PATCH',{status:'active',settlementProviderCode:'mandiri_direct'},token);
 if(confirmed.status!=='active')throw Error('MEMBERSHIP_CONFIRM_FAILED');
 const saved=await db.query('select status,confirmed_at from sport_center.sport_membership_payments where id=$1',[pending.id]);
 if(saved.rows[0]?.status!=='confirmed'||!saved.rows[0]?.confirmed_at)throw Error('MEMBERSHIP_NOT_CONFIRMED_IN_DB');
 const accounting=await db.query('select p.id payment_id,b.id booking_id,b.dpp,b.ppn_rate,b.ppn_amount,b.grand_total,j.id journal_id,j.debit_amount,j.credit_revenue_amount,j.credit_ppn_amount,j.status journal_status from sport_center.sport_payments p join sport_center.sport_bookings b on b.id=p.booking_id left join sport_center.accounting_journals j on j.payment_id=p.id where p.source_membership_payment_id=$1',[pending.id]);
 if(accounting.rows.length!==1||!accounting.rows[0].journal_id||Number(accounting.rows[0].ppn_rate)!==0||Number(accounting.rows[0].ppn_amount)!==0||Number(accounting.rows[0].credit_ppn_amount)!==0||Number(accounting.rows[0].dpp)!==Number(accounting.rows[0].grand_total)||Number(accounting.rows[0].debit_amount)!==Number(accounting.rows[0].credit_revenue_amount))throw Error('MEMBERSHIP_PERSONAL_TAX_ACCOUNTING_MISMATCH');
 console.log('DEV_MEMBERSHIP_ZERO_TAX_JOURNAL_PASS',JSON.stringify({paymentId:pending.id,journalId:accounting.rows[0].journal_id,status:accounting.rows[0].journal_status}));
 console.log('DEV_MEMBERSHIP_PAYMENT_CONFIRMED',pending.id);
 let found,ledger;
 for(let i=0;i<25;i++){
  const c=await db.query('select source_key,source_type,amount,validation_status from sport_center.booking_sheets_payment_event_candidates where membership_payment_id=$1',[pending.id]);
  if(c.rows.length===1&&c.rows[0].source_type==='membership'&&c.rows[0].validation_status==='CANDIDATE'){
   found=c.rows[0];const l=await db.query('select source_key,status,target_tab,sheet_row from sport_center.booking_sheets_payment_event_ledger where source_key=$1',[found.source_key]);
   if(l.rows[0]?.status==='needs_review')throw Error('MEMBERSHIP_LEDGER_NEEDS_REVIEW');if(l.rows[0]?.status==='written'){ledger=l.rows[0];break;}
  }await sleep(5000);
 }
 if(!ledger)throw Error('MEMBERSHIP_LEDGER_NOT_WRITTEN');
 const sheet=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'"+ledger.target_tab+"'!A:A"});
 if((sheet.data.values??[]).filter(x=>String(x[0]??'')===found.source_key).length!==1)throw Error('MEMBERSHIP_SHEETS_NOT_ONE');
 await api('/memberships/'+m.id,'PATCH',{status:'active',settlementProviderCode:'mandiri_direct'},token);
 const after=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'"+ledger.target_tab+"'!A:A"});
 if((after.data.values??[]).filter(x=>String(x[0]??'')===found.source_key).length!==1)throw Error('MEMBERSHIP_REPLAY_DUPLICATED');
 console.log('DEV_MEMBERSHIP_E2E_PASS',JSON.stringify({membershipId:m.id,paymentId:pending.id,ledgerRows:1,sheetRows:1,duplicates:0}));
}finally{
 if(activated){await db.query('update sport_center.booking_sheets_payment_event_config set enabled=false,start_at=null,updated_at=now() where id=true').catch(()=>{});}
 await db.end();
}
