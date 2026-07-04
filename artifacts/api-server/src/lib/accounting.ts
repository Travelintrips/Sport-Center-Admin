import { db, accountingJournalsTable, accountingJournalLinesTable, taxTransactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import pg from "pg";

// ─── Public Accounting (public.accounting_entries) ───────────────────────────
// Gunakan direct pg.Pool ke Supabase (PROD atau DEV fallback).
// db Drizzle hanya konek ke sport_center schema; public.accounting_entries ada di shared Supabase.
const SHARED_DB_URL =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;

let _publicPool: pg.Pool | null = null;
function getPublicPool(): pg.Pool | null {
  if (!SHARED_DB_URL) return null;
  if (!_publicPool) {
    _publicPool = new pg.Pool({
      connectionString: SHARED_DB_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return _publicPool;
}

const TAX_ID_PPN_11 = 1;
const COMPANY_ID = 1;

// Cache COA/journal IDs dari public schema
let _publicIds: {
  journalId: number;
  coaKas: number;
  coaPendapatan: number;
  coaPpnKeluaran: number;
  taxIdPpn: number;
} | null = null;

async function getPublicIds() {
  if (_publicIds) return _publicIds;

  const pool = getPublicPool();
  if (!pool) throw new Error("[accounting] Tidak ada Supabase URL — tidak bisa write ke public.accounting_entries");

  const [journal, kas, pendapatan, ppn, tax] = await Promise.all([
    pool.query(`SELECT id FROM public.accounting_journals WHERE code = 'BNK-CST' LIMIT 1`),
    pool.query(`SELECT id FROM public.chart_of_accounts WHERE code = '1-1020-CST' AND is_active = true LIMIT 1`),
    pool.query(`SELECT id FROM public.chart_of_accounts WHERE code = '4-1017-CST' AND is_active = true LIMIT 1`),
    pool.query(`SELECT id FROM public.chart_of_accounts WHERE code = '2-1020-CST' AND is_active = true LIMIT 1`),
    pool.query(`SELECT id FROM public.accounting_taxes WHERE name ILIKE '%PPN Keluaran%' AND company_id = $1 ORDER BY id LIMIT 1`, [COMPANY_ID]),
  ]);

  const journalId = Number(journal.rows[0]?.id);
  const coaKas = Number(kas.rows[0]?.id);
  const coaPendapatan = Number(pendapatan.rows[0]?.id);
  const coaPpnKeluaran = Number(ppn.rows[0]?.id);
  const taxIdPpn = Number(tax.rows[0]?.id ?? 1);

  if (!journalId || !coaKas || !coaPendapatan || !coaPpnKeluaran) {
    throw new Error(
      `[accounting] Public COA/journal lookup gagal. ` +
      `journalId=${journalId} coaKas=${coaKas} coaPendapatan=${coaPendapatan} coaPpnKeluaran=${coaPpnKeluaran}. ` +
      `Pastikan public.accounting_journals code=BNK-CST dan chart_of_accounts 1-1020-CST, 4-1017-CST, 2-1020-CST ada.`
    );
  }

  _publicIds = { journalId, coaKas, coaPendapatan, coaPpnKeluaran, taxIdPpn };
  return _publicIds;
}

async function nextPublicEntryNumber(pool: pg.Pool, year: number): Promise<string> {
  const result = await pool.query(
    `SELECT COALESCE(MAX(
      NULLIF(REGEXP_REPLACE(entry_number, '^SC-BNK/[0-9]+/', ''), '')::integer
    ), 0) + 1 AS seq
    FROM public.accounting_entries
    WHERE entry_number LIKE $1`,
    [`SC-BNK/${year}/%`]
  );
  const seq = Number(result.rows[0]?.seq ?? 1);
  return `SC-BNK/${year}/${String(seq).padStart(4, "0")}`;
}

export async function createPublicAccountingEntry(
  bookingId: number,
  orderNumber: string,
  subtotal: number,
  ppnAmount: number,
  facilityId: number | null,
  journalDate: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip createPublicAccountingEntry");
    return;
  }

  // subtotal = DPP (harga sebelum PPN), ppnAmount = PPN 11%
  // grandTotal = jumlah yang diterima dari customer (masuk ke Bank Mandiri CST)
  // netRevenue = DPP = subtotal (pendapatan bersih, tidak termasuk PPN)
  const grandTotal = subtotal + ppnAmount;
  const netRevenue = subtotal;
  const hasPpn = ppnAmount > 0;
  const year = new Date(journalDate).getFullYear();
  const period = journalDate.slice(0, 7);
  const entryNumber = await nextPublicEntryNumber(pool, year);
  const ids = await getPublicIds();

  // 1. Buat accounting entry (draft)
  const entryResult = await pool.query(
    `INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, facility_id, correlation_id, governance_flags)
    VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_booking',$6,$7,$7,$8,$9,$10,'{}')
    RETURNING id`,
    [
      entryNumber, ids.journalId, journalDate, orderNumber,
      `Pembayaran Booking Sport Center (${orderNumber})`,
      bookingId, grandTotal, COMPANY_ID, facilityId ?? null,
      `sc_booking_${orderNumber}`,
    ]
  );
  const entryId = Number(entryResult.rows[0]?.id);

  // 2. Baris GL: Kas (debit), Pendapatan net (kredit), PPN Keluaran (kredit jika ada)
  if (hasPpn) {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$7),
        ($1,$8,$9,0,$10)`,
      [
        entryId,
        ids.coaKas,         `Penerimaan booking ${orderNumber}`, grandTotal,
        ids.coaPendapatan,  `Pendapatan booking ${orderNumber}`, netRevenue,
        ids.coaPpnKeluaran, `PPN Keluaran booking ${orderNumber}`, ppnAmount,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$4)`,
      [entryId, ids.coaKas, `Penerimaan booking ${orderNumber}`, grandTotal, ids.coaPendapatan, `Pendapatan booking ${orderNumber}`]
    );
  }

  // 3. Post entry
  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);

  // 4. sport_center.tax_transactions — hanya jika ada PPN
  if (hasPpn) {
    await db.insert(taxTransactionsTable).values({
      referenceType: "sport_center_booking",
      referenceId: bookingId,
      referenceNumber: orderNumber,
      taxCode: "PPN_OUT_11",
      taxRate: "11",
      dpp: String(subtotal),
      dppNilaiLain: String(Math.round((subtotal * 11) / 12 * 100) / 100),
      grandTotal: String(grandTotal),
      taxAmount: String(ppnAmount),
      transactionDate: period,
      status: "posted",
      transactionType: "original",
    });

    // 5. public.gl_tax_lines
    await pool.query(
      `INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period, entity_type, entity_id, is_reported, created_at)
      VALUES ($1,$2,'PPN_OUT',11,$3,$4,'out',$5,'booking',$6,false,NOW())`,
      [COMPANY_ID, entryId, subtotal, ppnAmount, period, orderNumber]
    );
  }

  console.info(`[accounting] ✓ Public accounting entry created: ${entryNumber} (${orderNumber})`);
}

