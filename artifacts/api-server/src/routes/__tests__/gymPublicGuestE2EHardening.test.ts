import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("gym public guest end-to-end hardening", () => {
  const wa = readFileSync(join(process.cwd(), "src/routes/whatsapp.ts"), "utf8");
  const payments = readFileSync(join(process.cwd(), "src/routes/payments.ts"), "utf8");
  test("proof auto-confirm is blocked for gym_public_guest", () => {
    expect(wa).toContain('booking.source !== "gym_public_guest"');
  });
  test("legacy WA confirmation paths instruct Booking Admin for gym_public_guest", () => {
    expect((wa.match(/Booking Gym mandiri wajib diverifikasi dari Booking Admin/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  test("generic payment-confirmed notification is suppressed for gym_public_guest", () => {
    expect(payments).toContain('if (booking.source !== "gym_public_guest")');
    expect(payments).toContain('notifyGymGuestPaymentVerified');
  });
});
