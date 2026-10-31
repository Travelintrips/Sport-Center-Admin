import {decideNonmemberX904Access,NONMEMBER_ACCESS_MS} from './x904NonmemberAccessPolicy';
const confirmed=new Date('2026-10-31T01:00:00Z');
const base={verifiedNonmemberPin:true,confirmedPaymentAt:confirmed,paymentState:'confirmed' as const,currentGroup:2,now:new Date(confirmed.getTime()+1)};
describe('X904 nonmember 12-hour paid access policy',()=>{
  test('confirmed payment activates a verified suspended PIN',()=>expect(decideNonmemberX904Access(base)).toBe('activate'));
  test('exactly 12 hours after confirmation cannot remain active',()=>expect(decideNonmemberX904Access({...base,currentGroup:1,now:new Date(confirmed.getTime()+NONMEMBER_ACCESS_MS)})).toBe('suspend'));
  test('unconfirmed payment cannot open the door',()=>expect(decideNonmemberX904Access({...base,paymentState:'pending'})).toBe('correct'));
  test('refund revokes previously active access',()=>expect(decideNonmemberX904Access({...base,currentGroup:1,paymentState:'refunded'})).toBe('suspend'));
  test('unverified PIN never receives command',()=>expect(decideNonmemberX904Access({...base,verifiedNonmemberPin:false})).toBe('hold'));
  test('missing proof of confirmed payment cannot trigger action',()=>expect(decideNonmemberX904Access({...base,confirmedPaymentAt:null})).toBe('hold'));
  test('unknown machine group never receives command',()=>expect(decideNonmemberX904Access({...base,currentGroup:255})).toBe('hold'));
});
