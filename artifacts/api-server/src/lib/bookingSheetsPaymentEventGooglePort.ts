import {google} from "googleapis";
import {type PaymentEventSheetPort} from "./bookingSheetsPaymentEventWriter";

const PROD_SPREADSHEET_ID = "1ZvHAydlYhdfnDZmOCcPNKtOnj-O3-l9bY84927bYN7E";
/** DEV must never write to the production workbook, even with production credentials. */
export function paymentEventSpreadsheetId(): string {
  const environment = process.env.APP_ENV ?? process.env.NODE_ENV;
  if (environment === "production") return PROD_SPREADSHEET_ID;
  const id = process.env.GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID?.trim();
  if (!id || id === PROD_SPREADSHEET_ID) throw new Error("EVENT_DEV_SPREADSHEET_NOT_ISOLATED");
  return id;
}
const EVENT_TAB = /^PAYMENT EVENTS (?:JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER) 20\d{2}$/;
const quote = (name:string)=>`'${name.replace(/'/g,"''")}'`;
export function createPaymentEventGooglePort(): PaymentEventSheetPort {
  const TARGET_ID = paymentEventSpreadsheetId();
  const raw=process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if(!raw)throw new Error("GOOGLE_SHEETS_UNCONFIGURED");
  const credentials=JSON.parse(raw);
  if(typeof credentials.private_key==="string") credentials.private_key=credentials.private_key.replace(/\\n/g,"\n");
  const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
  const sheets=google.sheets({version:"v4",auth});
  const assertTab=(name:string)=>{if(!EVENT_TAB.test(name))throw new Error("INVALID_EVENT_TAB");};
  return {
    async readHeaders(tab){
      assertTab(tab);
      const response=await sheets.spreadsheets.values.get({spreadsheetId:TARGET_ID,range:`${quote(tab)}!A1:J1`,valueRenderOption:"FORMATTED_VALUE"});
      return (response.data.values?.[0]??[]).map(String);
    },
    async findSourceKeyAcrossEventTabs(key){
      const meta=await sheets.spreadsheets.get({spreadsheetId:TARGET_ID,fields:"sheets(properties(title))"});
      const tabs=(meta.data.sheets??[]).map(s=>s.properties?.title).filter((s):s is string=>!!s && EVENT_TAB.test(s));
      const results: Array<{tab:string;row:number}>=[];
      for(const tab of tabs){
        const response=await sheets.spreadsheets.values.get({spreadsheetId:TARGET_ID,range:`${quote(tab)}!A:A`,valueRenderOption:"FORMATTED_VALUE"});
        (response.data.values??[]).forEach((r,i)=>{if(String(r[0]??"").trim()===key)results.push({tab,row:i+1});});
      }
      return results;
    },
    async append(tab,values){
      assertTab(tab);
      const response=await sheets.spreadsheets.values.append({spreadsheetId:TARGET_ID,range:`${quote(tab)}!A:J`,valueInputOption:"RAW",insertDataOption:"INSERT_ROWS",requestBody:{values:[values]}});
      const range=response.data.updates?.updatedRange??"";
      const match=range.match(/![A-Z]+(\d+):/);
      if(!match)throw new Error("APPEND_ROW_UNKNOWN");
      return {row:Number(match[1])};
    },
    async readRow(tab,row){
      assertTab(tab);
      if(!Number.isSafeInteger(row)||row<2)throw new Error("ROW_INVALID");
      const response=await sheets.spreadsheets.values.get({spreadsheetId:TARGET_ID,range:`${quote(tab)}!A${row}:J${row}`,valueRenderOption:"UNFORMATTED_VALUE"});
      return (response.data.values?.[0]??[]).map(String);
    },
  };
}
