import { beforeEach, afterEach, describe, expect, jest, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";

const execute = jest.fn<(query: any) => Promise<{ rows: any[] }>>();
const warn = jest.fn();
jest.unstable_mockModule("@workspace/db", () => ({ db: { execute } }));
jest.unstable_mockModule("../lib/logger", () => ({ logger: { warn } }));
// Snapshot, name normalization and access policy are the real production
// modules. The database boundary is mocked; no connection is opened.
const { getConfirmedGymAccessOutcome } = await import("./x904PaidGymAccessOutcome.js");
const dialect = new PgDialect();
const now = new Date("2026-11-17T12:00:00Z"); // 19:00 WIB

function input(): { booking: any; payment: any } {
  return {
    booking: { id: 1001, facilityId: 6, source: "admin", membershipId: null, membershipPaymentId: null },
    payment: { id: 2001, bookingId: 1001, status: "confirmed", paymentType: "full", amount: 30000,
      sourceMembershipPaymentId: null, proofUrl: null },
  };
}
function committed(): any {
  return {
    facility_id: 6, source: "admin", customer_name: "UNIT GUEST", booking_date: "2026-11-17",
    booking_status: "confirmed", membership_id: null, membership_payment_id: null, payable: 30000,
    payment_status: "confirmed", payment_type: "full", source_membership_payment_id: null,
    payment_confirmed_at: "2026-11-16T23:00:00Z", paid_amount: 30000, proof_present: false,
    confirmed_payment_count: 1, access_id: 3001, grant_payment_id: 2001, identity_type: "pin",
    identity_label: "PIN:700", grant_payment_status: "confirmed", grant_membership_payment_id: null,
    grant_payment_confirmed_at: "2026-11-16T23:00:00Z", grant_paid_amount: 30000, grant_proof_present: false,
    user_pin: "700", device_uid: 343, verified_name: "UNIT GUEST", verification_state: "verified",
    access_state: "active", activated_at: "2026-11-16T23:01:00Z", expires_at: "2026-11-17T16:00:00Z",
    current_uid: 343, current_name: "UNIT GUEST", current_role: 0, registry_uid: 343,
    registry_name: "UNIT GUEST", registry_state: "verified", revoked_at: null, has_membership: false,
    reservation_state: null, reservation_payment_id: null, card_code: null, reservation_pin: null,
    reservation_uid: null, collected_at: null, funds_verified_at: null,
  };
}
function reads(row: any, group = 1) {
  execute.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{
    observed_at: new Date(now.getTime() - 1000), user_count: 1,
    users: [{ pin: row.user_pin, name: row.verified_name, role: 0, enabled: true, group }],
  }] });
}

describe("paid Gym outcome preserves canonical payment and identity boundaries", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    execute.mockReset();
    warn.mockReset();
  });
  afterEach(() => {
    for (const [query] of execute.mock.calls) {
      const rendered = dialect.sqlToQuery(query);
      expect(rendered.sql.trimStart()).toMatch(/^SELECT\b/i);
      expect(rendered.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|CALL)\b/i);
    }
    jest.useRealTimers();
  });

  test.each(["pending", "active"])("Admin cash without a paper proof retains its canonical %s grant", async state => {
    const { booking, payment } = input();
    const row = committed();
    row.access_state = state;
    row.activated_at = state === "active" ? "2026-11-16T23:01:00Z" : null;
    reads(row, state === "active" ? 1 : 2);
    const result = await getConfirmedGymAccessOutcome(booking, payment);
    expect(result).toMatchObject({ state, action: state === "active" ? "none" : "wait" });
    // An early activation remains valid until the worker's stored closing
    // expiry; this reader must not invent a shorter activation+12h clock.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  test.each(["admin_pin", "public_vis"])("a later balance receipt preserves the canonical grant for %s", async route => {
    const { booking, payment } = input();
    const row = committed();
    payment.id = 2002;
    payment.amount = 10000;
    row.paid_amount = 10000;
    row.grant_paid_amount = 20000;
    row.confirmed_payment_count = 2;
    if (route === "public_vis") {
      booking.source = row.source = "gym_public_guest";
      Object.assign(row, {
        identity_type: "card", identity_label: "VIS001", user_pin: "78", device_uid: 338,
        verified_name: "VIS001", current_uid: 338, current_name: "VIS001", registry_uid: null,
        registry_name: null, registry_state: null, reservation_state: "reserved",
        reservation_payment_id: 2001, card_code: "VIS001", reservation_pin: "78", reservation_uid: 338,
        collected_at: null, funds_verified_at: "2026-11-16T23:00:00Z",
      });
    }
    const before = structuredClone(row);
    reads(row);
    expect(await getConfirmedGymAccessOutcome(booking, payment)).toMatchObject({ state: "active", action: "none" });
    expect(row).toEqual(before);
    expect(row.grant_payment_id).toBe(2001);
    expect(row.collected_at).toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["booking", "membershipId"], ["booking", "membershipPaymentId"], ["payment", "sourceMembershipPaymentId"],
  ])("incoming %s.%s excludes membership without reading daily access", async (target, field) => {
    const { booking, payment } = input();
    (target === "booking" ? booking : payment)[field] = 901;
    expect(await getConfirmedGymAccessOutcome(booking, payment)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([
    "membership_id", "membership_payment_id", "source_membership_payment_id", "grant_membership_payment_id",
  ])("committed %s excludes membership even when the response object is stale", async field => {
    const { booking, payment } = input();
    const row = committed();
    row[field] = 901;
    execute.mockResolvedValueOnce({ rows: [row] });
    expect(await getConfirmedGymAccessOutcome(booking, payment)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("a failed status query preserves the committed payment and returns review without leaking query details", async () => {
    const { booking, payment } = input();
    execute.mockRejectedValueOnce(new Error("sensitive customer and proof in failed query"));
    expect(await getConfirmedGymAccessOutcome(booking, payment)).toMatchObject({
      state: "review_required", code: "X904_ACCESS_STATUS_UNAVAILABLE", action: "review",
    });
    expect(payment.status).toBe("confirmed");
    expect(warn).toHaveBeenCalledWith(
      { bookingId: 1001, paymentId: 2001, code: "X904_ACCESS_STATUS_UNAVAILABLE" },
      "[gym-x904] access status unavailable after payment",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive");
  });
});
