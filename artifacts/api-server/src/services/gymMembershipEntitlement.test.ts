import {resolveGymRenewalStart,resolvePaidX904Automation,isWithinGymGracePeriod} from './gymMembershipEntitlement';

describe('all-member Gym renewal and X904 safeguards',()=>{
  test.each([
    ['early renewal','active','2026-10-30','2026-10-26','2026-10-31'],
    ['last paid day','active','2026-10-30','2026-10-30','2026-10-31'],
    ['grace day 7','active','2026-10-30','2026-11-06','2026-10-31'],
    ['grace day 8','active','2026-10-30','2026-11-07','2026-11-07'],
    ['end of month','active','2026-01-31','2026-01-28','2026-02-01'],
    ['end of year','active','2026-12-31','2026-12-27','2027-01-01'],
  ])('%s starts at %s expiry %s checked %s',(_name,status,end,today,expected)=>{
    expect(resolveGymRenewalStart(status,end,today)).toBe(expected);
  });
  test('seven-day grace is inclusive, day eight is not',()=>{
    expect(isWithinGymGracePeriod('2026-10-30','2026-11-06')).toBe(true);
    expect(isWithinGymGracePeriod('2026-10-30','2026-11-07')).toBe(false);
  });
  const paid={id:1,periodStart:'2026-10-01',periodEnd:'2026-10-30',status:'confirmed',amount:300000};
  const input={today:'2026-10-30',membershipStart:'2026-10-31',membershipEnd:'2026-11-30',membershipStatus:'active',payments:[paid],paymentSourcesComplete:true};
  test('already confirmed period remains active after membership row advanced',()=>{
    expect(resolvePaidX904Automation(input)).toBe('active');
  });
  test('pending future renewal never overrides an existing paid period',()=>{
    expect(resolvePaidX904Automation({...input,payments:[paid,{...paid,id:2,status:'pending_payment',periodStart:'2026-10-31',periodEnd:'2026-11-30'}]})).toBe('active');
  });
  test('pending only, missing proof and incomplete reconciliation fail closed',()=>{
    expect(resolvePaidX904Automation({...input,payments:[{...paid,status:'pending_payment'}]})).toBe('review_required');
    expect(resolvePaidX904Automation({...input,payments:[]})).toBe('review_required');
    expect(resolvePaidX904Automation({...input,paymentSourcesComplete:false})).toBe('review_required');
  });
  test('unpaid after grace suspends, grace cannot independently activate',()=>{
    expect(resolvePaidX904Automation({...input,today:'2026-12-08',payments:[]})).toBe('suspended');
    expect(resolvePaidX904Automation({...input,today:'2026-12-03',payments:[]})).toBe('grace_period');
  });
});