// ─── Public Accounting: Member Gym & Invoice Perusahaan ──────────────────────
// Sama seperti createPublicAccountingEntry (booking), tapi untuk sumber
// pendapatan lain yang juga masuk ke Bank Mandiri CST: membership gym & invoice
// perusahaan. Tidak terkait facilityId (null).

export async function createPublicMembershipAccountingEntry(
  membershipId: number,
  refNumber: string,
  amount: number,
  journalDate: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip createPublicMembershipAccountingEntry");
    return;
  }

  const year = new Date(journalDate).getFullYear();
  const entryNumber = await nextPublicEntryNumber(pool, year);
  const ids = await getPublicIds();

  const entryResult = await pool.query(
    `INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, facility_id, correlation_id, governance_flags)
    VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_membership',$6,$7,$7,$8,NULL,$9,'{}')
    RETURNING id`,
    [
      entryNumber, ids.journalId, journalDate, refNumber,
      `Pembayaran Member Gym Sport Center (${refNumber})`,
      membershipId, amount, COMPANY_ID,
      `sc_membership_${refNumber}`,
    ]
  );
  const entryId = Number(entryResult.rows[0]?.id);

  await pool.query(
    `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
      ($1,$2,$3,$4,0),
      ($1,$5,$6,0,$4)`,
    [entryId, ids.coaKas, `Penerimaan member gym ${refNumber}`, amount, ids.coaPendapatan, `Pendapatan member gym ${refNumber}`]
  );

  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);

  console.info(`[accounting] ✓ Public accounting entry created (membership): ${entryNumber} (${refNumber})`);
}

