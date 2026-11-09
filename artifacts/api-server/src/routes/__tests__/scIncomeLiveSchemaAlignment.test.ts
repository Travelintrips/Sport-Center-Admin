import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateIncome } from "../../lib/scIncomeValidation";

const migration = readFileSync(resolve(process.cwd(), "../../migrations/20261109_sc_income_live_schema_alignment.sql"), "utf8");
const writer = readFileSync(resolve(process.cwd(), "src/lib/scIncomeOperational.ts"), "utf8");

const sample = {
  entryKey: "49a75bc0-0b74-422b-b28f-06a516da8401",
  transactionDate: "2026-11-09",
  sourceName: "Felicia Justiani",
  senderBank: "BCA",
  method: "Transfer Bank",
  receivingAccount: "blu by BCA Digital",
  amount: 10000,
};

describe("live income schema alignment", () => {
  it("adds retry counter required by the sync worker without writing bank mutations", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS sheet_sync_attempts integer NOT NULL DEFAULT 0");
    expect(writer).toContain("sheet_sync_attempts=sheet_sync_attempts+1");
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?(?:public\.)?(?:bank_mutations|payments|journal)/i);
  });
  it("matches runtime validation limits and optional receiving account for non-bank methods", () => {
    expect(migration).toContain("BETWEEN 2 AND 160");
    expect(migration).toContain("BETWEEN 2 AND 120");
    expect(migration).toContain("method <> 'Transfer Bank'");
    expect(migration).toContain("length(btrim(receiving_account)) >= 2");
    expect(validateIncome(sample).amount).toBe(10000);
    expect(validateIncome({ ...sample, method: "Tunai", receivingAccount: "" }).method).toBe("Tunai");
    expect(() => validateIncome({ ...sample, senderBank: "" })).toThrow();
    expect(() => validateIncome({ ...sample, method: "Transfer Bank", receivingAccount: "" })).toThrow();
  });
});
