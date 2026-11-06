import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route=readFileSync(resolve(process.cwd(),"src/routes/memberships.ts"),"utf8");
const ui=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/CheckoutForm.tsx"),"utf8");

describe("staged X904 member creation safeguards",()=>{
  const endpoint=route.split('router.post("/memberships/admin-x904-create-user"')[1]
    ?.split('router.get("/memberships/admin-x904-candidates"')[0] ?? "";
  test("route requires privileged actor and separate rollout flag",()=>{
    expect(endpoint).toContain('["owner","super_admin"].includes(actor.role)');
    expect(endpoint).toContain('GYM_X904_GYM_ENROLLMENT_CREATE_ENABLED');
    expect(endpoint).toContain('GYM_X904_USER_WRITE_ENABLED');
  });
  test("PIN selection is locked, latest complete snapshot required and occupied inventory includes historical commands",()=>{
    expect(endpoint).toContain("pg_advisory_xact_lock");
    expect(endpoint).toContain("last_complete_at >= now() - interval '15 minutes'");
    expect(endpoint).toContain("last_seen_snapshot");
    expect(endpoint).toContain("gym_x904_member_mapping");
    expect(endpoint).toContain("command_type='CREATE_USER'");
  });
  test("only writes queued command, not membership or payment",()=>{
    expect(endpoint).toContain("INSERT INTO sport_center.x904_user_commands");
    expect(endpoint).not.toContain("insert(gymMembershipsTable)");
    expect(endpoint).not.toContain("insert(membershipPaymentsTable)");
    expect(endpoint).not.toContain("INSERT INTO sport_center.gym_x904_member_mapping");
  });
  test("existing paid registration still verifies device and prevents duplicate customer",()=>{
    const paid=route.split('router.post("/memberships/admin-register-paid"')[1]
      ?.split('router.post("/memberships"')[0] ?? "";
    expect(paid).toContain("x904IdentityConfirmed");
    expect(paid).toContain("machineUsers.rows.length !== 1");
    expect(paid).toContain("MEMBERSHIP_BOOKING_DUPLICATE");
    expect(paid).toContain("X904_PAYMENT_ENTITLEMENT_EVENT_NOT_PERSISTED");
  });
  test("UI requires ACK+read-back and fresh roster before enabling paid registration",()=>{
    expect(ui).toContain('command?.result?.readBackConfirmed!==true');
    expect(ui).toContain('admin-x904-candidates?q=');
    expect(ui).toContain("row.pin===newX904ReservedPin && row.name===expectedName");
    expect(ui).toContain('setMembershipX904IdentityConfirmed(false)');
    expect(ui).toContain("Daftarkan Member & Konfirmasi Pembayaran");
    expect(ui).toContain("Gunakan PIN user yang sudah ada di mesin (alur lama)");
  });
});
