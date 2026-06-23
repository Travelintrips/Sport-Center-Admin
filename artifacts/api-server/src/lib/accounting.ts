import { db, accountingJournalsTable, accountingJournalLinesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

async function postJournalLines(
  journalId: number,
  lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }>,
): Promise<void> {
  if (!lines.length) return;
  await db.insert(accountingJournalLinesTable).values(
    lines.map((l) => ({
      journalId,
      lineType: l.lineType,
      accountCode: l.accountCode,
      accountName: l.accountName,
      amount: String(l.amount),
      description: l.description ?? null,
    })),
  );
}

export async function createJournalEntry(
  bookingId: number,
  orderNumber: string,
  subtotal: number,
  ppnAmount: number,
  journalDate: string,
): Promise<void> {
  const grandTotal = subtotal + ppnAmount;

  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
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
    })
    .returning();

  if (!journal) return;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [
    { lineType: "debit",  accountCode: "1-1001", accountName: "Kas/Bank",               amount: grandTotal, description: `Penerimaan booking ${orderNumber}` },
    { lineType: "credit", accountCode: "4-1001", accountName: "Pendapatan Sport Center", amount: subtotal,   description: `Pendapatan booking ${orderNumber}` },
  ];
  if (ppnAmount > 0) {
    lines.push({ lineType: "credit", accountCode: "2-1101", accountName: "PPN Keluaran", amount: ppnAmount, description: `PPN 12% booking ${orderNumber}` });
  }

  await postJournalLines(journal.id, lines);
}

export async function createExpenseJournalEntry(
  expenseNo: string,
  category: string,
  amount: number,
  ppnAmount: number,
  totalAmount: number,
  paymentMethod: string,
  description: string,
  journalDate: string,
): Promise<number> {
  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId: null,
      orderNumber: expenseNo,
      journalType: "expense_paid",
      debitAccount: category,
      debitAmount: String(ppnAmount > 0 ? amount : totalAmount),
      creditRevenueAccount: `Kas/Bank (${paymentMethod})`,
      creditRevenueAmount: String(totalAmount),
      creditPpnAccount: "PPN Masukan",
      creditPpnAmount: String(ppnAmount),
      journalDate,
      isReversal: false,
      notes: `Pengeluaran ${expenseNo}: ${description}`,
    })
    .returning();

  if (!journal) return 0;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [
    { lineType: "debit", accountCode: "6-0001", accountName: category, amount, description: `Beban ${expenseNo}` },
  ];
  if (ppnAmount > 0) {
    lines.push({ lineType: "debit", accountCode: "2-1201", accountName: "PPN Masukan", amount: ppnAmount, description: `PPN Masukan ${expenseNo}` });
  }
  lines.push({ lineType: "credit", accountCode: "1-1001", accountName: `Kas/Bank (${paymentMethod})`, amount: totalAmount, description: `Pembayaran ${expenseNo}` });

  await postJournalLines(journal.id, lines);
  return journal.id;
}

export async function reverseJournalEntry(
  bookingId: number,
  orderNumber: string,
  reason: string,
  journalDate: string,
): Promise<void> {
  const [original] = await db
    .select()
    .from(accountingJournalsTable)
    .where(
      and(
        eq(accountingJournalsTable.bookingId, bookingId),
        eq(accountingJournalsTable.isReversal, false),
      ),
    )
    .limit(1);

  if (!original) return;

  const [reversal] = await db
    .insert(accountingJournalsTable)
    .values({
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
    })
    .returning();

  if (!reversal) return;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [
    { lineType: "debit",  accountCode: "4-1001", accountName: "Pendapatan Sport Center", amount: Number(original.creditRevenueAmount), description: `Reversal: ${reason}` },
    { lineType: "credit", accountCode: "1-1001", accountName: "Kas/Bank",                amount: Number(original.debitAmount),          description: `Reversal: ${reason}` },
  ];
  if (Number(original.creditPpnAmount) > 0) {
    lines.push({ lineType: "debit", accountCode: "2-1101", accountName: "PPN Keluaran", amount: Number(original.creditPpnAmount), description: `Reversal PPN: ${reason}` });
  }

  await postJournalLines(reversal.id, lines);
}
