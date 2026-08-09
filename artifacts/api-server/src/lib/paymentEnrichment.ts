import { createHash } from "node:crypto";
import { db, paymentSettlementConfigsTable, bankImportSourceMappingsTable } from "@workspace/db";
import { and, desc, eq, lte, gte, isNull, or, sql } from "drizzle-orm";
import type { Booking } from "@workspace/db";

export type SettlementProvider = "mandiri_direct" | "paylabs" | "unknown";

export type PaymentCompanyResolution = {
  companyId: number | null;
  evidenceSource:
    | "booking_company_relation"
    | "booking_company_invoice"
    | "validated_explicit_configuration"
    | "facility_ownership"
    | "none";
};

export type PaymentEnrichment = {
  companyId: number | null;
  companyEvidenceSource: PaymentCompanyResolution["evidenceSource"];
  bankAccountId: string | null;
  bankAccountEvidenceSource: "effective_settlement_config" | "none";
  paidAt: Date | null;
  expectedSettlementDate: string | null;
};

function isoDateInJakarta(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function isBusinessDay(date: string): Promise<boolean> {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return false;
  const rows = await db.execute(sql`
    SELECT is_business_day
      FROM sport_center.payment_business_calendar
     WHERE calendar_date = ${date}
     LIMIT 1
  `).catch(() => ({ rows: [] }));
  const row = (rows as any).rows?.[0];
  return row?.is_business_day == null ? true : Boolean(row.is_business_day);
}

async function addBusinessDays(date: string, days: number): Promise<string> {
  let cursor = date;
  let remaining = Math.max(0, days);
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (await isBusinessDay(cursor)) remaining--;
  }
  return cursor;
}

export async function validateCompanyId(companyId: number | null | undefined): Promise<boolean> {
  if (companyId == null || !Number.isInteger(companyId)) return false;
  const result = await db.execute(sql`
    SELECT 1
      FROM sport_center.users
     WHERE id = ${companyId}
       AND account_type = 'company'
       AND COALESCE(account_status, 'active') NOT IN ('rejected', 'inactive')
     LIMIT 1
  `).catch(() => ({ rows: [] }));
  return Boolean((result as any).rows?.[0]);
}

export async function validateSettlementBankAccount(
  companyId: number | null | undefined,
  bankAccountId: string | null | undefined,
): Promise<boolean> {
  if (companyId == null || !bankAccountId?.trim()) return false;
  const result = await db
    .select({ id: paymentSettlementConfigsTable.id })
    .from(paymentSettlementConfigsTable)
    .where(and(
      eq(paymentSettlementConfigsTable.companyId, companyId),
      eq(paymentSettlementConfigsTable.bankAccountId, bankAccountId.trim()),
      eq(paymentSettlementConfigsTable.isActive, true),
    ))
    .limit(1)
    .catch(() => []);
  return Boolean(result[0]);
}

export async function resolvePaymentCompany(
  booking: Pick<Booking, "payerType" | "companyCustomerId" | "companyInvoiceId">,
  options?: {
    facilityCompanyId?: number | null;
    merchantCompanyId?: number | null;
    explicitCompanyId?: number | null;
  },
): Promise<PaymentCompanyResolution> {
  if (booking.payerType === "company" && booking.companyCustomerId != null) {
    if (await validateCompanyId(booking.companyCustomerId)) {
      return { companyId: booking.companyCustomerId, evidenceSource: "booking_company_relation" };
    }
  }

  if (booking.companyInvoiceId != null) {
    const invoice = await db.execute(sql`
      SELECT company_id
        FROM sport_center.company_invoices
       WHERE id = ${booking.companyInvoiceId}
       LIMIT 1
    `).catch(() => ({ rows: [] }));
    const companyId = (invoice as any).rows?.[0]?.company_id;
    if (companyId != null && await validateCompanyId(Number(companyId))) {
      return { companyId: Number(companyId), evidenceSource: "booking_company_invoice" };
    }
  }

  if (options?.facilityCompanyId != null && await validateCompanyId(options.facilityCompanyId)) {
    return { companyId: options.facilityCompanyId, evidenceSource: "facility_ownership" };
  }

  if (options?.merchantCompanyId != null && await validateCompanyId(options.merchantCompanyId)) {
    return { companyId: options.merchantCompanyId, evidenceSource: "validated_explicit_configuration" };
  }

  if (options?.explicitCompanyId != null && await validateCompanyId(options.explicitCompanyId)) {
    return {
      companyId: options.explicitCompanyId,
      evidenceSource: "validated_explicit_configuration",
    };
  }

  return { companyId: null, evidenceSource: "none" };
}

