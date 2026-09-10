import { db, taxSettingsTable, taxTransactionsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface TaxCalculation {
  dpp: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  taxCode: string;
}

export interface WithholdingTaxCalculation {
  enabled: boolean;
  rate: number;
  amount: number;
  grossAmount: number;
  netAmount: number;
}

/**
 * PPh dipotong dari DPP, bukan dari PPN. Gross tetap menjadi nilai invoice/
 * booking, sedangkan netAmount adalah nominal yang benar-benar dibayar oleh
 * perusahaan yang mengaktifkan pemotongan.
 */
export function calculateWithholdingTax(
  grossAmount: number,
  dpp: number,
  enabled: boolean,
  rate = 10,
): WithholdingTaxCalculation {
  const normalizedRate = enabled ? Math.max(0, Math.min(100, Number(rate) || 0)) : 0;
  const amount = normalizedRate > 0 ? Math.round(Math.max(0, dpp) * normalizedRate / 100) : 0;
  return {
    enabled: normalizedRate > 0,
    rate: normalizedRate,
    amount,
    grossAmount: Math.max(0, Math.round(grossAmount)),
    netAmount: Math.max(0, Math.round(grossAmount) - amount),
  };
}

export async function resolveWithholdingTax(
  companyCustomerId: number | null | undefined,
  grossAmount: number,
  dpp: number,
): Promise<WithholdingTaxCalculation> {
  if (companyCustomerId == null) {
    return calculateWithholdingTax(grossAmount, dpp, false);
  }
  const [company] = await db
    .select({
      withholdingTaxEnabled: usersTable.withholdingTaxEnabled,
      withholdingTaxRate: usersTable.withholdingTaxRate,
    })
    .from(usersTable)
    .where(eq(usersTable.id, companyCustomerId))
    .limit(1);
  return calculateWithholdingTax(
    grossAmount,
    dpp,
    company?.withholdingTaxEnabled === true,
    Number(company?.withholdingTaxRate ?? 10),
  );
}

/**
 * Calculate PPN for a given subtotal.
 *
 * Backward-compatibility rules:
 * - If the tax setting has `effectiveDate` set, PPN is only applied when
 *   `bookingDate >= effectiveDate`. Bookings before that date get zero tax,
 *   preserving historical data integrity.
 * - If `effectiveDate` is null/empty, PPN is always applied (legacy behaviour).
 * - If no active tax setting exists, returns zero-tax result.
 */
export async function calculateTax(
  subtotal: number,
  appliesTo: string = "sport_booking",
  bookingDate?: string,
): Promise<TaxCalculation> {
  const noTax: TaxCalculation = { dpp: subtotal, taxRate: 0, taxAmount: 0, grandTotal: subtotal, taxCode: "" };

  const [setting] = await db
    .select()
    .from(taxSettingsTable)
    .where(and(eq(taxSettingsTable.appliesTo, appliesTo), eq(taxSettingsTable.isActive, true)))
    .limit(1);

  if (!setting) return noTax;

  // Backward-compatibility: if effectiveDate is configured, honour it.
  if (setting.effectiveDate && bookingDate) {
    if (bookingDate < setting.effectiveDate) return noTax;
  }

  const rate = Number(setting.taxRate);
  // Harga sudah termasuk PPN (inklusif): ekstrak DPP dari harga
  const dpp = Math.round(subtotal / (1 + rate / 100));
  const taxAmount = subtotal - dpp;
  return {
    dpp,
    taxRate: rate,
    taxAmount,
    grandTotal: subtotal,
    taxCode: setting.taxCode,
  };
}

export async function recordTaxTransaction(
  referenceType: "booking" | "company_invoice",
  referenceId: number,
  referenceNumber: string,
  taxCalc: TaxCalculation,
  transactionDate: string,
  status: "posted" | "reversed" = "posted",
  transactionType: "original" | "reversal" = "original",
  reversalOfId?: number
): Promise<number | null> {
  if (!taxCalc.taxCode || taxCalc.taxAmount === 0) return null;
  const dppNilaiLain = taxCalc.dpp > 0 ? Math.round(taxCalc.dpp * 11 / 12) : 0;
  const [row] = await db.insert(taxTransactionsTable).values({
    referenceType,
    referenceId,
    referenceNumber,
    taxCode: taxCalc.taxCode,
    taxRate: String(taxCalc.taxRate),
    dpp: String(taxCalc.dpp),
    dppNilaiLain: String(dppNilaiLain),
    grandTotal: String(taxCalc.grandTotal),
    taxAmount: String(taxCalc.taxAmount),
    transactionDate,
    status,
    transactionType,
    reversalOfId: reversalOfId ?? null,
  }).returning({ id: taxTransactionsTable.id });
  return row?.id ?? null;
}

export async function reverseTaxTransaction(
  referenceId: number,
  referenceNumber: string,
  transactionDate: string
): Promise<void> {
  const [original] = await db
    .select()
    .from(taxTransactionsTable)
    .where(
      and(
        eq(taxTransactionsTable.referenceId, referenceId),
        eq(taxTransactionsTable.transactionType, "original"),
        eq(taxTransactionsTable.status, "posted")
      )
    )
    .limit(1);

  if (!original) return;

  await db.insert(taxTransactionsTable).values({
    referenceType: original.referenceType as "booking" | "company_invoice",
    referenceId: original.referenceId,
    referenceNumber,
    taxCode: original.taxCode,
    taxRate: original.taxRate,
    dpp: String(-Math.abs(Number(original.dpp))),
    taxAmount: String(-Math.abs(Number(original.taxAmount))),
    transactionDate,
    status: "reversed",
    transactionType: "reversal",
    reversalOfId: original.id,
  });

  await db
    .update(taxTransactionsTable)
    .set({ status: "reversed" })
    .where(eq(taxTransactionsTable.id, original.id));
}

/**
 * Get the current PPN configuration for admin display/editing.
 */
export async function getPpnConfig(): Promise<{
  enabled: boolean;
  taxRate: number;
  taxCode: string;
  taxName: string;
  effectiveDate: string | null;
}> {
  const [setting] = await db
    .select()
    .from(taxSettingsTable)
    .where(eq(taxSettingsTable.appliesTo, "sport_booking"))
    .limit(1);

  if (!setting) {
    return { enabled: false, taxRate: 11, taxCode: "PPN_OUT_11", taxName: "PPN Keluaran 11%", effectiveDate: null };
  }
  return {
    enabled: setting.isActive,
    taxRate: Number(setting.taxRate),
    taxCode: setting.taxCode,
    taxName: setting.taxName,
    effectiveDate: setting.effectiveDate ?? null,
  };
}
