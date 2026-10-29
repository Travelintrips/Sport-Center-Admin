import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {Client}=require('pg');
const raw=process.env.SUPABASE_DATABASE_URL_DEV;
if(!raw||process.env.APP_ENV!=='development'||process.env.NODE_ENV!=='development'||process.env.SHEETS_PAYMENT_EVENTS_ENABLED!=='false')throw Error('DEV_GUARD');
const url=new URL(raw),host=url.hostname.toLowerCase(),user=decodeURIComponent(url.username).toLowerCase();
const dev='xssrfshdrtdfupgqwfdw',prod='nzdweipzckfszczzqtuw';
if(!(host.includes(dev)||(host.endsWith('.pooler.supabase.com')&&user.endsWith('.'+dev)))||host.includes(prod)||user.includes(prod))throw Error('DB_PROJECT_ID_MISMATCH');
const patch=await readFile(new URL('../scripts/patch_public_payment_entry_metadata_sync.sql',import.meta.url),'utf8');
if(!patch.includes('NEW.method IS NOT DISTINCT FROM OLD.method')||!patch.includes('CREATE TRIGGER trg_sync_sport_payment_entry_metadata'))throw Error('PATCH_CONTRACT_INVALID');
const client=new Client({connectionString:raw,connectionTimeoutMillis:10000,statement_timeout:30000,application_name:'sc-dev-mirror-e2e-migration'});
await client.connect();
try{
await client.query('begin');
await client.query('select pg_advisory_xact_lock(918274615)');
const before=await client.query("select coalesce(position('NEW.method IS NOT DISTINCT FROM OLD.method' in pg_get_functiondef(to_regprocedure('public.sync_sport_payment_entry_metadata()')))>0,false) ready");
if(!before.rows[0].ready){await client.query(patch);}
const after=await client.query("select coalesce(position('NEW.method IS NOT DISTINCT FROM OLD.method' in pg_get_functiondef(to_regprocedure('public.sync_sport_payment_entry_metadata()')))>0,false) ready, exists(select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname='sport_payments' and t.tgname='trg_sync_sport_payment_entry_metadata' and t.tgenabled in ('O','A')) trigger_ready");
if(!after.rows[0].ready||!after.rows[0].trigger_ready)throw Error('MIRROR_PATCH_VERIFICATION_FAILED');
await client.query('commit');
console.log(JSON.stringify({ok:true,project:dev,changed:!before.rows[0].ready,guard:true,trigger:true}));
}catch(e){try{await client.query('rollback')}catch{}throw e;}finally{await client.end()}
