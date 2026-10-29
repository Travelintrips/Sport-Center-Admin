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
 const existing=await db.query("select count(*)::int n from sport_center.booking_sheets_payment_event_candidates c where c.payment_ts >= '2026-10-30T00:00:00Z' and c.validation_status='CANDIDATE' and not exists(select 1 from sport_center.booking_sheets_payment_event_ledger l where l.source_key=c.source_key and l.status='written')");
 if(existing.rows[0].n!==0)throw Error('NONEMPTY_DEV_PAYMENT_CANDIDATES');
 const tokenData=JSON.stringify({userId:1,role:'admin',tenantId:null,exp:Date.now()+15*60*1000});
 const token=Buffer.from(tokenData).toString('base64')+'.'+crypto.createHmac('sha256',process.env.SESSION_SECRET).update(tokenData).digest('hex');
 const companyId=57;
 const b=await api('/bookings','POST',{customerName:'E2E-DEV-CORPORATE-'+nonce,customerPhone:'0000000000',facilityId:2,bookingDate:'2027-02-06',startTime:'11:00',durationHours:1,source:'admin',customerId:null,payerType:'company',companyCustomerId:companyId,customerType:'umum',notes:'DEV SYNTHETIC CORPORATE INVOICE'},token);
 if(!b.id||b.payerType!=='company')throw Error('CORPORATE_BOOKING_INVALID');
 const invoice=await api('/company-invoices','POST',{companyCustomerId:companyId,periodMonth:'2027-02',notes:'SYNTHETIC DEV CORPORATE'},token);
 if(!invoice.id)throw Error('CORPORATE_INVOICE_INVALID');
 console.log('DEV_CORPORATE_INVOICE_CREATED',JSON.stringify({bookingId:b.id,invoiceId:invoice.id}));
 await db.query("update sport_center.booking_sheets_payment_event_config set enabled=true,start_at='2026-10-30T00:00:00Z',updated_at=now() where id=true and enabled=false");
 activated=true;
 const paid=await api('/company-invoices/'+invoice.id,'PATCH',{status:'paid',paymentMethod:'Transfer Bank',paymentDate:'2026-10-30'},token);
 console.log('DEV_CORPORATE_PAID_API',paid.status);
 const savedInvoice=await db.query('select invoice_status as status,paid_at from sport_center.company_invoices where id=$1',[invoice.id]);
 console.log('DEV_CORPORATE_PERSISTENCE_CHECK',JSON.stringify({invoiceId:invoice.id,storedStatus:savedInvoice.rows[0]?.status,paidAtPresent:!!savedInvoice.rows[0]?.paid_at}));
 if(savedInvoice.rows[0]?.status!=='paid')throw Error('CORPORATE_PAID_STATUS_NOT_PERSISTED');
 let candidates=[],ledgers=[];
 for(let i=0;i<22;i++){
  const c=await db.query('select source_key,source_type,amount,validation_status from sport_center.booking_sheets_payment_event_candidates where company_invoice_id=$1',[invoice.id]);
  if(c.rows.length===1&&c.rows[0].source_type==='corporate_invoice'&&c.rows[0].validation_status==='CANDIDATE'){
   candidates=c.rows;
   const l=await db.query('select source_key,status,target_tab,sheet_row from sport_center.booking_sheets_payment_event_ledger where source_key=$1',[c.rows[0].source_key]);
   if(l.rows[0]?.status==='needs_review')throw Error('CORPORATE_LEDGER_NEEDS_REVIEW');
   if(l.rows[0]?.status==='written'){ledgers=l.rows;break;}
  }
  await sleep(5000);
 }
 if(candidates.length!==1||ledgers.length!==1)throw Error('CORPORATE_LEDGER_NOT_WRITTEN');
 const tab=ledgers[0].target_tab,key=candidates[0].source_key;
 const before=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'"+tab+"'!A:A"});
 if((before.data.values??[]).filter(x=>String(x[0]??'')===key).length!==1)throw Error('CORPORATE_SHEETS_NOT_ONE');
 await api('/company-invoices/'+invoice.id,'PATCH',{status:'paid'},token);
 const after=await sheets.spreadsheets.values.get({spreadsheetId:id,range:"'"+tab+"'!A:A"});
 if((after.data.values??[]).filter(x=>String(x[0]??'')===key).length!==1)throw Error('CORPORATE_REPLAY_DUPLICATED');
 console.log('DEV_CORPORATE_E2E_PASS',JSON.stringify({bookingId:b.id,invoiceId:invoice.id,ledgerRows:1,sheetRows:1,duplicates:0}));
}finally{
 if(activated){await db.query('update sport_center.booking_sheets_payment_event_config set enabled=false,start_at=null,updated_at=now() where id=true').catch(()=>{});}
 await db.end();
}