export async function resolveSettlementBankAccount(
  companyId: number | null,
  provider: SettlementProvider,
  paidAt: Date | null,
): Promise<{ bankAccountId: string | null; evidenceSource: "effective_settlement_config" | "none" }> {
  if (companyId == null || !paidAt) return { bankAccountId: null, evidenceSource: "none" };
  const effectiveDate = isoDateInJakarta(paidAt);
  const rows = await db
    .select({
      bankAccountId: paymentSettlementConfigsTable.bankAccountId,
    })
    .from(paymentSettlementConfigsTable)
    .where(and(
      eq(paymentSettlementConfigsTable.companyId, companyId),
      eq(paymentSettlementConfigsTable.providerCode, provider),
      eq(paymentSettlementConfigsTable.isActive, true),
      lte(paymentSettlementConfigsTable.effectiveFrom, effectiveDate),
      or(
        isNull(paymentSettlementConfigsTable.effectiveUntil),
        gte(paymentSettlementConfigsTable.effectiveUntil, effectiveDate),
      ),
    ))
    .orderBy(desc(paymentSettlementConfigsTable.effectiveFrom))
    .limit(1)
    .catch(() => []);
  return rows[0]?.bankAccountId
    ? { bankAccountId: rows[0].bankAccountId, evidenceSource: "effective_settlement_config" }
    : { bankAccountId: null, evidenceSource: "none" };
}

export async function resolveExpectedSettlementDate(
  provider: SettlementProvider,
  paidAt: Date | null,
  companyId: number | null,
  bankAccountId: string | null,
): Promise<string | null> {
  if (!paidAt || companyId == null || !bankAccountId) return null;
  const paidDate = isoDateInJakarta(paidAt);
  const rows = await db
    .select({ delay: paymentSettlementConfigsTable.settlementDelayBusinessDays })
    .from(paymentSettlementConfigsTable)
    .where(and(
      eq(paymentSettlementConfigsTable.companyId, companyId),
      eq(paymentSettlementConfigsTable.providerCode, provider),
      eq(paymentSettlementConfigsTable.bankAccountId, bankAccountId),
      eq(paymentSettlementConfigsTable.isActive, true),
      lte(paymentSettlementConfigsTable.effectiveFrom, paidDate),
      or(
        isNull(paymentSettlementConfigsTable.effectiveUntil),
        gte(paymentSettlementConfigsTable.effectiveUntil, paidDate),
      ),
    ))
    .orderBy(desc(paymentSettlementConfigsTable.effectiveFrom))
    .limit(1)
    .catch(() => []);
  if (!rows[0]) return null;
  return addBusinessDays(paidDate, rows[0].delay);
}

export async function enrichPayment(
  booking: Pick<Booking, "payerType" | "companyCustomerId" | "companyInvoiceId">,
  provider: SettlementProvider,
  paidAt: Date | null,
  options?: { explicitCompanyId?: number | null },
): Promise<PaymentEnrichment> {
  const company = await resolvePaymentCompany(booking, options);
  const account = await resolveSettlementBankAccount(company.companyId, provider, paidAt);
  const expectedSettlementDate = await resolveExpectedSettlementDate(
    provider,
    paidAt,
    company.companyId,
    account.bankAccountId,
  );
  return {
    companyId: company.companyId,
    companyEvidenceSource: company.evidenceSource,
    bankAccountId: account.bankAccountId,
    bankAccountEvidenceSource: account.evidenceSource,
    paidAt,
    expectedSettlementDate,
  };
}

export async function resolveBankImportSource(
  sourceId: string,
  worksheetName?: string,
): Promise<{
  companyId: number;
  bankAccountId: string;
  providerName: string | null;
} | null> {
  const rows = await db
    .select({
      companyId: bankImportSourceMappingsTable.companyId,
      bankAccountId: bankImportSourceMappingsTable.bankAccountId,
      providerName: bankImportSourceMappingsTable.providerName,
    })
    .from(bankImportSourceMappingsTable)
    .where(and(
      eq(bankImportSourceMappingsTable.sourceType, "google_sheet"),
      eq(bankImportSourceMappingsTable.sourceId, sourceId),
      eq(bankImportSourceMappingsTable.isActive, true),
      or(
        eq(bankImportSourceMappingsTable.worksheetName, worksheetName ?? ""),
        isNull(bankImportSourceMappingsTable.worksheetName),
      ),
    ))
    .orderBy(desc(bankImportSourceMappingsTable.worksheetName))
    .limit(1)
    .catch(() => []);
  const mapping = rows[0];
  if (
    !mapping ||
    !(await validateCompanyId(mapping.companyId)) ||
    !(await validateSettlementBankAccount(mapping.companyId, mapping.bankAccountId))
  ) return null;
  return mapping;
}

export async function getEnvironmentIdentity(companyId?: number | null, marker?: string) {
  const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.DATABASE_URL ?? "";
  let host = "unconfigured";
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    // Do not expose malformed connection strings.
  }
  const projectReference = host.match(/([a-z0-9]{20,})/)?.[1] ?? null;
  const databaseFingerprint = createHash("sha256").update(`${host}|${process.env.NODE_ENV ?? "unknown"}`).digest("hex").slice(0, 12);
  let uatMarkerActive = false;
  if (marker) {
    const result = await db.execute(sql`
      SELECT EXISTS(
               SELECT 1
                 FROM sport_center.sport_payments
                WHERE uat_marker = ${marker}
             )
          OR EXISTS(
               SELECT 1
                 FROM sport_center.bank_mutations
                WHERE uat_marker = ${marker}
             ) AS active
    `).catch(() => ({ rows: [] }));
    uatMarkerActive = Boolean((result as any).rows?.[0]?.active);
  }
  return {
    appEnv: process.env.NODE_ENV ?? "unknown",
    databaseHost: host,
    projectReference,
    databaseFingerprint,
    companyId: companyId ?? null,
    uatMarkerActive,
    sourceSchema: "sport_center",
  };
}