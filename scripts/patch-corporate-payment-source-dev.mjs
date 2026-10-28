import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {Client}=require('pg');
const raw=process.env.SUPABASE_DATABASE_URL_DEV??'';
const u=new URL(raw),dev='xssrfshdrtdfupgqwfdw';
if(process.env.NODE_ENV!=='development'||process.env.APP_ENV!=='development'||process.env.SHEETS_PAYMENT_EVENTS_ENABLED!=='false'||!(u.hostname.includes(dev)||(u.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(u.username).endsWith('.'+dev))))throw Error('DEV_ONLY');
const db=new Client({connectionString:raw});await db.connect();
try{await db.query('begin');
const result=await db.query("select enabled from sport_center.booking_sheets_payment_event_config where id=true");if(result.rows[0]?.enabled!==false)throw Error('WORKER_MUST_BE_OFF');
const view=await db.query("select pg_get_viewdef('sport_center.booking_sheets_payment_sources'::regclass,true) def");
const original=view.rows[0].def, old="i.status = 'paid'::text",current="i.invoice_status = 'paid'::text";
if(original.includes(old)){await db.query('create or replace view sport_center.booking_sheets_payment_sources as '+original.replace(old,current));}
else if(!original.includes(current))throw Error('VIEW_PREDICATE_UNKNOWN');
const verified=await db.query("select pg_get_viewdef('sport_center.booking_sheets_payment_sources'::regclass,true) like '%i.invoice_status = ''paid''::text%' ok");
if(!verified.rows[0].ok)throw Error('VIEW_PATCH_FAILED');await db.query('commit');console.log('CORPORATE_SOURCE_VIEW_DEV_FIXED');
}catch(e){await db.query('rollback');throw e;}finally{await db.end();}
