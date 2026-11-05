import {decideNonmemberX904Access,NONMEMBER_ACCESS_MS,resolveX904NonmemberCard,x904NonmemberOpeningHours,x904NonmemberEffectiveExpiry} from './x904NonmemberAccessPolicy';
const confirmed=new Date('2026-10-31T01:00:00Z');
const base={verifiedNonmemberPin:true,userPin:'500',deviceRole:0,confirmedPaymentAt:confirmed,paymentState:'confirmed' as const,currentGroup:2,now:new Date(confirmed.getTime()+1)};
describe('X904 nonmember 12-hour paid access policy',()=>{
  test('confirmed payment activates a verified suspended PIN',()=>expect(decideNonmemberX904Access(base)).toBe('activate'));
  test('exactly 12 hours after confirmation cannot remain active',()=>expect(decideNonmemberX904Access({...base,currentGroup:1,now:new Date(confirmed.getTime()+NONMEMBER_ACCESS_MS)})).toBe('suspend'));
  test('unconfirmed payment cannot open the door',()=>expect(decideNonmemberX904Access({...base,paymentState:'pending'})).toBe('correct'));
  test('refund revokes previously active access',()=>expect(decideNonmemberX904Access({...base,currentGroup:1,paymentState:'refunded'})).toBe('suspend'));
  test('unverified PIN never receives command',()=>expect(decideNonmemberX904Access({...base,verifiedNonmemberPin:false})).toBe('hold'));
  test('missing proof of confirmed payment cannot trigger action',()=>expect(decideNonmemberX904Access({...base,confirmedPaymentAt:null})).toBe('hold'));
  test.each(['237','79','12'])('protected PIN %s is exempt from auto-suspend only',userPin=>{
    expect(decideNonmemberX904Access({...base,userPin,currentGroup:1,now:new Date(confirmed.getTime()+NONMEMBER_ACCESS_MS)})).toBe('hold');
    expect(decideNonmemberX904Access({...base,userPin,currentGroup:2})).toBe('activate');
  });
  test('role 14 is exempt from auto-suspend but paid activation is still allowed',()=>{
    expect(decideNonmemberX904Access({...base,deviceRole:14,currentGroup:1,now:new Date(confirmed.getTime()+NONMEMBER_ACCESS_MS)})).toBe('hold');
    expect(decideNonmemberX904Access({...base,deviceRole:14})).toBe('activate');
  });
  test('unknown machine group never receives command',()=>expect(decideNonmemberX904Access({...base,currentGroup:255})).toBe('hold'));
  test.each([
    ['VIS001','78',338],['VIS002','90',339],['VIS003','13',13],
    ['VIS004','17',17],['VIS005','11',11],['VIS006','15',15],
  ])('%s resolves to the inventoried machine identity', (alias,pin,uid)=>{
    expect(resolveX904NonmemberCard(alias)).toMatchObject({userPin:pin,deviceUid:uid});
  });
  test('unknown card alias is rejected',()=>expect(resolveX904NonmemberCard('VIS007')).toBeNull());
});

describe('X904 nonmember fixed Sport Center hours (Asia/Jakarta)', () => {
  const instant = (local: string) => new Date(local + '+07:00');

  test('06:00 WIB opens; 05:59 and exactly 23:00 WIB are closed', () => {
    expect(x904NonmemberOpeningHours(instant('2026-11-06T05:59:59'))).toBe(false);
    expect(x904NonmemberOpeningHours(instant('2026-11-06T06:00:00'))).toBe(true);
    expect(x904NonmemberOpeningHours(instant('2026-11-06T22:59:59'))).toBe(true);
    expect(x904NonmemberOpeningHours(instant('2026-11-06T23:00:00'))).toBe(false);
  });

  test.each([
    ['06:00:00', '18:00:00'],
    ['10:00:00', '22:00:00'],
    ['18:30:00', '23:00:00'],
    ['22:59:00', '23:00:00'],
  ])('activation at %s ends at %s WIB', (startTime, endTime) => {
    expect(x904NonmemberEffectiveExpiry(instant('2026-11-06T' + startTime))?.toISOString())
      .toBe(instant('2026-11-06T' + endTime).toISOString());
  });

  test('an earlier stored expiry stays authoritative', () => {
    expect(x904NonmemberEffectiveExpiry(
      instant('2026-11-06T09:00:00'),
      instant('2026-11-06T13:00:00'),
    )?.toISOString()).toBe(instant('2026-11-06T13:00:00').toISOString());
  });

  test('23:00 cutoff suspends even when fewer than twelve hours elapsed', () => {
    const confirmedAt = instant('2026-11-05T18:23:46');
    expect(decideNonmemberX904Access({
      ...base, confirmedPaymentAt: confirmedAt, currentGroup: 1,
      now: instant('2026-11-05T22:59:59'),
    })).toBe('correct');
    expect(decideNonmemberX904Access({
      ...base, confirmedPaymentAt: confirmedAt, currentGroup: 1,
      now: instant('2026-11-05T23:00:00'),
    })).toBe('suspend');
    expect(decideNonmemberX904Access({
      ...base, confirmedPaymentAt: confirmedAt, currentGroup: 1,
      now: instant('2026-11-06T06:00:00'),
    })).toBe('suspend');
    expect(decideNonmemberX904Access({
      ...base, confirmedPaymentAt: confirmedAt, currentGroup: 2,
      now: instant('2026-11-06T06:00:00'),
    })).toBe('correct');
  });

  test('opening-hours rule does not suspend protected PINs or role 14', () => {
    for (const userPin of ['237', '79', '12']) {
      expect(decideNonmemberX904Access({
        ...base, confirmedPaymentAt: instant('2026-11-05T18:00:00'),
        userPin, currentGroup: 1, now: instant('2026-11-05T23:00:00'),
      })).toBe('hold');
    }
    expect(decideNonmemberX904Access({
      ...base, confirmedPaymentAt: instant('2026-11-05T18:00:00'),
      deviceRole: 14, currentGroup: 1, now: instant('2026-11-05T23:00:00'),
    })).toBe('hold');
  });
});
