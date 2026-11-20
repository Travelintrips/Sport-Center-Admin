import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "..");
const admin = readFileSync(resolve(root, "sport-center/src/pages/admin/Bookings.tsx"), "utf8");
const waAdmin = readFileSync(resolve(root, "sport-center/src/pages/admin/WaBookings.tsx"), "utf8");
const lifecycle = readFileSync(resolve(process.cwd(), "src/lib/bookingLifecycle.ts"), "utf8");
const vis = readFileSync(resolve(process.cwd(), "src/services/x904GymVisitorCardReservations.ts"), "utf8");
const recovery = readFileSync(resolve(process.cwd(), "src/services/x904PaidGymPostEnrollmentRecovery.ts"), "utf8");
const worker = readFileSync(resolve(process.cwd(), "src/services/x904NonmemberDailyAccessWorker.ts"), "utf8");

describe("Gym four-path closure — protect existing payment, PIN/VIS and attendance rules", () => {
  test("paid public VIS-to-PIN post-enrollment recovery is opt-in and reuses one booking/payment", () => {
    expect(recovery).toContain('GYM_X904_POST_ENROLLMENT_RECOVERY_ENABLED');
    expect(recovery).toContain("FINAL_PAYMENT_APPROVED");
    expect(recovery).toContain("sport_center.x904_verified_nonmember_identities");
    expect(recovery).toContain("sport_center.gym_x904_access_snapshots");
    expect(recovery).toContain("NOT EXISTS (SELECT 1 FROM sport_center.gym_vis_card_reservations");
    expect(recovery).toContain("NOT EXISTS (SELECT 1 FROM sport_center.x904_nonmember_daily_access");
    expect(recovery).not.toContain("INSERT INTO sport_center.sport_payments");
    expect(recovery).not.toContain("INSERT INTO sport_center.sport_bookings");
    expect(recovery).not.toContain("INSERT INTO sport_center.x904_user_commands");
    expect(worker).toContain("recoverPaidGymPostEnrollment(store, now, actor)");
  });
  test("completed without verified check-in never masquerades as presence", () => {
    expect(admin).toContain('if (booking.status === "completed")');
    expect(admin).toContain("if (!booking.checkedInAt)");
    expect(admin).toContain("Selesai tanpa check-in");
    expect(admin).toContain("bukan bukti scan X904 atau kehadiran");
    expect(lifecycle).toContain("Selesai administratif tanpa check-in (bukan bukti kehadiran)");
    expect(lifecycle).toContain('checkedInAtUntouched: true');
  });
  test("reserved VIS can enter the existing physical-return path after booking closure", () => {
    expect(waAdmin).toContain('detail.visCardReservation?.state === "reserved" &&');
    for (const status of ["completed", "cancelled", "refunded", "expired", "rejected"]) {
      expect(waAdmin).toContain(status);
    }
    expect(waAdmin).toContain("Kartu fisik sudah benar-benar kembali ke petugas.");
    expect(waAdmin).toContain("visReadbackChecked");
    expect(vis).toContain('row.state === "reserved" && !row.collected_at && row.reserved_at');
    expect(vis).toContain("vis_suspend_proof_missing");
    expect(vis).toContain("x904_readback_missing");
    expect(vis).toContain("return_verification_required");
  });
  test("no silent card release or artificial scan/ACK is added", () => {
    expect(waAdmin).not.toContain("forceReturnVis");
    expect(recovery).not.toContain("UPDATE sport_center.gym_vis_card_reservations");
    expect(recovery).not.toContain("checked_in_at");
    expect(admin).not.toContain("checkedInAt: new Date()");
  });
});