export async function createPublicInvoiceAccountingEntry(
  invoiceId: number,
  invoiceNumber: string,
  subtotal: number,
  ppnAmount: number,
  journalDate: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip createPublicInvoiceAccountingEntry");
    return;
  }

  const grandTotal = subtotal + ppnAmount;
  const netRevenue = subtotal;
  const hasPpn = ppnAmount > 0;
  const year = new Date(journalDate).getFullYear();
  const period = journalDate.slice(0, 7);
  const entryNumber = await nextPublicEntryNumber(pool, year);
  const ids = await getPublicIds();

  const entryResult = await pool.query(
    `INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, facility_id, correlation_id, governance_flags)
    VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_invoice',$6,$7,$7,$8,NULL,$9,'{}')
    RETURNING id`,
    [
      entryNumber, ids.journalId, journalDate, invoiceNumber,
      `Pembayaran Invoice Perusahaan (${invoiceNumber})`,
      invoiceId, grandTotal, COMPANY_ID,
      `sc_invoice_${invoiceNumber}`,
    ]
  );
  const entryId = Number(entryResult.rows[0]?.id);

  if (hasPpn) {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$7),
        ($1,$8,$9,0,$10)`,
      [
        entryId,
        ids.coaKas,         `Penerimaan invoice ${invoiceNumber}`, grandTotal,
        ids.coaPendapatan,  `Pendapatan invoice ${invoiceNumber}`, netRevenue,
        ids.coaPpnKeluaran, `PPN Keluaran invoice ${invoiceNumber}`, ppnAmount,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit) VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,0,$4)`,
      [entryId, ids.coaKas, `Penerimaan invoice ${invoiceNumber}`, grandTotal, ids.coaPendapatan, `Pendapatan invoice ${invoiceNumber}`]
    );
  }

  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [entryId]);

  if (hasPpn) {
    await db.insert(taxTransactionsTable).values({
      referenceType: "sport_center_invoice",
      referenceId: invoiceId,
      referenceNumber: invoiceNumber,
      taxCode: "PPN_OUT_11",
      taxRate: "11",
      dpp: String(subtotal),
      dppNilaiLain: String(Math.round((subtotal * 11) / 12 * 100) / 100),
      grandTotal: String(grandTotal),
      taxAmount: String(ppnAmount),
      transactionDate: period,
      status: "posted",
      transactionType: "original",
    });

    await pool.query(
      `INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period, entity_type, entity_id, is_reported, created_at)
      VALUES ($1,$2,'PPN_OUT',11,$3,$4,'out',$5,'company_invoice',$6,false,NOW())`,
      [COMPANY_ID, entryId, subtotal, ppnAmount, period, invoiceNumber]
    );
  }

  console.info(`[accounting] ✓ Public accounting entry created (invoice): ${entryNumber} (${invoiceNumber})`);
}

