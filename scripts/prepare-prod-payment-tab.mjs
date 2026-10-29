import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {google}=require('googleapis');
const id='1ZvHAydlYhdfnDZmOCcPNKtOnj-O3-l9bY84927bYN7E';
const tab='PAYMENT EVENTS OKTOBER 2026';
const headers=['Source Key','Source Type','Booking ID','Payment ID','Allocation ID','Company Invoice ID','Membership Payment ID','Payment Date WIB','Amount IDR','Validation Status'];
if(process.env.SHEETS_PAYMENT_EVENTS_ENABLED!=='false'||process.env.PREPARE_PROD_PAYMENT_TAB!=='true')throw Error('PREPARE_NOT_AUTHORIZED');
const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if(!raw)throw Error('MISSING_SA');
const creds=JSON.parse(raw);creds.private_key=creds.private_key?.replace(/\\n/g,'\n');
const auth=new google.auth.GoogleAuth({credentials:creds,scopes:['https://www.googleapis.com/auth/spreadsheets']});
const api=google.sheets({version:'v4',auth});
let meta=await api.spreadsheets.get({spreadsheetId:id,fields:'sheets(properties(title))'});
if(!(meta.data.sheets||[]).some(s=>s.properties?.title===tab)){
 await api.spreadsheets.batchUpdate({spreadsheetId:id,requestBody:{requests:[{addSheet:{properties:{title:tab}}}]}});
}
const range=`'${tab}'!A1:J1`;
const data=await api.spreadsheets.values.get({spreadsheetId:id,range,valueRenderOption:'FORMULA'});
const existing=data.data.values?.[0]||[];
if(existing.length===0){await api.spreadsheets.values.update({spreadsheetId:id,range,valueInputOption:'RAW',requestBody:{values:[headers]}});}
else if(!headers.every((h,i)=>existing[i]===h))throw Error('EXISTING_HEADER_CONFLICT');
const verified=(await api.spreadsheets.values.get({spreadsheetId:id,range})).data.values?.[0]||[];
if(!headers.every((h,i)=>verified[i]===h))throw Error('HEADER_VERIFICATION_FAILED');
console.log(JSON.stringify({ready:true,tab,headers:verified.length,onlyHeaderChanged:true}));
