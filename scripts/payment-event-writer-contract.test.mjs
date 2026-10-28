import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Static safety contract: no production credential or endpoint required.
const writer=readFileSync('artifacts/api-server/src/lib/bookingSheetsPaymentEventWriter.ts','utf8');
const google=readFileSync('artifacts/api-server/src/lib/bookingSheetsPaymentEventGooglePort.ts','utf8');
const validator=readFileSync('artifacts/api-server/src/lib/bookingSheetsPaymentEventContract.ts','utf8');
test('event writes cannot target booking PAID tabs',()=>{
 assert.match(writer,/PAYMENT EVENTS/);
 assert.match(google,/PAYMENT EVENTS/);
 assert.doesNotMatch(google,/values\.update\(/);
});
test('event uses source key and stable payment identifiers',()=>{
 assert.match(validator,/source_key/);
 assert.match(validator,/membership_payment:/);
 assert.match(validator,/allocation/);
 assert.match(validator,/corporate_invoice/);
});
test('ambiguous append never auto-retries',()=>{
 assert.match(writer,/AMBIGUOUS_APPEND/);
 assert.match(writer,/needs_review/);
 assert.match(writer,/findSourceKeyAcrossEventTabs/);
 assert.match(writer,/readRow\(tab,row\)/);
});

test('duplicate scan never truncates sheet at row 100000',()=>{
 assert.match(google,/\!A:A/);
 assert.doesNotMatch(google,/A1:A100000/);
});
test('DEV event Sheet cannot use hardcoded production workbook',()=>{
 assert.match(google,/EVENT_DEV_SPREADSHEET_NOT_ISOLATED/);
 assert.match(google,/GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID/);
 assert.match(google,/id === PROD_SPREADSHEET_ID/);
});

test('production workbook requires explicit dual environment confirmation',()=>{
 assert.match(google,/appProduction !== nodeProduction/);
 assert.match(google,/EVENT_ENVIRONMENT_MISMATCH/);
});

// Execute the DEV probe in a fresh process. It must reject unsafe contexts
// before loading the Google library or attempting any network request.
import {spawnSync} from 'node:child_process';
const devId='1W4m_DLxlFSwUybo1cUrx4k8Mm5MSm69fIqwet5pD5cU';
const prodId='1ZvHAydlYhdfnDZmOCcPNKtOnj-O3-l9bY84927bYN7E';
function probe(env){
 return spawnSync(process.execPath,['scripts/check-payment-events-dev-sheet.mjs'],{
   env:{PATH:process.env.PATH,...env},encoding:'utf8',timeout:10000,
 });
}
test('DEV probe rejects production environment before touching network',()=>{
 const result=probe({APP_ENV:'production',NODE_ENV:'production',GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID:devId});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/PROD_CONTEXT_FORBIDDEN/);
});
test('DEV probe rejects production spreadsheet target',()=>{
 const result=probe({APP_ENV:'development',NODE_ENV:'development',GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID:prodId});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/DEV_SHEET_ID_MISMATCH/);
});
test('DEV probe fails closed without configured Google credentials',()=>{
 const result=probe({APP_ENV:'development',NODE_ENV:'development',GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID:devId});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/SERVICE_ACCOUNT_UNAVAILABLE/);
});
