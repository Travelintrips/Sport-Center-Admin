import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("new X904 role-0 business rule",()=>{
  const worker=readFileSync(join(process.cwd(),"src/services/x904NewOrdinaryUserDefaultSuspend.ts"),"utf8");
  const fn=readFileSync(join(process.cwd(),"migrations/20261110_x904_stage_new_nonmember_candidate_fn.sql"),"utf8");
  test("suspend deadline is at most 30 minutes from first observation",()=>{
    expect(worker).toContain("firstSeen.getTime() + 30 * 60_000");
    expect(worker).toContain("30min read-back SLA exceeded");
  });
  test("physically suspended safe role-0 enrollment becomes verified nonmember automatically",()=>{
    expect(fn).toContain("verification_state,verified_by,verified_at");
    expect(fn).toContain("'verified'");
    expect(fn).toContain("'system:auto-new-role0'");
    expect(fn).toContain("result->>'afterGroup'='2'");
    expect(fn).toContain("latest.observed_at<=c.completed_at");
    expect(fn).toContain("gym_x904_member_mapping");
    expect(fn).toContain("x904_nonmember_daily_access");
  });
});
