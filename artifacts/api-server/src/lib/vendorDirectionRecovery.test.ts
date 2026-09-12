import { describe, expect, it } from "vitest";
import { assessVendorDirectionRecovery } from "./vendorDirectionRecovery";

const base = {
  direction: "IN",
  status: "unmatched",
  accountingPosted: false,
  journalId: null,
  description: "Pembayaran Vendor ABC",
  amount: "100000",
  creditAmount: "0",
  debitAmount: "100000",
  rawPayload: {},
} as const;

describe("vendor direction recovery", () => {
  it("allows only an IN vendor row with explicit debit evidence", () => {
    const result = assessVendorDirectionRecovery(base);
    expect(result.eligible).toBe(true);
    expect(result.debitAmount).toBe(100000);
  });

  it("fails closed when the row has no debit evidence", () => {
    const result = assessVendorDirectionRecovery({ ...base, debitAmount: "0", rawPayload: {} });
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("missing_debit_evidence");
  });

  it("fails closed when credit and debit are both present", () => {
    const result = assessVendorDirectionRecovery({ ...base, creditAmount: "100000" });
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("ambiguous_credit_and_debit");
  });

  it("does not allow final or posted rows", () => {
    expect(assessVendorDirectionRecovery({ ...base, status: "approved" }).eligible).toBe(false);
    expect(assessVendorDirectionRecovery({ ...base, accountingPosted: true }).eligible).toBe(false);
    expect(assessVendorDirectionRecovery({ ...base, journalId: "JRN-1" }).eligible).toBe(false);
  });

  it("can recover debit evidence retained only in the raw import payload", () => {
    const result = assessVendorDirectionRecovery({
      ...base,
      debitAmount: "0",
      rawPayload: { Debit: "1.250.000" },
    });
    expect(result.eligible).toBe(true);
    expect(result.debitAmount).toBe(1250000);
    expect(result.evidence).toContain("raw_payload_debit_amount");
  });
});