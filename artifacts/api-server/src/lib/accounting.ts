import { db, accountingJournalsTable, accountingJournalLinesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

// ─── Public Accounting (public.accounting_entries) ───────────────────────────
const PUBLIC_JOURNAL_ID = 8099;        // CSH-CST (Kas) — id=8099 di public.accounting_journals
const COA_KAS_CST = 49097;             // 1-1010-CST  Kas CST
const COA_PENDAPATAN_BOOKING = 72354;  // 4-1017-CST  Pendapatan Booking Sport Center CST
const COA_PPN_KELUARAN = 49109;        // PPN Keluaran — account_id di public.accounting_taxes id=1
const TAX_ID_PPN_11 = 1;              // id di public.accounting_taxes (PPN Keluaran 11%)
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
  const hasPpn = ppnAmount > 0;
  const year = new Date(journalDate).getFullYear();
  const period = journalDate.slice(0, 7); // YYYY-MM
  const entryNumber = await nextPublicEntryNumber(year);

  // 1. Buat accounting entry (draft)
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

  // 2. Baris GL: Kas (debit), Pendapatan (kredit), PPN Keluaran (kredit jika ada)
  if (hasPpn) {
    await db.execute(sql`
      INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        (${entryId}, ${COA_KAS_CST},           ${'Penerimaan booking ' + orderNumber}, ${grandTotal}, 0),
        (${entryId}, ${COA_PENDAPATAN_BOOKING}, ${'Pendapatan booking ' + orderNumber}, 0, ${subtotal}),
        (${entryId}, ${COA_PPN_KELUARAN},       ${'PPN Keluaran booking ' + orderNumber}, 0, ${ppnAmount})
    `);
  } else {
    await db.execute(sql`
      INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        (${entryId}, ${COA_KAS_CST},           ${'Penerimaan booking ' + orderNumber}, ${grandTotal}, 0),
        (${entryId}, ${COA_PENDAPATAN_BOOKING}, ${'Pendapatan booking ' + orderNumber}, 0, ${subtotal})
    `);
  }

  // 3. Post entry
  await db.execute(sql`UPDATE public.accounting_entries SET status = 'posted' WHERE id = ${entryId}`);

  // 4. public.transaction_taxes — hanya jika ada PPN
  if (hasPpn) {
    await db.execute(sql`
      INSERT INTO public.transaction_taxes
        (company_id, transaction_type, transaction_id, transaction_ref,
         tax_id, tax_name, tax_rate, cut_type,
         base_amount, tax_amount, account_id,
         period, status, direction, created_at, updated_at)
      VALUES (
        ${COMPANY_ID}, 'sport_center_booking', ${bookingId}, ${orderNumber},
        ${TAX_ID_PPN_11}, 'PPN Keluaran 11%', 11, 'self_borne',
        ${subtotal}, ${ppnAmount}, ${COA_PPN_KELUARAN},
        ${period}, 'posted', 'out', NOW(), NOW()
      )
    `);

    // 5. public.gl_tax_lines — terhubung ke accounting_entry_id
    await db.execute(sql`
      INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period,
         entity_type, entity_id, is_reported, created_at)
      VALUES (
        ${COMPANY_ID}, ${entryId}, 'PPN_OUT', 11,
        ${subtotal}, ${ppnAmount}, 'out', ${period},
        'booking', ${orderNumber}, false, NOW()
      )
    `);
  }
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
  const period = journalDate.slice(0, 7);
  const entryNumber = await nextPublicEntryNumber(year);

  // 1. Reversal accounting entry (draft)
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

  // 2. Swap debit/kredit dari lines asli
  await db.execute(sql`
    INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit)
    SELECT ${revId}, account_id, ${'Reversal: ' + reason}, credit, debit
    FROM public.accounting_entry_lines WHERE entry_id = ${original.id}
  `);

  // 3. Post reversal entry
  await db.execute(sql`UPDATE public.accounting_entries SET status = 'posted' WHERE id = ${revId}`);

  // 4. Reverse transaction_taxes — tandai yang asli jadi 'reversed', insert baris negasi
  const taxResult = await db.execute(sql`
    SELECT id, base_amount, tax_amount, tax_rate FROM public.transaction_taxes
    WHERE transaction_type = 'sport_center_booking' AND transaction_ref = ${orderNumber} AND status = 'posted'
    LIMIT 1
  `);
  if (taxResult.rows.length) {
    const origTax = taxResult.rows[0] as any;
    await db.execute(sql`
      UPDATE public.transaction_taxes SET status = 'reversed', updated_at = NOW()
      WHERE id = ${origTax.id}
    `);
    await db.execute(sql`
      INSERT INTO public.transaction_taxes
        (company_id, transaction_type, transaction_id, transaction_ref,
         tax_id, tax_name, tax_rate, cut_type,
         base_amount, tax_amount, account_id,
         period, status, direction, created_at, updated_at)
      VALUES (
        ${COMPANY_ID}, 'sport_center_booking_reversal', ${revId}, ${orderNumber},
        ${TAX_ID_PPN_11}, 'PPN Keluaran 11% (Reversal)', ${origTax.tax_rate}, 'self_borne',
        ${-Math.abs(Number(origTax.base_amount))}, ${-Math.abs(Number(origTax.tax_amount))},
        ${COA_PPN_KELUARAN},
        ${period}, 'reversed', 'out', NOW(), NOW()
      )
    `);

    // 5. Reversal gl_tax_lines
    await db.execute(sql`
      INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period,
         entity_type, entity_id, is_reported, created_at)
      SELECT
        ${COMPANY_ID}, ${revId}, tax_type, rate,
        -ABS(base_amount), -ABS(tax_amount), direction, ${period},
        entity_type, entity_id, false, NOW()
      FROM public.gl_tax_lines WHERE accounting_entry_id = ${original.id}
    `);
  }
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

// ─── COA-based journal type detection ─────────────────────────────────────────
export type ExpenseJournalType =
  | "operational"   // Beban operasional → Debit Beban, Kredit Kas/Bank
  | "liability"     // Bayar hutang/pinjaman → Debit Hutang/Kewajiban, Kredit Kas/Bank
  | "kasbon"        // Kasbon karyawan → Debit Piutang Kasbon, Kredit Kas/Bank
  | "kasbon_settlement" // Pertanggungjawaban kasbon → Debit Beban, Kredit Piutang Kasbon

export function detectJournalType(accountType: string): ExpenseJournalType {
  if (accountType === "liability") return "liability";
  if (accountType === "asset") return "kasbon";
  return "operational";
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
  coaAccountCode?: string,
  coaAccountName?: string,
  coaAccountType?: string,
): Promise<number> {
  const effectiveAccountCode = coaAccountCode ?? "6-0001";
  const effectiveAccountName = coaAccountName ?? category;
  const journalType = coaAccountType ? detectJournalType(coaAccountType) : "operational";
  const kasSource = `Kas/Bank (${paymentMethod})`;

  // Determine journal lines based on account type
  let debitAccount = effectiveAccountName;
  let creditAccount = kasSource;
  let journalNotes = `Pengeluaran ${expenseNo}: ${description}`;
  let journalTypeLabel = "expense_paid";

  if (journalType === "liability") {
    journalTypeLabel = "expense_paid_liability";
    journalNotes = `Pembayaran hutang/pinjaman ${expenseNo}: ${description}`;
  } else if (journalType === "kasbon") {
    journalTypeLabel = "expense_paid_kasbon";
    debitAccount = effectiveAccountName;
    journalNotes = `Kasbon karyawan ${expenseNo}: ${description}`;
  }

  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId: null,
      orderNumber: expenseNo,
      journalType: journalTypeLabel,
      debitAccount,
      debitAmount: String(ppnAmount > 0 ? amount : totalAmount),
      creditRevenueAccount: creditAccount,
      creditRevenueAmount: String(totalAmount),
      creditPpnAccount: ppnAmount > 0 ? "PPN Masukan" : null,
      creditPpnAmount: String(ppnAmount),
      journalDate,
      isReversal: false,
      notes: journalNotes,
    })
    .returning();

  if (!journal) return 0;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [];

  if (journalType === "operational") {
    // Debit Beban, Debit PPN Masukan (jika ada), Kredit Kas/Bank
    lines.push({ lineType: "debit", accountCode: effectiveAccountCode, accountName: effectiveAccountName, amount, description: `Beban ${expenseNo}` });
    if (ppnAmount > 0) {
      lines.push({ lineType: "debit", accountCode: "2-1201", accountName: "PPN Masukan", amount: ppnAmount, description: `PPN Masukan ${expenseNo}` });
    }
    lines.push({ lineType: "credit", accountCode: "1-1001", accountName: kasSource, amount: totalAmount, description: `Pembayaran ${expenseNo}` });

  } else if (journalType === "liability") {
    // Debit Hutang/Kewajiban, Kredit Kas/Bank
    lines.push({ lineType: "debit", accountCode: effectiveAccountCode, accountName: effectiveAccountName, amount: totalAmount, description: `Bayar hutang ${expenseNo}` });
    lines.push({ lineType: "credit", accountCode: "1-1001", accountName: kasSource, amount: totalAmount, description: `Pembayaran ${expenseNo}` });

  } else if (journalType === "kasbon") {
    // Debit Piutang Kasbon (Aset), Kredit Kas/Bank
    lines.push({ lineType: "debit", accountCode: effectiveAccountCode, accountName: effectiveAccountName, amount: totalAmount, description: `Kasbon diberikan ${expenseNo}` });
    lines.push({ lineType: "credit", accountCode: "1-1001", accountName: kasSource, amount: totalAmount, description: `Kas keluar kasbon ${expenseNo}` });
  }

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
