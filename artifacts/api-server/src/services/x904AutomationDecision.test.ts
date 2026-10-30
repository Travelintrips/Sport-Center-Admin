import {chooseX904AutomaticCommand as choose,x904MachineCommandResult as result,x904AutomaticCommandKey as key,x904PaymentConfirmedEventKey} from './x904AutomationDecision';
import {resolvePaidX904Automation,resolveGymRenewalStart} from './gymMembershipEntitlement';
const paid={id:1,periodStart:'2026-10-01',periodEnd:'2026-10-31',status:'confirmed',amount:300000};
const base={today:'2026-10-30',membershipStart:'2026-10-31',membershipEnd:'2026-11-30',membershipStatus:'active',paymentSourcesComplete:true,payments:[paid]};
describe('X904 payment -> command decision, no device I/O',()=>{
  test('1 unconfirmed payment does not activate',()=>expect(choose(resolvePaidX904Automation({...base,payments:[{...paid,status:'pending_payment'}]}),2)).toBeNull());
  test('2 confirmed payment yields one deterministic event identity for transaction upsert',()=>{expect(x904PaymentConfirmedEventKey(123)).toBe('x904-payment-confirmed-123');expect(x904PaymentConfirmedEventKey(123)).toBe(x904PaymentConfirmedEventKey(123));expect(x904PaymentConfirmedEventKey(124)).not.toBe(x904PaymentConfirmedEventKey(123));expect(()=>x904PaymentConfirmedEventKey(0)).toThrow();});
  test('3 verified paid entitlement needs reactivation only if group2',()=>expect(choose(resolvePaidX904Automation(base),2)).toBe('ACTIVATE_USER'));
  test('4 already enabled group1 never queues activation',()=>expect(choose(resolvePaidX904Automation(base),1)).toBeNull());
  test('5 suspended device group2 gets exactly the ACTIVATE_USER action',()=>expect(choose('active',2)).toBe('ACTIVATE_USER'));
  test('6 completed without readback or queued never counts as success',()=>{expect(result('completed',false)).toBe('pending');expect(result('claimed',false)).toBe('pending');expect(result('failed',false)).toBe('review_required');expect(result('completed',true)).toBe('processed');});
  test('7 early renewal retains coverage',()=>{expect(resolveGymRenewalStart('active','2026-10-30','2026-10-26')).toBe('2026-10-31');expect(resolvePaidX904Automation({...base,payments:[paid,{...paid,id:2,status:'pending_payment',periodStart:'2026-11-01',periodEnd:'2026-11-30'}]})).toBe('active');});
  test('8 identical retry has identical key, different event differs',()=>{expect(key('payment-123','ACTIVATE_USER','59')).toBe(key('payment-123','ACTIVATE_USER','59'));expect(key('payment-124','ACTIVATE_USER','59')).not.toBe(key('payment-123','ACTIVATE_USER','59'));});
});
