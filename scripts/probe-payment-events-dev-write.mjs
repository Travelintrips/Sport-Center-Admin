/** Explicit DEV-only synthetic append/replay probe. Not a booking/payment mutation. */
import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {google}=require('googleapis');
const DEV='1W4m_DLxlFSwUybo1cUrx4k8Mm5MSm69fIqwet5pD5cU';
const PROD='1ZvHAydlYhdfnDZmOCcPNKtOnj-O3-l9bY84927bYN7E';
const id=process.env.GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID;
if(id!==DEV||id===PROD||process.env.APP_ENV!=='development'||process.env.NODE_ENV!=='development'||process.env.SHEETS_PAYMENT_EVENTS_ENABLED!=='false') throw Error('DEV_ISOLATION_FAILED');
const credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??'{}');
if(credentials.type!=='service_account'||!credentials.private_key)throw Error('NO_DEV_SA');
credentials.private_key=credentials.private_key.replace(/\\n/g,'\n');
const auth=new google.auth.GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/spreadsheets']});
const sheets=google.sheets({version:'v4',auth});
const tab='PAYMENT EVENTS OKTOBER 2026';
const headers=['Source Key','Source Type','Booking ID','Payment ID','Allocation ID','Company Invoice ID','Membership Payment ID','Payment Date WIB','Amount IDR','Validation Status'];
const key='payment:990028001:booking:990028001';
const row=[key,'direct','990028001','990028001','','','','2026-10-28','1000','CANDIDATE'];
const quote="'"+tab+"'";
const meta=await sheets.spreadsheets.get({spreadsheetId:id,fields:'spreadsheetId,sheets(properties(title))'});
if(meta.data.spreadsheetId!==id||!meta.data.sheets?.some(x=>x.properties?.title===tab))throw Error('DEV_EVENT_TAB_MISSING');
const h=await sheets.spreadsheets.values.get({spreadsheetId:id,range:quote+'!A1:J1'});
if(JSON.stringify(h.data.values?.[0])!==JSON.stringify(headers)) throw Error('HEADER_MISMATCH');
console.log('HEADERS_PASS_10');
async function matching(){const r=await sheets.spreadsheets.values.get({spreadsheetId:id,range:quote+'!A:A'});return (r.data.values??[]).flatMap((v,i)=>String(v?.[0]??'')===key?[i+1]:[]);}
let before=await matching();
if(before.length>1)throw Error('DUPLICATE_PREEXISTS');
if(before.length===0){
const r=await sheets.spreadsheets.values.append({spreadsheetId:id,range:quote+'!A:J',valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:[row]}});
console.log('SYNTHETIC_APPEND',r.data.updates?.updatedRange??'unknown');
}else console.log('SYNTHETIC_ALREADY_PRESENT',before[0]);
const first=await matching();if(first.length!==1)throw Error('FIRST_WRITE_NOT_EXACTLY_ONE');
const res=await sheets.spreadsheets.values.get({spreadsheetId:id,range:quote+'!A'+first[0]+':J'+first[0],valueRenderOption:'FORMATTED_VALUE'});
const actual=(res.data.values?.[0]??[]).map(String);
if(actual.length!==10||actual.some((v,i)=>v!==row[i]))throw Error('READBACK_MISMATCH');
console.log('READBACK_PASS',first[0]);
const replay=await matching();
if(replay.length!==1)throw Error('REPLAY_LOOKUP_FAILED');
// Same source_key replay: existing row intentionally short-circuits append.
console.log('REPLAY_SKIPPED_ALREADY_PRESENT',replay[0]);
const after=await matching();
if(after.length!==1)throw Error('DUPLICATE_AFTER_REPLAY');
console.log(JSON.stringify({ok:true,mode:'DEV_SYNTHETIC_ONLY',tab,sourceKey:key,matchingRows:after.length,appendOnReplay:0,headerCount:10}));
