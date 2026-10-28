import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {Client}=require('pg');
const raw=process.env.SUPABASE_DATABASE_URL_DEV??'';const u=new URL(raw||'postgres://invalid');const dev='xssrfshdrtdfupgqwfdw';
if(process.env.NODE_ENV!=='development'||process.env.APP_ENV!=='development'||process.env.SPORT_CENTER_E2E_PAYMENT_EVENTS!=='true'||process.env.SUPABASE_DATABASE_URL||!(u.hostname.includes(dev)||(u.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(u.username).endsWith('.'+dev))))throw Error('DEV_ONLY');
const db=new Client({connectionString:raw});await db.connect();
const id=22;
const snapshot=async()=>{const x=await db.query(`select (select count(*)::int from sport_center.sport_payments where id=22 and source_membership_payment_id=5) canonical,(select count(*)::int from public.sport_payments where source_payment_id=22) mirrors,(select count(*)::int from public.accounting_entries ae where ae.id in (select entry_id from public.sport_payments where source_payment_id=22)) entries,(select count(*)::int from sport_center.accounting_journals where payment_id=22) journals,(select count(*)::int from sport_center.accounting_journal_lines where journal_id in (select id from sport_center.accounting_journals where payment_id=22)) lines,(select status from sport_center.payment_accounting_outbox where payment_id=22) outbox,(select attempts from sport_center.payment_accounting_outbox where payment_id=22) attempts`);return x.rows[0]};
try{
 const before=await snapshot();if(before.canonical!==1||before.outbox!=='pending'||before.attempts!==0)throw Error('FIXTURE_GUARD_FAILED');
 const {processPaymentAccountingOutbox}=await import('../artifacts/api-server/dist/targeted-accounting.mjs');
 const once=await processPaymentAccountingOutbox(id);const after=await snapshot();
 console.log('DEV_TARGETED_POST_ATTEMPT',JSON.stringify({once,after}));
 if(once.claimed!==1||once.posted!==1||after.outbox!=='posted'||after.mirrors!==1||after.entries!==1||after.journals!==1)throw Error('TARGETED_POSTING_NOT_PASS');
 const twice=await processPaymentAccountingOutbox(id);const replay=await snapshot();
 if(twice.claimed!==0||JSON.stringify(after)!==JSON.stringify(replay))throw Error('REPLAY_CREATED_DUPLICATE');
 console.log('DEV_TARGETED_ACCOUNTING_E2E_PASS',JSON.stringify({after,replay}));
}finally{await db.end()}
