import {describe,expect,it} from '@jest/globals';
import {writeClaimedPaymentEvent, type PaymentEventSheetPort} from './bookingSheetsPaymentEventWriter';
import {PAYMENT_EVENT_HEADERS,type PaymentEventCandidate} from './bookingSheetsPaymentEventContract';
const sample:PaymentEventCandidate={source_key:'membership_payment:42',source_type:'membership',booking_id:null,payment_id:null,allocation_id:null,company_invoice_id:null,membership_payment_id:42,payment_date_wib:'2026-10-28',amount:'150000.00',validation_status:'CANDIDATE'};
const tab='PAYMENT EVENTS OKTOBER 2026';
function fake(overrides:Partial<PaymentEventSheetPort>={}):PaymentEventSheetPort{
 return {readHeaders:async()=>[...PAYMENT_EVENT_HEADERS],findSourceKeyAcrossEventTabs:async()=>[],append:async()=>({row:2}),readRow:async()=>['membership_payment:42','membership','','','','','42','2026-10-28','150000.00','CANDIDATE'],...overrides};
}
describe('payment event append fail closed',()=>{
 it('accepts only a verified separate event row',async()=>expect(await writeClaimedPaymentEvent(sample,tab,fake())).toEqual({status:'written',tab,row:2}));
 it('rejects duplicate source key across tabs',async()=>expect(await writeClaimedPaymentEvent(sample,tab,fake({findSourceKeyAcrossEventTabs:async()=>[{tab,row:2}]}))).toEqual({status:'needs_review',reason:'ALREADY_PRESENT'}));
 it('does not write when header differs',async()=>expect(await writeClaimedPaymentEvent(sample,tab,fake({readHeaders:async()=>['wrong']}))).toEqual({status:'needs_review',reason:'HEADER_MISMATCH'}));
 it('requires manual reconciliation after ambiguous append',async()=>expect(await writeClaimedPaymentEvent(sample,tab,fake({append:async()=>{throw Error('timeout');}}))).toEqual({status:'needs_review',reason:'AMBIGUOUS_APPEND'}));
 it('requires exact row verification',async()=>expect(await writeClaimedPaymentEvent(sample,tab,fake({readRow:async()=>['wrong']}))).toEqual({status:'needs_review',reason:'VERIFY_FAILED'}));
 it('rejects old booking tab names',async()=>expect(writeClaimedPaymentEvent(sample,'PAID OKTOBER 2026',fake())).rejects.toThrow('EVENT_TAB_INVALID'));
});

describe('source integrity',()=>{
 it('rejects invalid corporate item IDs',async()=>{
  const bad:PaymentEventCandidate={...sample,source_type:'corporate_invoice',source_key:'invoice:10:item:abc:booking:20',booking_id:20,company_invoice_id:10,membership_payment_id:null};
  await expect(writeClaimedPaymentEvent(bad,tab,fake())).rejects.toThrow('EVENT_SOURCE_KEY_INVALID');
 });
 it('rejects an invalid membership amount',async()=>{
  await expect(writeClaimedPaymentEvent({...sample,amount:'150000.001'},tab,fake())).rejects.toThrow('EVENT_AMOUNT_INVALID');
 });
 it('rejects an unconfirmed source event',async()=>{
  await expect(writeClaimedPaymentEvent({...sample,validation_status:'MISSING_PAYMENT_DATE'},tab,fake())).rejects.toThrow('EVENT_NOT_VALIDATED');
 });
});

describe('date safety',()=>{
 it('rejects nonexistent calendar dates',async()=>{
  await expect(writeClaimedPaymentEvent({...sample,payment_date_wib:'2026-02-31'},tab,fake())).rejects.toThrow('EVENT_DATE_INVALID');
 });
});