export async function reversePublicAccountingEntry(
  orderNumber: string,
  reason: string,
  journalDate: string,
): Promise<void> {
  const pool = getPublicPool();
  if (!pool) {
    console.warn("[accounting] Tidak ada Supabase URL — skip reversePublicAccountingEntry");
    return;
  }

  const originalResult = await pool.query(
    `SELECT id, total_debit, total_credit FROM public.accounting_entries
     WHERE source = 'sport_center_booking' AND ref = $1 AND status = 'posted' LIMIT 1`,
    [orderNumber]
  );
  if (!originalResult.rows.length) return;

  const original = originalResult.rows[0];
  const year = new Date(journalDate).getFullYear();
  const period = journalDate.slice(0, 7);
  const entryNumber = await nextPublicEntryNumber(pool, year);
  const ids = await getPublicIds();

  // 1. Reversal accounting entry (draft)
  const revResult = await pool.query(
    `INSERT INTO public.accounting_entries
      (entry_number, journal_id, date, ref, description, status, source, source_id,
       total_debit, total_credit, company_id, correlation_id, governance_flags)
    VALUES ($1,$2,$3::date,$4,$5,'draft','sport_center_booking_reversal',$6,$7,$7,$8,$9,'{}')
    RETURNING id`,
    [
      entryNumber, ids.journalId, journalDate, orderNumber,
      `Reversal Booking ${orderNumber}: ${reason}`,
      original.id, original.total_debit, COMPANY_ID,
      `sc_reversal_${orderNumber}`,
    ]
  );
  const revId = Number(revResult.rows[0]?.id);

  // 2. Swap debit/kredit dari lines asli
  await pool.query(
    `INSERT INTO public.accounting_entry_lines (entry_id, account_id, description, debit, credit)
     SELECT $1, account_id, $2, credit, debit FROM public.accounting_entry_lines WHERE entry_id = $3`,
    [revId, `Reversal: ${reason}`, original.id]
  );

  // 3. Post reversal entry
  await pool.query(`UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1`, [revId]);

  // 4. Reverse sport_center.tax_transactions
  const origTaxRows = await db
    .select()
    .from(taxTransactionsTable)
    .where(
      and(
        eq(taxTransactionsTable.referenceType, "sport_center_booking"),
        eq(taxTransactionsTable.referenceNumber, orderNumber),
        eq(taxTransactionsTable.status, "posted"),
      )
    )
    .limit(1);
  if (origTaxRows.length) {
    const origTax = origTaxRows[0];
    await db
      .update(taxTransactionsTable)
      .set({ status: "reversed" })
      .where(eq(taxTransactionsTable.id, origTax.id));
    await db.insert(taxTransactionsTable).values({
      referenceType: "sport_center_booking_reversal",
      referenceId: revId,
      referenceNumber: orderNumber,
      taxCode: "PPN_OUT_11",
      taxRate: origTax.taxRate,
      dpp: String(-Math.abs(Number(origTax.dpp))),
      taxAmount: String(-Math.abs(Number(origTax.taxAmount))),
      transactionDate: period,
      status: "reversed",
      transactionType: "reversal",
      reversalOfId: origTax.id,
    });

    // 5. Reversal gl_tax_lines
    await pool.query(
      `INSERT INTO public.gl_tax_lines
        (company_id, accounting_entry_id, tax_type, rate,
         base_amount, tax_amount, direction, period, entity_type, entity_id, is_reported, created_at)
       SELECT $1,$2,tax_type,rate,-ABS(base_amount),-ABS(tax_amount),direction,$3,
              entity_type,entity_id,false,NOW()
       FROM public.gl_tax_lines WHERE accounting_entry_id = $4`,
      [COMPANY_ID, revId, period, original.id]
    );
  }

  console.info(`[accounting] ✓ Public accounting entry reversed: ${entryNumber} (${orderNumber})`);
}

// ─── Sport Center Internal Journal (sport_center schema) ─────────────────────

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
  // subtotal = DPP (sebelum PPN), grandTotal = DPP + PPN = jumlah yang masuk ke bank
  const grandTotal = subtotal + ppnAmount;
  const netRevenue = subtotal;

  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId,
      orderNumber,
      journalType: "payment_confirmed",
      debitAccount: "Bank Mandiri",
      debitAmount: String(grandTotal),
      creditRevenueAccount: "Pendapatan Sport Center",
      creditRevenueAmount: String(ppnAmount > 0 ? netRevenue : grandTotal),
      creditPpnAccount: ppnAmount > 0 ? "PPN Keluaran" : "",
      creditPpnAmount: String(ppnAmount),
      journalDate,
      isReversal: false,
      notes: `Pembayaran dikonfirmasi untuk booking ${orderNumber}`,
    })
    .returning();

  if (!journal) return;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [
    { lineType: "debit",  accountCode: "1104", accountName: "Bank Mandiri",              amount: grandTotal,  description: `Penerimaan booking ${orderNumber}` },
    { lineType: "credit", accountCode: "4-1001", accountName: "Pendapatan Sport Center", amount: ppnAmount > 0 ? netRevenue : grandTotal, description: `Pendapatan booking ${orderNumber}` },
  ];
  if (ppnAmount > 0) {
    lines.push({ lineType: "credit", accountCode: "2-1101", accountName: "PPN Keluaran", amount: ppnAmount, description: `PPN 11% booking ${orderNumber}` });
  }

  await postJournalLines(journal.id, lines);
}

// ─── Sport Center Internal Journal: Member Gym & Invoice Perusahaan ──────────

