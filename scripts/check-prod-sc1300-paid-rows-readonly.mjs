import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {google}=require('googleapis');
if(process.env.SHEETS_PAYMENT_EVENTS_ENABLED!=='false')throw Error('READ_ONLY_GUARD_REQUIRED');
const creds=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??'{}');
creds.private_key=creds.private_key?.replace(/\\n/g,'\n');
const auth=new google.auth.GoogleAuth({credentials:creds,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
const sheets=google.sheets({version:'v4',auth});
const spreadsheetId='1ZvHAydlYhdfnDZmOCcPNKtOnj-O3-l9bY84927bYN7E';
const results=[];
for(const tab of ['PAID SEPTEMBER 26','PAID OKTOBER 2026','PAID NOVEMBER 2026']){
 const data=(await sheets.spreadsheets.values.get({spreadsheetId,range:`'${tab}'!A1:J10000`,valueRenderOption:'UNFORMATTED_VALUE'}).catch(e=> e.code===400?{data:{values:[]}}:Promise.reject(e))).data.values??[];
 for(const [i,row] of data.entries())if(['SC-1300','SC-1265'].includes(String(row[0]??'')))results.push({tab,row:i+1,orderNumber:row[0],amount:row[9],facility:row[4]});
}
console.log(JSON.stringify({found:results}));
