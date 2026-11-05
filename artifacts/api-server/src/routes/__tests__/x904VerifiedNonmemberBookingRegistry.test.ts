import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("X904 verified nonmember registry booking gate", () => {
  for (const route of ["bookings.ts", "whatsapp.ts"]) {
    const source = readFileSync(join(process.cwd(), "src/routes", route), "utf8");

    test(`${route} refuses ordinary PINs absent from verified registry before booking`, () => {
      const inventory = source.indexOf("FROM sport_center.gym_x904_lan_users");
      const registryCheck = source.indexOf("Ordinary PINs must be explicitly approved", inventory);
      const registry = source.indexOf("FROM sport_center.x904_verified_nonmember_identities", registryCheck);
      const verified = source.indexOf("verification_state='verified' AND revoked_at IS NULL", registry);
      const rejection = source.indexOf('res.status(409).json({ error: "PIN nonmember belum terverifikasi', registry);
      const bookingInsert = source.indexOf("INSERT INTO sport_center.x904_nonmember_daily_access");
      expect(inventory).toBeGreaterThan(-1);
      expect(registryCheck).toBeGreaterThan(inventory);
      expect(registry).toBeGreaterThan(registryCheck);
      expect(verified).toBeGreaterThan(registry);
      expect(rejection).toBeGreaterThan(verified);
      expect(rejection).toBeLessThan(bookingInsert);
      expect(source.slice(registryCheck, rejection)).toContain('device_uid=${Number(row.device_uid)}');
      expect(source.slice(registryCheck, rejection)).toContain("device_serial='TDBD234200545'");
    });

    test(`${route} revalidates approved PIN inside booking transaction`, () => {
      const transactionGuard = source.indexOf("Lock registry ownership for the booking transaction");
      const lock = source.indexOf("FOR SHARE", transactionGuard);
      const failure = source.indexOf("X904_NONMEMBER_REGISTRY_CHANGED", lock);
      const grant = source.indexOf("INSERT INTO sport_center.x904_nonmember_daily_access", lock);
      expect(transactionGuard).toBeGreaterThan(-1);
      expect(source.slice(transactionGuard, lock)).toContain('verifiedX904Identity?.identityType === "pin"');
      expect(lock).toBeGreaterThan(transactionGuard);
      expect(failure).toBeGreaterThan(lock);
      expect(grant).toBeGreaterThan(failure);
    });

    test(`${route} keeps VIS card path distinct from ordinary PIN restriction`, () => {
      const registryCheck = source.indexOf("Ordinary PINs must be explicitly approved");
      const card = source.lastIndexOf('resolveX904NonmemberCard(', registryCheck);
      expect(card).toBeGreaterThan(-1);
      expect(source.slice(registryCheck, registryCheck + 250)).toContain('identityType === "pin"');
    });
  }
});