export async function createMembershipJournalEntry(
  membershipId: number,
  refNumber: string,
  amount: number,
  journalDate: string,
): Promise<void> {
  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId: null,
      orderNumber: refNumber,
      journalType: "membership_payment_confirmed",
      debitAccount: "Bank Mandiri",
      debitAmount: String(amount),
      creditRevenueAccount: "Pendapatan Sport Center",
      creditRevenueAmount: String(amount),
      creditPpnAccount: "",
      creditPpnAmount: "0",
      journalDate,
      isReversal: false,
      notes: `Pembayaran dikonfirmasi untuk member gym ${refNumber}`,
    })
    .returning();

  if (!journal) return;

  await postJournalLines(journal.id, [
    { lineType: "debit",  accountCode: "1104", accountName: "Bank Mandiri",              amount, description: `Penerimaan member gym ${refNumber}` },
    { lineType: "credit", accountCode: "4-1001", accountName: "Pendapatan Sport Center", amount, description: `Pendapatan member gym ${refNumber}` },
  ]);
}

export async function createInvoiceJournalEntry(
  invoiceId: number,
  invoiceNumber: string,
  subtotal: number,
  ppnAmount: number,
  journalDate: string,
): Promise<void> {
  const grandTotal = subtotal + ppnAmount;
  const netRevenue = subtotal;

  const [journal] = await db
    .insert(accountingJournalsTable)
    .values({
      bookingId: null,
      orderNumber: invoiceNumber,
      journalType: "invoice_payment_confirmed",
      debitAccount: "Bank Mandiri",
      debitAmount: String(grandTotal),
      creditRevenueAccount: "Pendapatan Sport Center",
      creditRevenueAmount: String(ppnAmount > 0 ? netRevenue : grandTotal),
      creditPpnAccount: ppnAmount > 0 ? "PPN Keluaran" : "",
      creditPpnAmount: String(ppnAmount),
      journalDate,
      isReversal: false,
      notes: `Pembayaran dikonfirmasi untuk invoice perusahaan ${invoiceNumber}`,
    })
    .returning();

  if (!journal) return;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [
    { lineType: "debit",  accountCode: "1104", accountName: "Bank Mandiri",              amount: grandTotal,  description: `Penerimaan invoice ${invoiceNumber}` },
    { lineType: "credit", accountCode: "4-1001", accountName: "Pendapatan Sport Center", amount: ppnAmount > 0 ? netRevenue : grandTotal, description: `Pendapatan invoice ${invoiceNumber}` },
  ];
  if (ppnAmount > 0) {
    lines.push({ lineType: "credit", accountCode: "2-1101", accountName: "PPN Keluaran", amount: ppnAmount, description: `PPN 11% invoice ${invoiceNumber}` });
  }

  await postJournalLines(journal.id, lines);
}

export type ExpenseJournalType =
  | "operational"
  | "liability"
  | "kasbon"
  | "kasbon_settlement"

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
      creditPpnAccount: ppnAmount > 0 ? "PPN Masukan" : "",
      creditPpnAmount: String(ppnAmount),
      journalDate,
      isReversal: false,
      notes: journalNotes,
    })
    .returning();

  if (!journal) return 0;

  const lines: Array<{ lineType: string; accountCode: string; accountName: string; amount: number; description?: string }> = [];

  if (journalType === "operational") {
    lines.push({ lineType: "debit", accountCode: effectiveAccountCode, accountName: effectiveAccountName, amount, description: `Beban ${expenseNo}` });
    if (ppnAmount > 0) {
      lines.push({ lineType: "debit", accountCode: "2-1201", accountName: "PPN Masukan", amount: ppnAmount, description: `PPN Masukan ${expenseNo}` });
    }
    lines.push({ lineType: "credit", accountCode: "1-1001", accountName: kasSource, amount: totalAmount, description: `Pembayaran ${expenseNo}` });
  } else if (journalType === "liability") {
    lines.push({ lineType: "debit", accountCode: effectiveAccountCode, accountName: effectiveAccountName, amount: totalAmount, description: `Bayar hutang ${expenseNo}` });
    lines.push({ lineType: "credit", accountCode: "1-1001", accountName: kasSource, amount: totalAmount, description: `Pembayaran ${expenseNo}` });
  } else if (journalType === "kasbon") {
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
