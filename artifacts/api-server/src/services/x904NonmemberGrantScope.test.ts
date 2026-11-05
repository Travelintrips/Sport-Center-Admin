import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("X904 verified nonmember PIN scope", () => {
  const source = readFileSync(join(process.cwd(), "src/services/x904NonmemberDailyAccessWorker.ts"), "utf8");

  test("worker startup does not depend on a VIS-only legacy allowlist", () => {
    expect(source).not.toContain("process.env.GYM_X904_NONMEMBER_ALLOWED_PINS");
    expect(source).toContain("if (!enabled || !validPin || !validActor) return;");
  });

  test("paid grants include ordinary PINs and VIS cards", () => {
    expect(source).toContain("a.identity_type IN ('card','pin')");
    expect(source).toContain("a.verification_state='verified'");
    expect(source).toContain("a.payment_id IS NOT NULL");
    expect(source).toContain('a.payment_status === "confirmed"');
  });

  test("device safety checks and scoped test PIN remain in place", () => {
    expect(source).toContain("GYM_X904_NONMEMBER_ONLY_PIN");
    expect(source).toContain("gym_x904_member_mapping");
    expect(source).toContain("isX904AutoSuspendExempt(pin, 0)");
    expect(source).toContain("FRESH_SNAPSHOT_MS");
    expect(source).toContain("readBackConfirmed");
  });
});
