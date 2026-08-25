import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("central bank mutation ownership", () => {
  it("uses public bank mutations and a payment-scoped canonical identity", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/canonicalBankMutation.ts"), "utf8");
    expect(source).toContain("INSERT INTO public.bank_mutations");
    expect(source).toContain("sport_center:payment:${input.paymentId}");
    expect(source).toContain("source_table = 'sport_payments'");
    expect(source).not.toContain("sport_center.bank_mutations");
  });

  it("keeps central posting out of the legacy projection path", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/bizportalSync.ts"), "utf8");
    expect(source).toContain("if (!shouldRunLegacyFinanceWrites()) return;");
  });

  it("does not let central application code call the projection or write SC mutations", () => {
    const central = readFileSync(resolve(process.cwd(), "src/lib/centralFinance.ts"), "utf8");
    const accounting = readFileSync(resolve(process.cwd(), "src/lib/accounting.ts"), "utf8");
    expect(central).not.toContain("project_public_bank_mutation_to_canonical");
    expect(accounting).not.toContain("INSERT INTO sport_center.bank_mutations");
  });
});