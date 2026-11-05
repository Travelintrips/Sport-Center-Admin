import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("X904 VMSC paid Gym late activation fail-closed", () => {
  const source = readFileSync(join(process.cwd(), "../../scripts/x904-vmsc-group-executor-stage.ps1"), "utf8");

  it("limits operating-hour denial to paid Gym ACTIVATE_USER", () => {
    expect(source).toContain("function AssertGymPaidActivationOpen($command)");
    expect(source).toContain("$command.commandType -cne 'ACTIVATE_USER'");
    expect(source).toContain("$command.payload.source -cne 'AUTO_NONMEMBER_GYM_12H'");
    expect(source).toContain("$wib=[DateTime]::UtcNow.AddHours(7)");
    expect(source).toContain("$wib.Hour -ge 6 -and $wib.Hour -lt 23");
    expect(source).toContain("'GYM_CLOSED'");
  });

  it("checks once before device access and again immediately before SetUserGroup", () => {
    const first = source.indexOf("AssertGymPaidActivationOpen $cmd");
    const last = source.lastIndexOf("AssertGymPaidActivationOpen $cmd");
    const write = source.indexOf("$zk.SetUserGroup");
    expect(first).toBeGreaterThan(source.indexOf("if(-not $ExecuteClaimed)"));
    expect(last).toBeGreaterThan(first);
    expect(last).toBeLessThan(write);
  });
});
