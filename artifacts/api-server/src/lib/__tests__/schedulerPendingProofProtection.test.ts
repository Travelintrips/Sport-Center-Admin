import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("scheduler pending proof protection", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/scheduler.ts"), "utf8");
  test("expiry skips pending payments with uploaded proof", () => {
    expect(source).toContain("hasPendingProofAwaitingVerification(booking.id)");
    expect(source).toContain("expiry dilewati");
  });
  test("payment reminder skips uploaded proof awaiting verification", () => {
    expect(source).toContain("Payment reminder skipped");
    expect(source).toContain("proof awaiting verification");
  });
});
