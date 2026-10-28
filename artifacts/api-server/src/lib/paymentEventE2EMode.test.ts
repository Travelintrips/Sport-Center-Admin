import {describe,expect,it} from '@jest/globals';
import {isIsolatedPaymentEventE2E} from './paymentEventE2EMode';
const base={SPORT_CENTER_E2E_PAYMENT_EVENTS:'true',NODE_ENV:'development',APP_ENV:'development',SHEETS_PAYMENT_EVENTS_ENABLED:'true',SUPABASE_DATABASE_URL_DEV:'postgresql://postgres.xssrfshdrtdfupgqwfdw:dummy@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID:'1W4m_DLxlFSwUybo1cUrx4k8Mm5MSm69fIqwet5pD5cU'};
describe('isolated payment event startup',()=>{
it('normal mode unaffected',()=>expect(isIsolatedPaymentEventE2E({})).toBe(false));
it('accepts DEV pooler only',()=>expect(isIsolatedPaymentEventE2E(base)).toBe(true));
it('rejects production environment',()=>expect(()=>isIsolatedPaymentEventE2E({...base,NODE_ENV:'production'})).toThrow());
it('rejects PROD database',()=>expect(()=>isIsolatedPaymentEventE2E({...base,SUPABASE_DATABASE_URL_DEV:base.SUPABASE_DATABASE_URL_DEV.replace('xssrfshdrtdfupgqwfdw','nzdweipzckfszczzqtuw')})).toThrow());
it('rejects production integration URL',()=>expect(()=>isIsolatedPaymentEventE2E({...base,BIZPORTAL_API_URL:'https://bizportal.cstlogistic.co.id'})).toThrow());
it('rejects wrong workbook',()=>expect(()=>isIsolatedPaymentEventE2E({...base,GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID:'wrong'})).toThrow());
it('requires payment event worker',()=>expect(()=>isIsolatedPaymentEventE2E({...base,SHEETS_PAYMENT_EVENTS_ENABLED:'false'})).toThrow());
});