describe('all supported payment source types',()=>{
 const cases:Array<{event:PaymentEventCandidate;key:string}>= [
  {event:{...sample,source_type:'direct',source_key:'payment:11:booking:22',booking_id:22,payment_id:11,membership_payment_id:null},key:'payment:11:booking:22'},
  {event:{...sample,source_type:'allocation',source_key:'payment:11:allocation:33:booking:22',booking_id:22,payment_id:11,allocation_id:33,membership_payment_id:null},key:'payment:11:allocation:33:booking:22'},
  {event:{...sample,source_type:'corporate_invoice',source_key:'invoice:44:item:55:booking:22',booking_id:22,company_invoice_id:44,membership_payment_id:null},key:'invoice:44:item:55:booking:22'},
  {event:sample,key:'membership_payment:42'},
 ];
 for(const {event,key} of cases){
  it(`writes independently keyed ${event.source_type} event`,async()=>{
   const expected=[key,event.source_type,event.booking_id,event.payment_id,event.allocation_id,event.company_invoice_id,event.membership_payment_id,event.payment_date_wib,event.amount,event.validation_status].map(v=>v==null?'':String(v));
   let calls=0;
   const port=fake({append:async(_tab,values)=>{expect(values).toEqual(expected);calls++;return {row:2};},readRow:async()=>expected});
   expect(await writeClaimedPaymentEvent(event,tab,port)).toEqual({status:'written',tab,row:2});
   expect(calls).toBe(1);
  });
 }
});

describe('Google Sheets numeric round-trip',()=>{
 it('accepts equal numeric amount without trailing decimal zeros',async()=>{
  const row=['membership_payment:42','membership','','','','','42','2026-10-28','150000','CANDIDATE'];
  expect(await writeClaimedPaymentEvent(sample,tab,fake({readRow:async()=>row}))).toEqual({status:'written',tab,row:2});
 });
 it('rejects even one-cent difference',async()=>{
  const row=['membership_payment:42','membership','','','','','42','2026-10-28','150000.01','CANDIDATE'];
  expect(await writeClaimedPaymentEvent(sample,tab,fake({readRow:async()=>row}))).toEqual({status:'needs_review',reason:'VERIFY_FAILED'});
 });
});

describe('post-append crash and timeout isolation',()=>{
 it('returns needs_review if server times out after the row was persisted; never retries the append',async()=>{
  const saved:string[][]=[];
  const row=['membership_payment:42','membership','','','','','42','2026-10-28','150000.00','CANDIDATE'];
  let appendCalls=0;
  const port=fake({
   findSourceKeyAcrossEventTabs:async()=>saved.length?[{tab,row:2}]:[],
   append:async(_t,v)=>{appendCalls++;saved.push(v);throw Error('NETWORK_TIMEOUT_AFTER_APPEND');},
   readRow:async()=>row,
  });
  expect(await writeClaimedPaymentEvent(sample,tab,port)).toEqual({status:'needs_review',reason:'AMBIGUOUS_APPEND'});
  expect(saved).toHaveLength(1);
  expect(await writeClaimedPaymentEvent(sample,tab,port)).toEqual({status:'needs_review',reason:'ALREADY_PRESENT'});
  expect(appendCalls).toBe(1);
  expect(saved).toHaveLength(1);
 });
 it('detects an existing row after worker crash between append and ledger finalization',async()=>{
  const saved:string[][]=[];
  let appendCalls=0;
  const values=['membership_payment:42','membership','','','','','42','2026-10-28','150000.00','CANDIDATE'];
  const port=fake({
   append:async(_t,v)=>{appendCalls++;saved.push(v);return {row:2};},
   readRow:async()=>values,
   findSourceKeyAcrossEventTabs:async()=>saved.length?[{tab,row:2}]:[],
  });
  expect(await writeClaimedPaymentEvent(sample,tab,port)).toEqual({status:'written',tab,row:2});
  // Simulate process crash: persisted Sheets row exists, ledger has not yet finalized.
  // Worker must not append again even if operator manually reconciles the claim.
  expect(await writeClaimedPaymentEvent(sample,tab,port)).toEqual({status:'needs_review',reason:'ALREADY_PRESENT'});
  expect(appendCalls).toBe(1);
 });
});
