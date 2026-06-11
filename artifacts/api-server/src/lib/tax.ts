import { db, taxSettingsTable, taxTransactionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface TaxCalculation {
  dpp: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  taxCode: string;
}

export async function calculateTax(
  subtotal: number,
  appliesTo: string = "sport_center_booking"
): Promise<TaxCalculation> {
  const [setting] = await db
    .select()
    .from(taxSettingsTable)
    .where(and(eq(taxSettingsTable.appliesTo, appliesTo), eq(taxSettingsTable.isActive, true)))
    .limit(1);

  if (!setting) {
    return { dpp: subtotal, taxRate: 0, taxAmount: 0, grandTotal: subtotal, taxCode: "" };
  }

  const rate = Number(setting.taxRate);
  const taxAmount = Math.round(subtotal * rate / 100);
  return {
    dpp: subtotal,
    taxRate: rate,
    taxAmount,
    grandTotal: subtotal + taxAmount,
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
  const [row] = await db.insert(taxTransactionsTable).values({
    referenceType,
    referenceId,
    referenceNumber,
    taxCode: taxCalc.taxCode,
    taxRate: String(taxCalc.taxRate),
    dpp: String(taxCalc.dpp),
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
