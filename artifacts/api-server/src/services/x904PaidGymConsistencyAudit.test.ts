import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { auditPaidGymEntitlementConsistency } from "./x904PaidGymConsistencyAudit";

describe("Paid Gym consistency watchdog (read-only, no device commands)",()=>{
  const morning=new Date("2026-11-17T01:30:00.000Z"); // 08:30 WIB
  test("detects missing grant and held grant without making any writes or leaking identity",async()=>{
    const mockStore={execute:jest.fn().mockResolvedValue({rows:[
      {booking_id:910001,order_number:"SC-CI-910001",source:"gym_public_guest",issue:"PAID_NO_GRANT"},
      {booking_id:910002,order_number:"SC-CI-910002",source:"admin",issue:"PAID_HELD_GRANT"},
    ]})};
    const entries:string[]=[];
    expect(await auditPaidGymEntitlementConsistency(mockStore as any,morning,e=>entries.push(e))).toBe(2);
    expect(mockStore.execute).toHaveBeenCalledTimes(1);
    const sqlRendered=JSON.stringify(mockStore.execute.mock.calls[0]);
    expect(sqlRendered).toContain("sport_center.sport_bookings");
    expect(sqlRendered).toContain("sport_center.x904_nonmember_daily_access");
    expect(sqlRendered).toContain("interval '2 minutes'");
    expect(sqlRendered).toContain("b.facility_id=6");
    expect(entries).toHaveLength(2);
    expect(entries.join(" ")).toContain("PAID_NO_GRANT");
    expect(entries.join(" ")).toContain("PAID_HELD_GRANT");
    expect(entries.join(" ")).not.toMatch(/PIN:|deviceUid|customerName|proofUrl|phone/);
    // One-minute worker cycles must not spam duplicates or send device writes.
    expect(await auditPaidGymEntitlementConsistency(mockStore as any,new Date(morning.getTime()+60_000),e=>entries.push(e))).toBe(2);
    expect(entries).toHaveLength(2);
    expect("transaction" in mockStore).toBe(false);
    expect(await auditPaidGymEntitlementConsistency(mockStore as any,new Date(morning.getTime()+16*60_000),e=>entries.push(e))).toBe(2);
    expect(entries).toHaveLength(4);
  });
  test("registered VIS-to-PIN mismatch is sent to staff review, never auto-granted",async()=>{
    const store={execute:jest.fn().mockResolvedValue({rows:[
      {booking_id:919829,order_number:"SC-QA-919829",source:"gym_public_guest",issue:"PAID_VIS_TO_PIN_STAFF_REVIEW"},
    ]})};
    const entries:string[]=[];
    expect(await auditPaidGymEntitlementConsistency(store as any,morning,e=>entries.push(e))).toBe(1);
    const query=JSON.stringify(store.execute.mock.calls[0]);
    expect(query).toContain("PAID_VIS_TO_PIN_STAFF_REVIEW");
    expect(query).toContain("sport_center.x904_verified_nonmember_identities");
    expect(query).toContain("a.access_id IS NULL");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('"action":"staff_verify_registered_pin_no_grant"');
    expect(entries[0]).not.toMatch(/customerName|userPin|deviceUid|proofUrl|phone/);
    expect("transaction" in store).toBe(false);
  });
  test("existing 60-second worker runs the read-only audit after recovery",()=>{
    const source=readFileSync("src/services/x904NonmemberDailyAccessWorker.ts","utf8");
    const paidWorker=source.slice(source.indexOf("export function startX904NonmemberAccessWorker"),source.indexOf("/** Recheck a paid public"));
    expect(paidWorker).toContain("await auditPaidGymEntitlementConsistency(db).catch");
    expect(paidWorker.indexOf("await auditPaidGymEntitlementConsistency")).toBeGreaterThan(paidWorker.indexOf("await recoverUnallocatedPaidGymVis()"));
    expect(paidWorker).toContain("intervalMs: 60000");
    const recovery=source.slice(source.indexOf("export async function recoverPaidPublicGymPin"),source.indexOf("export function x904GymBookingDayClose"));
    expect(recovery).toContain("b.notes LIKE 'Gym mandiri; nama dan PIN X904 sama dengan identitas mesin terverifikasi%'");
    expect(recovery).not.toContain("b.notes LIKE 'Gym mandiri; nama cocok dengan registry X904%'");
  });
  test("outside 06:00–23:00 WIB never contacts database or triggers entry",async()=>{
    const mockStore={execute:jest.fn()};
    const entries:string[]=[];
    expect(await auditPaidGymEntitlementConsistency(mockStore as any,new Date("2026-11-16T17:30:00Z"),e=>entries.push(e))).toBe(0); // 00:30 WIB
    expect(await auditPaidGymEntitlementConsistency(mockStore as any,new Date("2026-11-17T16:01:00Z"),e=>entries.push(e))).toBe(0); // 23:01 WIB
    expect(mockStore.execute).not.toHaveBeenCalled();
    expect(entries).toHaveLength(0);
  });
});