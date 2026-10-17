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

  it("reclaims an expired outbox processing lease without stealing live work", () => {
    const runtime = readFileSync(resolve(process.cwd(), "src/lib/bizportalSync.ts"), "utf8");
    expect(runtime).toContain("status IN ('pending', 'failed', 'processing')");
    expect(runtime).toContain("available_at <= NOW()");
    expect(runtime).toContain("locked_at < NOW() - INTERVAL '15 minutes'");
    expect(runtime).toContain("FOR UPDATE SKIP LOCKED");
    expect(runtime).toContain("LIMIT 50");
  });

  it("keeps posted journal financial fields immutable after canonical settlement", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "../../scripts/patch_dev_settlement_posted_journal_snapshot.sql"),
      "utf8",
    );
    expect(migration).toContain("CREATE OR REPLACE FUNCTION sport_center.sync_payment_accounting_journal()");
    expect(migration).toContain("v_journal_status = 'posted' AND TG_OP = 'UPDATE'");
    expect(migration).toContain("OLD.settlement_status = 'unsettled'");
    expect(migration).toContain("NEW.settlement_status = 'settled'");
    expect(migration).toContain("IS NOT DISTINCT FROM");
    expect(migration).toContain("to_jsonb(OLD)");
    expect(migration).toContain("to_jsonb(NEW)");
    expect(migration).not.toContain("allow_posted_accounting_metadata_correction");
    expect(migration).not.toContain("DISABLE TRIGGER");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION sport_center.guard_posted_accounting_journal()");
  });

  it("requires canonical posted settlement evidence before skipping payment-journal snapshot sync", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "../../scripts/patch_dev_settlement_posted_journal_batch_evidence.sql"),
      "utf8",
    );
    expect(migration).toContain("batch.status IN ('posted', 'reconciled')");
    expect(migration).toContain("item.item_status = 'active'");
    expect(migration).toContain("batch.company_id = NEW.company_id");
    expect(migration).toContain("batch.bank_account_id = NEW.bank_account_id");
    expect(migration).toContain("batch.settlement_date::text = NEW.expected_settlement_date");
    expect(migration).toContain("batch.settlement_rule_version = NEW.settlement_rule_version");
    expect(migration).toContain("settlement_journal.status = 'posted'");
    expect(migration).toContain("settlement_journal.journal_type = 'settlement'");
    expect(migration).toContain("settlement_journal.is_reversal = false");
    expect(migration).not.toContain("allow_posted_accounting_metadata_correction");
    expect(migration).not.toContain("DISABLE TRIGGER");
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