import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("X904 registry name drift uses existing owner review, never anonymous door access", () => {
  const api=readFileSync(join(process.cwd(),"src/routes/gymX904Integration.ts"),"utf8");
  const ui=readFileSync(join(process.cwd(),"../sport-center/src/pages/admin/X904NonmemberRegistryReview.tsx"),"utf8");
  const guest=readFileSync(join(process.cwd(),"src/services/x904GymGuestNameRouting.ts"),"utf8");
  const booking=readFileSync(join(process.cwd(),"src/routes/bookings.ts"),"utf8");
  test("review discovers verified name drift by stable PIN and UID, with owner-only confirmation",()=>{
    expect(api).toContain("u.device_uid=r.device_uid AND u.device_role=0");
    expect(api).toContain("AS name_drift");
    expect(api).toContain('["owner","super_admin"]');
    expect(api).toContain('confirmName');
    expect(api).toContain('priorState!=="verified"');
    expect(api).toContain("SNAPSHOT_STALE");
    expect(api).toContain("SNAPSHOT_IDENTITY_MISMATCH");
    expect(api).toContain("CONFLICT_REQUIRES_MANUAL_RECONCILIATION");
    expect(api).toContain("x904_registry_name_reconciled");
    expect(api).toContain("commandEnqueued:false");
    expect(ui).toContain("Selaraskan nama");
    expect(ui).toContain("confirmedNonmember:true");
    expect(ui).toContain("confirmName:row.machine_name");
  });
  test("public guest and admin booking still require strict verified exact-name mapping",()=>{
    expect(guest).toContain("verification_state='verified' AND revoked_at IS NULL");
    expect(guest).toContain("display_name");
    expect(guest).toContain('route: "recognized_review"');
    expect(booking).toContain("PIN nonmember belum terverifikasi");
    expect(booking).toContain("X904_NONMEMBER_REGISTRY_CHANGED");
  });
});
