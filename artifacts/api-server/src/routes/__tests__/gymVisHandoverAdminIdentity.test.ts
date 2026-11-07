import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("gym VIS handover admin identity", () => {
  const source = readFileSync(join(process.cwd(), "src/routes/waBookingsAdmin.ts"), "utf8");
  test("collect-vis resolves actor from authenticated userId", () => {
    const section = source.slice(source.indexOf('router.post("/admin/wa-bookings/:orderNumber/collect-vis"'), source.indexOf('router.post("/admin/wa-bookings/:orderNumber/return-vis"'));
    expect(section).toContain("sessionUser?.userId");
    expect(section).toContain("usersTable.email");
    expect(section).toContain("collectReservedVisCard");
  });
});
