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
