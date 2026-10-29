import {describe,expect,it} from "@jest/globals";
import {resolvePaidX904Automation} from "./gymMembershipEntitlement";

const base={
  today:"2026-10-29",membershipStart:"2026-10-01",
  membershipEnd:"2026-10-31",membershipStatus:"active",
  paymentSourcesComplete:true,payments:[] as Array<{id:number;periodStart:string;periodEnd:string;status:string;amount:number}>
};
describe("X904 paid automation is fail-closed",()=>{
  it("never activates on membership dates alone",()=>expect(resolvePaidX904Automation(base)).toBe("review_required"));
  it("activates with confirmed paid coverage",()=>expect(resolvePaidX904Automation({...base,payments:[{id:1,periodStart:"2026-10-01",periodEnd:"2026-10-31",status:"confirmed",amount:300000}]})).toBe("active"));
  it("never activates on unconfirmed payment",()=>expect(resolvePaidX904Automation({...base,payments:[{id:1,periodStart:"2026-10-01",periodEnd:"2026-10-31",status:"waiting_confirmation",amount:300000}]})).toBe("review_required"));
  it("preserves seven-day grace without granting new activation",()=>expect(resolvePaidX904Automation({...base,today:"2026-11-07"})).toBe("grace_period"));
  it("suspends only after grace ends",()=>expect(resolvePaidX904Automation({...base,today:"2026-11-08"})).toBe("suspended"));
  it("holds incomplete payment sources",()=>expect(resolvePaidX904Automation({...base,paymentSourcesComplete:false})).toBe("review_required"));
});
