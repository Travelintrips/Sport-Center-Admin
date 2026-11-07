import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("gym VIS retry allocation", () => {
  const source = readFileSync(join(process.cwd(), "src/routes/waBookingsAdmin.ts"), "utf8");
  test("confirmed payment id can retry VIS reservation without reconfirming payment", () => {
    expect(source).toContain("confirmedPaymentId");
    expect(source).toContain("reserveVisAfterAdminPaymentConfirmation");
  });
});
