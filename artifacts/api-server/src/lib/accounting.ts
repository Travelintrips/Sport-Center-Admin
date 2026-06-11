import { db, accountingJournalsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export async function createJournalEntry(
  bookingId: number,
  orderNumber: string,
  subtotal: number,
  ppnAmount: number,
  journalDate: string
): Promise<void> {
  const grandTotal = subtotal + ppnAmount;
  await db.insert(accountingJournalsTable).values({
    bookingId,
    orderNumber,
    journalType: "payment_confirmed",
    debitAccount: "Kas/Bank",
    debitAmount: String(grandTotal),
    creditRevenueAccount: "Pendapatan Sport Center",
    creditRevenueAmount: String(subtotal),
    creditPpnAccount: "PPN Keluaran",
    creditPpnAmount: String(ppnAmount),
    journalDate,
    isReversal: false,
    notes: `Pembayaran dikonfirmasi untuk booking ${orderNumber}`,
  });
}

export async function reverseJournalEntry(
  bookingId: number,
  orderNumber: string,
  reason: string,
  journalDate: string
): Promise<void> {
  const [original] = await db
    .select()
    .from(accountingJournalsTable)
    .where(
      and(
        eq(accountingJournalsTable.bookingId, bookingId),
        eq(accountingJournalsTable.isReversal, false)
      )
    )
    .limit(1);

  if (!original) return;

  await db.insert(accountingJournalsTable).values({
    bookingId,
    orderNumber,
    journalType: "reversal",
    debitAccount: original.creditRevenueAccount,
    debitAmount: original.debitAmount,
    creditRevenueAccount: original.debitAccount,
    creditRevenueAmount: original.creditRevenueAmount,
    creditPpnAccount: original.creditPpnAccount,
    creditPpnAmount: original.creditPpnAmount,
    journalDate,
    isReversal: true,
    reversalOfId: original.id,
    notes: reason,
  });
}
