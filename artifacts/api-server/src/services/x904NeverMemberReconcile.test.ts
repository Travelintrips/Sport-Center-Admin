import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/services/x904NonmemberDailyAccessWorker.ts"), "utf8");

describe("X904 shared verified paid-grant access safety contract", () => {
  test("never suspends legacy PINs merely for absent membership history", () => {
    expect(source).not.toContain("AUTO_NONMEMBER_LEGACY_RECONCILIATION");
    expect(source).not.toContain("NO_MEMBERSHIP_HISTORY_NO_PAID_GRANT");
    expect(source).not.toContain('GYM_X904_NONMEMBER_LEGACY_RECONCILE_ENABLED === "true"');
  });
  test("both card and ordinary PIN grants require verification and payment", () => {
    expect(source).toContain("a.verification_state='verified'");
    expect(source).toContain("a.identity_type IN ('card','pin')");
    expect(source).toContain('a.payment_status === "confirmed"');
  });
  test("protect membership owners and exempt PINs", () => {
    expect(source).toContain("gym_x904_member_mapping");
    expect(source).toContain("isX904AutoSuspendExempt(pin, 0)");
  });
  test("requires fresh complete device inventory and UID attestation", () => {
    expect(source).toContain("FRESH_SNAPSHOT_MS");
    expect(source).toContain("users.length !== Number(snap.user_count)");
    expect(source).toContain("ackUid !== Number(a.device_uid)");
  });
  test("uses existing VMSC ACK path for activation and expiry", () => {
    expect(source).toContain('"ACTIVATE_USER"');
    expect(source).toContain('"SUSPEND_USER"');
    expect(source).toContain("readBackConfirmed");
    expect(source).toContain("interval '12 hours'");
  });
});
