import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("manual X904 suspend closes an active paid nonmember entitlement",()=>{
  const route=readFileSync(join(process.cwd(),"src/routes/gymX904Integration.ts"),"utf8");
  const worker=readFileSync(join(process.cwd(),"src/services/x904NonmemberDailyAccessWorker.ts"),"utf8");
  test("manual suspend atomically expires only an active verified confirmed grant and tags accessId",()=>{
    expect(route).toContain('commandType==="SUSPEND_USER"');
    expect(route).toContain("a.verification_state='verified' AND a.access_state='active'");
    expect(route).toContain("a.activated_at IS NOT NULL AND p.status::text='confirmed'");
    expect(route).toContain('source:"MANUAL_NONMEMBER_ACCESS_CLOSE",accessId');
    expect(route).toContain("SET access_state='review_required'");
    expect(route).not.toContain("SET expires_at=LEAST(COALESCE(expires_at,now()),now())");
    expect(route).toContain('db.transaction(async tx=>');
  });
  test("paid-access worker accepts manual close ACK as entitlement suspension evidence",()=>{
    expect(worker).toContain("payload->>'source' IN ('AUTO_NONMEMBER_GYM_12H','MANUAL_NONMEMBER_ACCESS_CLOSE')");
    expect(worker).toContain('lastSource === "MANUAL_NONMEMBER_ACCESS_CLOSE"');
    expect(worker).toContain("Number((last.result as any)?.deviceUid) === Number(a.device_uid)");
    expect(worker).toContain("Number((last.result as any)?.afterGroup) === 2");
    expect(worker).toContain("SET access_state='expired'");
    expect(worker).toContain("result as any)?.deviceUid");
    expect(worker).toContain("result as any)?.afterGroup");
  });
});
