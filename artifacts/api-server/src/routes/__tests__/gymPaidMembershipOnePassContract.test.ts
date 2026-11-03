import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("paid Gym membership one-pass registration contract", () => {
  const routeFile = readFileSync(resolve(process.cwd(), "src/routes/memberships.ts"), "utf8");
  const section = routeFile.split('router.post("/memberships/admin-register-paid"')[1]
    ?.split('router.post("/memberships",')[0] ?? "";
  const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/CheckoutForm.tsx"), "utf8");

  it("requires authorized admins, valid payment date, method and proof", () => {
    expect(section).toContain('adminMiddleware, membershipProofUpload.single("proof")');
    expect(section).toContain('"admin_booking"');
    expect(section).toContain('normalizePaymentDate(req.body?.paymentDate)');
    expect(section).toContain('["qris", "transfer"]');
    expect(section).toContain('if (!proof || !mime || !extensions[mime])');
  });

  it("creates customer, membership and one payment in a single transaction", () => {
    expect(section).toContain("await db.transaction(async tx =>");
    expect(section).toContain("tx.insert(usersTable)");
    expect(section).toContain("tx.insert(gymMembershipsTable)");
    expect(section).toContain("tx.insert(membershipPaymentsTable)");
    expect(section).toContain("tx.update(membershipPaymentsTable)");
    expect(section).toContain('status:"confirmed"');
    expect(section).toContain('status:"active"');
  });

  it("serializes duplicate submissions and prevents duplicate membership by phone", () => {
    expect(section).toContain("pg_advisory_xact_lock");
    expect(section).toContain('IN (\'active\',\'pending_payment\',\'waiting_confirmation\')');
    expect(section).toContain("Nomor WhatsApp sudah digunakan customer lain");
    expect(section).toContain("MEMBERSHIP_INSERT_FAILED");
  });

  it("uses the existing membership payment booking, financial idempotency and X904 receipt", () => {
    expect(section).toContain("ensureMembershipPaymentBooking(membership,payment,tx,orderNumber)");
    expect(section).toContain("mutationKey:");
    expect(section).toContain("accountingRef:");
    expect(section).toContain("x904_automatic_entitlement_events");
    expect(section).toContain("ON CONFLICT (event_key) DO NOTHING");
    expect(section).not.toContain("gymCheckinsTable");
  });

  it("does not create a login password and does not activate X904 without device ACK", () => {
    expect(section).toContain("passwordHash:null");
    expect(section).toContain('x904Status:"pending_device_ack"');
    expect(section).not.toContain("ACTIVATE_USER");
  });

  it("offers a single action for an already-paid Gym member", () => {
    expect(ui).toContain("Daftarkan Member & Konfirmasi Pembayaran");
    expect(ui).toContain('/api/memberships/admin-register-paid');
    expect(ui).toContain("!isMembership && <div");
    expect(ui).toContain('isMembership ? "Email *" : "Email (opsional)"');
  });
});
