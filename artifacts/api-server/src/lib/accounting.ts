import { db, accountingJournalsTable, accountingJournalLinesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

// ─── Public Accounting (public.accounting_entries) ───────────────────────────
const PUBLIC_JOURNAL_ID = 8099;        // CSH-CST (Kas) — id=8099 di public.accounting_journals
const COA_KAS_CST = 49097;             // 1-1010-CST  Kas CST
const COA_PENDAPATAN_BOOKING = 72354;  // 4-1017-CST  Pendapatan Booking Sport Center CST
const COMPANY_ID = 1;

async function nextPublicEntryNumber(year: number): Promise<string> {
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(
      NULLIF(REGEXP_REPLACE(entry_number, '^CSH-CST/[0-9]+/', ''), '')::integer
    ), 0) + 1 AS seq
    FROM public.accounting_entries
    WHERE entry_number LIKE ${'CSH-CST/' + year + '/%'}
  `);
  const seq = Number((result.rows[0] as any).seq ?? 1);
  return `CSH-CST/${year}/${String(seq).padStart(4, "0")}`;
}

export async function createPublicAccountingEntry(
  bookingId: number,
  orderNumber: string,
  subtotal: number,
  ppnAmount: number,
  facilityId: number | null,
  journalDate: string,
): Promise<void> {
  const grandTotal = subtotal + ppnAmount;
  const year = new Date(journalDate).getFullYear();
  const entryNumber = await nextPublicEntryNumber(year);

  const entryResult = await db.execute(sql`
    INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, facility_id, correlation_id, governance_flags)
    VALUES (
      ${entryNumber}, ${PUBLIC_JOURNAL_ID}, ${journalDate}::date, ${orderNumber},
      ${'Pembayaran Booking Sport Center (' + orderNumber + ')'}, 'draft',
      'sport_center_booking', ${bookingId},
      ${grandTotal}, ${grandTotal}, ${COMPANY_ID}, ${facilityId ?? null},
      ${'sc_booking_' + orderNumber}, '{}'
    )
    RETURNING id
  `);
  const entryId = Number((entryResult.rows[0] as any).id);

  await db.execute(sql`
    INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
      (${entryId}, ${COA_KAS_CST},            ${'Penerimaan booking ' + orderNumber}, ${grandTotal}, 0),
      (${entryId}, ${COA_PENDAPATAN_BOOKING},  ${'Pendapatan booking ' + orderNumber}, 0, ${subtotal})
  `);

  await db.execute(sql`UPDATE public.accounting_entries SET status = 'posted' WHERE id = ${entryId}`);
}

export async function reversePublicAccountingEntry(
  orderNumber: string,
  reason: string,
  journalDate: string,
): Promise<void> {
  const originalResult = await db.execute(sql`
    SELECT id, total_debit, total_credit FROM public.accounting_entries
    WHERE source = 'sport_center_booking' AND ref = ${orderNumber} AND status = 'posted'
    LIMIT 1
  `);
  if (!originalResult.rows.length) return;

  const original = originalResult.rows[0] as any;
  const year = new Date(journalDate).getFullYear();
  const entryNumber = await nextPublicEntryNumber(year);

  const revResult = await db.execute(sql`
    INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, correlation_id, governance_flags)
    VALUES (
      ${entryNumber}, ${PUBLIC_JOURNAL_ID}, ${journalDate}::date, ${orderNumber},
      ${'Reversal Booking ' + orderNumber + ': ' + reason}, 'draft',
      'sport_center_booking_reversal', ${original.id},
      ${original.total_debit}, ${original.total_credit}, ${COMPANY_ID},
      ${'sc_reversal_' + orderNumber}, '{}'
    )
    RETURNING id
  `);
  const revId = Number((revResult.rows[0] as any).id);

  await db.execute(sql`
    INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit)
    SELECT ${revId}, account_id, ${'Reversal: ' + reason}, credit, debit
    FROM public.accounting_entry_lines WHERE entry_id = ${original.id}
  `);

  await db.execute(sql`UPDATE public.accounting_entries SET status = 'posted' WHERE id = ${revId}`);
}

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
