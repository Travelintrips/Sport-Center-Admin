import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const api = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
const notifications = readFileSync(resolve(process.cwd(), "src/lib/notifications.ts"), "utf8");
const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/CheckoutForm.tsx"), "utf8");

describe("admin Corporate: Tidak Kirim Pesan contract", () => {
  test("UI defaults unchecked; exposes option only to Corporate and sends flag to server", () => {
    expect(ui).toContain("const [suppressCustomerWhatsApp, setSuppressCustomerWhatsApp] = useState(false)");
    expect(ui).toContain('bookingKind === "corporate" && (');
    expect(ui).toContain("Tidak Kirim Pesan");
    expect(ui).toContain("suppressCustomerWhatsApp }");
  });

  test("button is disabled until all existing booking conditions pass", () => {
    expect(ui).toContain('disabled={!canSubmitBooking}');
    expect(ui).toContain("const canSubmitBooking = Boolean(");
    expect(ui).toContain("bookingScheduleValid &&");
    expect(ui).toContain("formPaymentValid &&");
  });

  test("server accepts suppression only from authenticated admin corporate booking", () => {
    expect(api).toContain('isAdminRequest && bookingSource === "admin"');
    expect(api).toContain('req.body.suppressCustomerWhatsApp === true');
    expect(api).toContain('req.body.payerType === "company"');
    expect(api).toContain("suppressCustomerMessage: suppressCustomerBookingWhatsApp");
  });

  test("direct customer messages are suppressed without disabling admin report", () => {
    const company = notifications.split("export async function notifyCompanyBookingCreated(")[1]?.split("export async function notifyRescheduleApproved(")[0] ?? "";
    expect(company).toContain("if (!data.suppressCustomerMessage) await sendWAToCustomer(data.customerPhone, customerMsg)");
    expect(company).toContain("await sendWAToAdmins(adminMsg)");
    expect(company).toContain("canonicalPhone(data.picPhone) === canonicalPhone(data.customerPhone)");
    const generic = notifications.split("export async function notifyBookingCreated(")[1]?.split("export interface RecurringBookingSessionNotif")[0] ?? "";
    expect(generic.match(/if \(!data\.suppressCustomerMessage\) await sendWAToCustomer/g)?.length).toBe(2);
    expect(generic).toContain("if (data.adminReport !== false)");
  });
});
