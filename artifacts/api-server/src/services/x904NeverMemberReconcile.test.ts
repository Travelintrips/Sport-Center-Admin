import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/services/x904NonmemberDailyAccessWorker.ts"), "utf8");
const reconcile = source.split('if (process.env.GYM_X904_NONMEMBER_LEGACY_RECONCILE_ENABLED === "true")')[1]?.split("  const due =")[0] ?? "";

describe("X904 legacy PIN reconciliation safety contract", () => {
  test("opt-in flag and bounded batch", () => {
    expect(reconcile).toContain("if (queued >= 10) break");
    expect(source).toContain('GYM_X904_NONMEMBER_LEGACY_RECONCILE_ENABLED === "true"');
  });
  test("fresh complete device inventory and verified UID", () => {
    expect(reconcile).toContain("FRESH_SNAPSHOT_MS");
    expect(reconcile).toContain("users.length !== Number(snap.user_count)");
    expect(reconcile).toContain("device_uid");
    expect(reconcile).toContain("upper(trim(display_name))=upper(");
    expect(reconcile).not.toContain("last_seen_snapshot=");
  });
  test("exclude membership history, mapping, grants and pending commands", () => {
    for (const guard of [
      "gym_x904_member_mapping", "sport_memberships_sync",
      "sport_memberships", "x904_nonmember_daily_access",
      "state IN ('queued','claimed')", "p.current_member",
      "p.former_member", "p.has_grant", "p.mapped", "p.in_flight",
    ]) expect(reconcile).toContain(guard);
  });
  test("exclude special PINs, roles and non-group-1 users", () => {
    expect(reconcile).toContain("isX904AutoSuspendExempt(pin, 0)");
    expect(reconcile).toContain("Number(u.role) !== 0");
    expect(reconcile).toContain("Number(u.group) !== 1");
    expect(reconcile).toContain("u.enabled !== true");
  });
  test("only enqueue via VMSC with expected UID and idempotency", () => {
    expect(reconcile).toContain('"SUSPEND_USER"');
    expect(reconcile).toContain("expectedUid: uid, expectedName: name");
    expect(reconcile).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
    expect(reconcile).not.toContain("UPDATE sport_center.gym_x904_access_snapshots");
  });
});
