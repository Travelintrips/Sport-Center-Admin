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
    expect(section).toContain("ensureMembershipPaymentBooking(membership,pending,tx,orderNumber)");
    expect(section).toContain("ensureMembershipPaymentBooking(membership,payment,tx,orderNumber)");
    expect(section.indexOf("ensureMembershipPaymentBooking(membership,pending,tx,orderNumber)"))
      .toBeLessThan(section.indexOf("tx.update(membershipPaymentsTable)"));
    expect(section).toContain("if (booking.id !== pendingBooking.id)");
    expect(section).toContain("mutationKey:");
    expect(section).toContain("accountingRef:");
    expect(section).toContain("x904_automatic_entitlement_events");
    expect(section).toContain("ON CONFLICT (event_key) DO NOTHING");
    expect(section).toContain("RETURNING event_id,membership_id,payment_id");
    expect(section).toContain("entitlementEvent.rows.length !== 1");
    expect(section).toContain("X904_PAYMENT_ENTITLEMENT_EVENT_NOT_PERSISTED");
    expect(section).not.toContain("gymCheckinsTable");
  });

  it("does not create a login password and does not activate X904 without device ACK", () => {
    expect(section).toContain("passwordHash:null");
    expect(section).toContain('x904Status:"pending_device_ack"');
    expect(section).not.toContain("ACTIVATE_USER");
  });

  it("validates and atomically maps a selected X904 PIN without bypassing ACK", () => {
    expect(section).toContain('req.body?.x904Pin');
    expect(section).toContain('req.body?.x904IdentityConfirmed === "true"');
    expect(section).toContain('x904VerifiedName !== String(machineUsers.rows[0].display_name).trim()');
    expect(ui).toContain('form.append("x904IdentityConfirmed",String(membershipX904IdentityConfirmed))');
    expect(ui).toContain('membershipX904Name && membershipX904IdentityConfirmed');
    expect(section).toContain('gym_x904_lan_users');
    expect(section).toContain('device_role');
    expect(section).toContain('gym_x904_member_mapping');
    expect(section).toContain('mappings.rows[0].membership_id != null');
    expect(section).toContain('membership_id=EXCLUDED.membership_id');
    expect(section).toContain('RETURNING membership_id,user_pin,status');
    expect(section).toContain('mapped.rows.length !== 1');
    expect(section).toContain('String(mapped.rows[0].membership_id) !== String(membership.id)');
    expect(section).toContain('Pemetaan PIN X904 gagal atau berubah bersamaan');
    expect(ui).toContain('form.append("x904Pin",membershipX904Pin.trim())');
    expect(ui).toContain('Nama di mesin:');
    expect(ui).toContain('membershipX904Name && !membershipX904Checking && !membershipX904Error');
  });

  it("registers admin X904 candidate search before the dynamic membership ID route", () => {
    const searchIndex = routeFile.indexOf('router.get("/memberships/admin-x904-candidates"');
    const dynamicIndex = routeFile.indexOf('router.get("/memberships/:id"');
    expect(searchIndex).toBeGreaterThan(-1);
    expect(dynamicIndex).toBeGreaterThan(-1);
    expect(searchIndex).toBeLessThan(dynamicIndex);
  });

  it("searches X904 inventory as a literal substring without SQL LIKE ESCAPE", () => {
    const lookup = routeFile.split('router.get("/memberships/admin-x904-candidates"')[1]
      ?.split('router.post("/memberships/admin-register-paid"')[0] ?? "";
    expect(lookup).toContain("adminMiddleware");
    expect(lookup).toContain("strpos(lower(i.display_name), lower(${term})) > 0");
    expect(lookup).toContain("strpos(i.user_pin, ${term}) > 0");
    expect(lookup).not.toContain("ESCAPE");
    expect(lookup).toContain("mappedMembershipId:");
    expect(lookup).toContain("available: row.mapped_membership_id == null");
    expect(lookup).toContain("LIMIT 15");
  });

  it("shows the renewal period and blocks continuation if its preview is invalid", () => {
    expect(ui).toContain('if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false');
    expect(ui).not.toContain('if (!/^\\\\d{4}-\\\\d{2}-\\\\d{2}$/.test(value)) return false');
    expect(ui).toContain('.formatToParts(new Date())');
    expect(ui).toContain('const renewalPeriodValid = memberAction !== "renew" ||');
    expect(ui).toContain('&& renewalPeriodValid &&');
    expect(ui).toContain('Periode perpanjangan belum valid. Tombol perpanjangan dinonaktifkan.');
    expect(ui).toContain('Periode baru');
    expect(ui).toContain('Tagihan');
  });

  it("previews lapsed gym renewals from Jakarta today, not the old expiration", () => {
    expect(ui).toContain("function previewGymRenewalPeriod(");
    expect(ui).toContain("jakartaDateOnly(),");
    expect(ui).toContain('status === "active" && todayMs <= endMs + 7 * 86400000');
    expect(ui).toContain('new Date(endMs + 86400000).toISOString().slice(0, 10)');
    expect(ui).toContain(': today;');
    expect(ui).toContain('getUTCMonth() + months');
    expect(ui).toContain('getUTCDate()');
    expect(ui).not.toContain('start.setDate(start.getDate() + 1)');
    expect(ui).toContain('periodStart: String(data.renewal?.periodStart ?? renewalStartDate ?? "")');
    expect(ui).toContain('periodEnd: String(data.renewal?.periodEnd ?? renewalEndDate ?? "")');
  });

  it("accepts a valid custom renewal ISO date and rejects malformed inputs", () => {
    const renewRoute = routeFile.split('async function handleMembershipRenewal(')[1]
      ?.split('// Preserve the original public renewal contract.')[0] ?? "";
    expect(renewRoute).toContain('const validDay = /^\\d{4}-\\d{2}-\\d{2}$/.test(requestedStart)'.replace(/\\\\/g, "\\"));
    expect(renewRoute).not.toContain('const validDay = /^\\\\d{4}-\\\\d{2}-\\\\d{2}$/.test(requestedStart)');
    const validISO = /^\d{4}-\d{2}-\d{2}$/;
    const calendarDate = (value: string) => validISO.test(value) &&
      !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
    expect(calendarDate("2026-11-03")).toBe(true);
    expect(calendarDate("2026-02-30")).toBe(false);
    expect(calendarDate("03/11/2026")).toBe(false);
    const today = "2026-11-04", priorEnd = "2026-08-27";
    const earliest = new Date(Date.parse(today + "T00:00:00Z") - 30 * 86400000).toISOString().slice(0, 10);
    expect("2026-11-03" > priorEnd && "2026-11-03" >= earliest && "2026-11-03" <= today).toBe(true);
    expect("2026-10-01" < earliest).toBe(true);
  });

  it("keeps financial confirmation separate from unverified X904 mapping", () => {
    const patch = routeFile.split('router.patch("/memberships/:id"')[1] ?? "";
    const transaction = patch.split('const result = await db.transaction(async (tx) => {')[1]
      ?.split('confirmationStage = "post_commit_projection"')[0] ?? "";
    expect(transaction).toContain('const mappedX904 = await tx.execute(sql');
    expect(transaction).toContain('FROM sport_center.gym_x904_member_mapping');
    expect(transaction).toContain("AND status = 'verified'");
    expect(transaction).toContain("AND device_serial = 'TDBD234200545'");
    expect(transaction).toContain('if (mappedX904.rows.length > 0)');
    expect(transaction).toContain('INSERT INTO sport_center.x904_automatic_entitlement_events');
    expect(transaction.indexOf('if (mappedX904.rows.length > 0)')).toBeLessThan(
      transaction.indexOf('INSERT INTO sport_center.x904_automatic_entitlement_events'));
    expect(transaction).toContain('ON CONFLICT (event_key) DO NOTHING');
    expect(transaction).toContain('tx.update(membershipPaymentsTable)');
    expect(transaction).toContain('tx.update(gymMembershipsTable)');
    expect(transaction).toContain('ensureMembershipPaymentBooking(current, updatedPayment, tx)');
    // No mapping mutation, arbitrary entitlement bypass, or physical door command.
    expect(transaction).not.toContain('INSERT INTO sport_center.gym_x904_member_mapping');
    expect(transaction).not.toContain('ACTIVATE_USER');
    expect(transaction).not.toContain('DISABLE_USER');
  });

  it("keeps payment date only after renewal invoice creation while allowing a custom start date", () => {
    const renewRoute = routeFile.split('async function handleMembershipRenewal(')[1]
      ?.split('// Preserve the original public renewal contract.')[0] ?? "";
    expect(renewRoute).toContain('const requestedStart = String(req.body?.startDate ?? "").trim()');
    expect(renewRoute).toContain('Tanggal mulai khusus memerlukan akses admin');
    expect(renewRoute).toContain('requestedStart <= existing.endDate');
    expect(renewRoute).toContain('const earliest = new Date(todayMs - 30*86400000)');
    expect(renewRoute).toContain('Tagihan perpanjangan masih berjalan');
    expect(renewRoute).toContain('periodStart: newStartDate');
    expect(routeFile).toContain('router.post("/memberships/:id/admin-renew", adminMiddleware, handleMembershipRenewal)');
    expect(routeFile).toContain('router.post("/memberships/:id/renew", handleMembershipRenewal)');
    expect(ui).toContain('Tanggal mulai membership');
    expect(ui).toContain('setRenewalStartOverride');
    expect(ui).toContain('...(renewalStartOverride ? { startDate: renewalStartOverride } : {})');
    expect(ui).toContain('Tanggal pembayaran diisi setelah tagihan dibuat.');
    expect(ui).toContain('id="checkout-membership-payment-date"');
  });

  it("offers a single action for an already-paid Gym member", () => {
    expect(ui).toContain("Daftarkan Member & Konfirmasi Pembayaran");
    expect(ui).toContain('/api/memberships/admin-register-paid');
    expect(ui).toContain("!isMembership && <div");
    expect(ui).toContain('isMembership ? "Email *" : "Email (opsional)"');
  });
});
