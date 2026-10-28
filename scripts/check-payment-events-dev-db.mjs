import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {Client}=require('pg');
const raw=process.env.SUPABASE_DATABASE_URL_DEV;
const dev='xssrfshdrtdfupgqwfdw',prod='nzdweipzckfszczzqtuw';
if(!raw)throw Error('MISSING_DEV_DB_SECRET');
const url=new URL(raw);
const host=url.hostname.toLowerCase(),user=decodeURIComponent(url.username).toLowerCase();
const direct=host.includes(dev),pooler=host.endsWith('.pooler.supabase.com')&&user.endsWith('.'+dev);
if((!direct&&!pooler)||host.includes(prod)||user.includes(prod))throw Error('DB_PROJECT_ID_MISMATCH');
if(process.env.APP_ENV!=='development'||process.env.NODE_ENV!=='development'||process.env.SHEETS_PAYMENT_EVENTS_ENABLED!=='false')throw Error('DEV_RUNTIME_GUARD');
const db=new Client({connectionString:raw,connectionTimeoutMillis:10000,statement_timeout:15000,application_name:'sport-center-dev-event-readonly-audit'});
await db.connect();
try {
 await db.query('begin read only');
 const x=await db.query("select current_database() db,current_user role, (select enabled from sport_center.booking_sheets_payment_event_config where id=true) enabled, (select count(*)::int from sport_center.booking_sheets_payment_event_candidates) candidates,(select count(*)::int from sport_center.booking_sheets_payment_event_ledger) ledger");
 console.log(JSON.stringify({ok:true,project:dev,enabled:x.rows[0].enabled,candidates:x.rows[0].candidates,ledger:x.rows[0].ledger,connection:'DEV_READ_ONLY'}));
 await db.query('rollback');
} finally {await db.end();}
