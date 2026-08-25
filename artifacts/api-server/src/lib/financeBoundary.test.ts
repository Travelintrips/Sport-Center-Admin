import { afterEach, describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getSportCenterFinanceMode,
  isCentralFinanceMode,
  shouldRunLegacyFinanceWrites,
} from "./financeBoundary";
import { getSportCenterPaymentCorrelationId } from "./accounting";

const originalMode = process.env.SPORT_CENTER_FINANCE_MODE;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.SPORT_CENTER_FINANCE_MODE;
  } else {
    process.env.SPORT_CENTER_FINANCE_MODE = originalMode;
  }
});

describe("Sport Center finance boundary mode", () => {
  it("defaults to legacy so existing production processing remains safe", () => {
    delete process.env.SPORT_CENTER_FINANCE_MODE;
    expect(getSportCenterFinanceMode()).toBe("legacy");
    expect(shouldRunLegacyFinanceWrites()).toBe(true);
  });

  it("supports shadow without disabling legacy downstream processing", () => {
    process.env.SPORT_CENTER_FINANCE_MODE = "shadow";
    expect(getSportCenterFinanceMode()).toBe("shadow");
    expect(shouldRunLegacyFinanceWrites()).toBe(true);
    expect(isCentralFinanceMode()).toBe(false);
  });

  it("disables downstream Sport Center finance writes only in central mode", () => {
    process.env.SPORT_CENTER_FINANCE_MODE = "central";
    expect(getSportCenterFinanceMode()).toBe("central");
    expect(shouldRunLegacyFinanceWrites()).toBe(false);
    expect(isCentralFinanceMode()).toBe(true);
  });

  it("fails closed to legacy for unknown values", () => {
    process.env.SPORT_CENTER_FINANCE_MODE = "unsupported";
    expect(getSportCenterFinanceMode()).toBe("legacy");
    expect(shouldRunLegacyFinanceWrites()).toBe(true);
  });
});

describe("Sport Center finance event contract", () => {
  it("uses one deterministic correlation for a payment id or mirror number", () => {
    expect(getSportCenterPaymentCorrelationId("SCPAY-SC-42", 42)).toBe("sc_payment_42");
    expect(getSportCenterPaymentCorrelationId("SCPAY-SC-42")).toBe("sc_payment_42");
    expect(getSportCenterPaymentCorrelationId("legacy-payment")).toBe("sc_payment_legacy-payment");
  });

  it("keeps the group booking producer unreachable from the live payment route", () => {
    const route = readFileSync(resolve(process.cwd(), "src/routes/payments.ts"), "utf8");
    expect(route).not.toContain("createPublicAccountingEntryForGroup");
    expect(route).toContain("GROUP_ACCOUNTING_BACKFILL_RETIRED");
    expect(route).toContain("postConfirmedPaymentAccounting");
  });

  it("keeps database-level event uniqueness in both runtime and migration definitions", () => {
    const runtime = readFileSync(resolve(process.cwd(), "src/lib/bizportalSync.ts"), "utf8");
    const migration = readFileSync(resolve(process.cwd(), "../../scripts/migrate.ts"), "utf8");
    for (const source of [runtime, migration]) {
      expect(source).toContain("UNIQUE (payment_id, event_type)");
      expect(source).toContain("sc_payment_");
      expect(source).toContain("payment_accounting_outbox_correlation_unique");
    }
  });
});