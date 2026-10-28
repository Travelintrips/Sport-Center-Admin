/** Read-only Google Sheets API probe. No spreadsheet mutation or key logging.
 * Run only with a trusted DEV service-account environment. */
import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {google}=require('googleapis');
const target='1W4m_DLxlFSwUybo1cUrx4k8Mm5MSm69fIqwet5pD5cU';
const prod='1ZvHAydlYhdfnDZmOCcPNKtOnj-O3-l9bY84927bYN7E';
const id=process.env.GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID;
if(id!==target||id===prod)throw Error('DEV_SHEET_ID_MISMATCH');
if(process.env.APP_ENV==='production'||process.env.NODE_ENV==='production')throw Error('PROD_CONTEXT_FORBIDDEN');
const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if(!raw)throw Error('SERVICE_ACCOUNT_UNAVAILABLE');
const credentials=JSON.parse(raw);
if(credentials.type!=='service_account'||!credentials.private_key||!credentials.client_email)throw Error('INVALID_SERVICE_ACCOUNT');
credentials.private_key=credentials.private_key.replace(/\\n/g,'\n');
const auth=new google.auth.GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
const sheets=google.sheets({version:'v4',auth});
const res=await sheets.spreadsheets.get({spreadsheetId:id,fields:'spreadsheetId,sheets(properties(title))'});
if(res.data.spreadsheetId!==id)throw Error('SPREADSHEET_MISMATCH');
const tabs=(res.data.sheets??[]).map(s=>s.properties?.title).filter(Boolean);
console.log(JSON.stringify({ok:true,environment:'DEV',spreadsheetId:id,tabs}));
