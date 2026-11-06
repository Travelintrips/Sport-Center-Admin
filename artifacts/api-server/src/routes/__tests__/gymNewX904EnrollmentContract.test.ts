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
    expect(ui).toContain('admin-x904-create-user/"+encodeURIComponent(newX904CommandId)+"/readiness');
    expect(ui).toContain('readiness.accessHeld!==true');
    expect(ui).toContain('admin-x904-candidates?q=');
    expect(ui).toContain("row.pin===newX904ReservedPin && row.name===expectedName");
    expect(ui).toContain('setMembershipX904IdentityConfirmed(false)');
    expect(ui).toContain("Daftarkan Member & Konfirmasi Pembayaran");
    expect(ui).toContain("Gunakan PIN user yang sudah ada di mesin (alur lama)");
  });
});

describe("VMSC unsafe CREATE_USER fail-closed guard",()=>{
  const worker=readFileSync(resolve(process.cwd(),"../../scripts/x904-vmsc-user-command-executor.mjs"),"utf8");
  test("blocks a new paid member before opening a machine socket",()=>{
    const guard=worker.indexOf('GYM_CREATE_DENY_FIRST_NOT_READY');
    const firstDeviceCall=worker.indexOf('await zk.createSocket()');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(firstDeviceCall);
    expect(worker).toContain('payload.source==="gym_admin_new_member"');
  });
});

describe("Gym enrollment deny-first payment server protection",()=>{
  const paid=route.split('router.post("/memberships/admin-register-paid"')[1]
    ?.split('router.post("/memberships"')[0] ?? "";
  test("requires newest group-2 disabled snapshot following CREATE_USER ACK",()=>{
    expect(paid).toContain("command_type='CREATE_USER'");
    expect(paid).toContain("gym_admin_new_member");
    expect(paid).toContain("created.result?.readBackConfirmed!==true");
    expect(paid).toContain("uidFromCommand!==Number(machineUsers.rows[0].device_uid)");
    expect(paid).toContain("u->>'group'='2'");
    expect(paid).toContain("u->>'enabled'='false'");
    expect(paid).toContain("last.safe_access!==true");
  });
});

describe("VMSC protected CREATE_USER staged executor",()=>{
  const scripts=resolve(process.cwd(),"../../scripts");
  const stage=readFileSync(resolve(scripts,"x904-vmsc-gym-create-deny-first-stage.ps1"),"utf8");
  const worker=readFileSync(resolve(scripts,"run-x904-user-command-worker.ps1"),"utf8");
  const verifier=readFileSync(resolve(scripts,"x904-vmsc-gym-create-uid-readback.mjs"),"utf8");
  it("uses an explicit separate rollout flag and no legacy executor for gym enrollment",()=>{
    expect(worker).toContain("X904_GYM_DENY_FIRST_EXECUTOR_ENABLED");
    expect(worker).toContain("GYM_DENY_FIRST_EXECUTOR_DISABLED");
    expect(worker).toContain("x904-vmsc-gym-create-deny-first-stage.ps1");
    expect(worker).toContain("elseif($isGymCreate)");
  });
  it("creates disabled FIRST, then group 2, then requires readback of both",()=>{
    const combos=stage.indexOf("SSR_GetUnLockGroup");
    const create=stage.indexOf("SSR_SetUserInfo(1,$pin,$name,'',0,$false)");
    const verifyDisabled=stage.indexOf("DISABLED_READBACK_FAILED");
    const groupWrite=stage.indexOf("SetUserGroup(1,[int]$pin,2)");
    const groupReadback=stage.indexOf("GROUP2_READBACK_FAILED");
    const postGroupCheck=stage.indexOf("POST_GROUP_DISABLED_READBACK_FAILED");
    expect(combos).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(combos);
    expect(verifyDisabled).toBeGreaterThan(create);
    expect(groupWrite).toBeGreaterThan(verifyDisabled);
    expect(groupReadback).toBeGreaterThan(groupWrite);
    expect(postGroupCheck).toBeGreaterThan(groupReadback);
    expect(stage).toContain("if($SelfTest -or -not $ExecuteClaimed)");
    expect(stage).toContain("gymDenyFirstEnabled -eq $true");
    expect(stage).toContain("PIN_ALREADY_PRESENT");
  });
  it("verifies UID with read-only authenticated request and never writes X904 commands",()=>{
    expect(verifier).toContain("CMD_AUTH");
    expect(verifier).toContain("tcp.getUsers()");
    expect(verifier).not.toContain("CMD_USER_WRQ");
    expect(verifier).not.toContain("SetUserGroup");
    expect(verifier).not.toContain("SSR_SetUserInfo");
  });
});

describe("safe production default for X904 new-user UI",()=>{
  test("new PIN creation UI is pilot-gated and old existing-user picker defaults visible",()=>{
    expect(ui).toContain('import.meta.env.VITE_GYM_X904_NEW_USER_PILOT === "true"');
    expect(ui).toContain('open={import.meta.env.VITE_GYM_X904_NEW_USER_PILOT !== "true"}');
    expect(ui).toContain('Cari nama / PIN mesin X904 (alur berjalan)');
  });
});
