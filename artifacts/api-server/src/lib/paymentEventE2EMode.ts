export function isIsolatedPaymentEventE2E(env:NodeJS.ProcessEnv = process.env):boolean {
  if(env.SPORT_CENTER_E2E_PAYMENT_EVENTS !== 'true')return false;
  if(env.NODE_ENV !== 'development'||env.APP_ENV !== 'development') throw Error('E2E_DEV_ENV_REQUIRED');
  if(env.SHEETS_PAYMENT_EVENTS_ENABLED !== 'true') throw Error('E2E_EVENT_WORKER_REQUIRED');
  if(env.SHEETS_BOOKING_AUTO_ENABLED === 'true') throw Error('E2E_LEGACY_SHEETS_WORKER_FORBIDDEN');
  if(env.ALLOW_DEV_ON_PROD_DB === 'true') throw Error('E2E_PROD_DB_OVERRIDE_FORBIDDEN');
  if(env.SUPABASE_DATABASE_URL||env.BIZPORTAL_DATABASE_URL||env.BIZPORTAL_API_URL)throw Error('E2E_PRODUCTION_INTEGRATIONS_FORBIDDEN');
  const raw=env.SUPABASE_DATABASE_URL_DEV;
  if(!raw)throw Error('E2E_DEV_DB_REQUIRED');
  const url=new URL(raw);
  const host=url.hostname.toLowerCase(),user=decodeURIComponent(url.username).toLowerCase();
  const dev='xssrfshdrtdfupgqwfdw',prod='nzdweipzckfszczzqtuw';
  if(!(host.includes(dev)||(host.endsWith('.pooler.supabase.com')&&user.endsWith('.'+dev)))||host.includes(prod)||user.includes(prod))throw Error('E2E_DB_TARGET_MISMATCH');
  if(env.GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID!=='1W4m_DLxlFSwUybo1cUrx4k8Mm5MSm69fIqwet5pD5cU')throw Error('E2E_DEV_SHEET_REQUIRED');
  return true;
}
