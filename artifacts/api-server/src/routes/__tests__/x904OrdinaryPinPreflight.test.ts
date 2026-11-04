import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("X904 ordinary PIN booking preflight", () => {
  for (const route of ["bookings.ts", "whatsapp.ts"]) {
    test(`${route} blocks member-owned and exempt PINs before creating bookings`, () => {
      const source = readFileSync(join(process.cwd(), "src/routes", route), "utf8");
      const check = source.indexOf('if (identityType === "pin") {');
      const ownership = source.indexOf("sport_center.gym_x904_member_mapping", check);
      const exempt = source.indexOf("['12', '79', '237'].includes(userPin)", check);
      const grant = source.indexOf("INSERT INTO sport_center.x904_nonmember_daily_access");
      expect(check).toBeGreaterThan(-1);
      expect(ownership).toBeGreaterThan(check);
      expect(exempt).toBeGreaterThan(check);
      expect(ownership).toBeLessThan(grant);
      expect(exempt).toBeLessThan(grant);
    });
  }
});
