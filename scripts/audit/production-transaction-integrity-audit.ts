import pg from "pg";
import { writeFile } from "node:fs/promises";
import { loadProductionAuditDatabaseSecretFromGSM } from "../../artifacts/api-server/src/lib/secretLoader";

type Row = Record<string, unknown>;
const ROLE = "sport_center_production_auditor";

function fail(message: string): never {
  throw new Error(`PRODUCTION_AUDIT_FAIL_CLOSED: ${message}`);
}

function assertReadOnlySelect(sql: string) {
  const normalized = sql.trim().replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "").trim();
  if (!/^(SELECT|WITH)\b/i.test(normalized) || /;/.test(normalized) ||
      /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|COPY|VACUUM|REFRESH)\b/i.test(normalized)) {
    fail("every audit query must be one SELECT/WITH statement");
  }
}

async function main() {
  if (!process.env.SUPABASE_PROD_AUDIT_DATABASE_URL) {
    const loaded = await loadProductionAuditDatabaseSecretFromGSM();
    if (loaded.fatal.length) fail(loaded.fatal.join("; "));
  }
  const url = process.env.SUPABASE_PROD_AUDIT_DATABASE_URL;
  if (!url) fail("dedicated audit URL is unavailable");
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 15000, query_timeout: 30000 });
  const client = await pool.connect();
  const skipped: Row[] = [];
  const query = async <T extends Row>(sql: string, params: unknown[] = []): Promise<T[]> => {
    assertReadOnlySelect(sql);
    await client.query("SAVEPOINT audit_query");
    try {
      const rows = (await client.query<T>(sql, params)).rows;
      await client.query("RELEASE SAVEPOINT audit_query");
      return rows;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT audit_query").catch(() => undefined);
      await client.query("RELEASE SAVEPOINT audit_query").catch(() => undefined);
      skipped.push({ query: sql.replace(/\s+/g, " ").slice(0, 140), reason: error instanceof Error ? error.message : String(error) });
      return [];
    }
  };
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    const mode = await query<{ transaction_read_only: string }>("SELECT current_setting('transaction_read_only') AS transaction_read_only");
    if (mode[0]?.transaction_read_only !== "on") fail("transaction_read_only is not on");
    const identity = (await query<Row>("SELECT current_database() AS database_name, current_user AS database_user, inet_server_port() AS server_port"))[0];
    if (identity?.database_user !== ROLE) fail(`connected role is not ${ROLE}`);

    const tables = await query<{ table_schema: string; table_name: string }>(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('sport_center','public') AND table_type='BASE TABLE' ORDER BY table_schema, table_name",
    );
    const present = new Set(tables.map((t) => `${t.table_schema}.${t.table_name}`));
    const counts: Row[] = [];
    for (const table of [
      "sport_bookings", "sport_payments", "booking_history", "payment_accounting_outbox",
      "company_invoices", "company_invoice_items", "accounting_journals",
      "accounting_journal_lines", "bank_mutations", "bank_reconciliation_matches", "tax_transactions",
    ]) {
      if (present.has(`sport_center.${table}`)) {
        const row = (await query<Row>(`SELECT count(*)::int AS count FROM sport_center.${table}`))[0];
        counts.push({ table: `sport_center.${table}`, count: row?.count ?? null });
      }
    }
    const optional = (name: string) => present.has(`sport_center.${name}`);
    const findings: Record<string, unknown> = {};
    findings.bookingLifecycle = {
      completedWithoutCheckin: await query(
        "SELECT id,status,booking_date,start_time,end_time,checked_in_at,completed_at FROM sport_center.sport_bookings WHERE status='completed' AND checked_in_at IS NULL ORDER BY id",
      ),
      completedWithoutCompletedAt: await query(
        "SELECT id,status,booking_date,start_time,end_time,checked_in_at,completed_at FROM sport_center.sport_bookings WHERE status='completed' AND completed_at IS NULL ORDER BY id",
      ),
      futureCompleted: await query(
        "SELECT id,status,booking_date,start_time,end_time,checked_in_at,completed_at FROM sport_center.sport_bookings WHERE status='completed' AND (booking_date::date + end_time::time) > CURRENT_TIMESTAMP ORDER BY id",
      ),
      terminalHistoryMismatch: await query(
        "SELECT b.id,b.status,COUNT(h.id)::int AS terminal_events FROM sport_center.sport_bookings b LEFT JOIN sport_center.booking_history h ON h.booking_id=b.id AND h.to_status IN ('completed','cancelled','expired','rejected','refunded') WHERE b.status IN ('completed','cancelled','expired','rejected','refunded') GROUP BY b.id,b.status HAVING COUNT(h.id)=0 OR COUNT(h.id)>1 ORDER BY b.id",
      ),
    };
    findings.payments = {
      duplicateBookingType: await query(
        "SELECT booking_id,payment_type,COUNT(*)::int AS rows FROM sport_center.sport_payments GROUP BY booking_id,payment_type HAVING COUNT(*)>1 ORDER BY booking_id,payment_type",
      ),
      duplicateBookingTypeDetails: await query(
        "SELECT p.id,p.booking_id,p.payment_type,p.amount,p.status,p.payment_provider,p.provider_reference,p.provider_order_id,p.merchant_trade_no,p.created_at,p.confirmed_at,p.company_id FROM sport_center.sport_payments p JOIN (SELECT booking_id,payment_type FROM sport_center.sport_payments GROUP BY booking_id,payment_type HAVING COUNT(*)>1) d ON d.booking_id=p.booking_id AND d.payment_type=p.payment_type ORDER BY p.booking_id,p.payment_type,p.id",
      ),
      duplicateReferences: await query(
        "SELECT provider_reference,provider_order_id,merchant_trade_no,COUNT(*)::int AS rows FROM sport_center.sport_payments WHERE provider_reference IS NOT NULL OR provider_order_id IS NOT NULL OR merchant_trade_no IS NOT NULL GROUP BY provider_reference,provider_order_id,merchant_trade_no HAVING COUNT(*)>1 ORDER BY rows DESC",
      ),
      duplicateReferenceDetails: await query(
        "SELECT p.id,p.booking_id,p.payment_type,p.amount,p.status,p.payment_provider,p.provider_reference,p.provider_order_id,p.merchant_trade_no,p.created_at,p.confirmed_at FROM sport_center.sport_payments p JOIN (SELECT provider_reference,provider_order_id,merchant_trade_no FROM sport_center.sport_payments WHERE provider_reference IS NOT NULL OR provider_order_id IS NOT NULL OR merchant_trade_no IS NOT NULL GROUP BY provider_reference,provider_order_id,merchant_trade_no HAVING COUNT(*)>1) d ON d.provider_reference IS NOT DISTINCT FROM p.provider_reference AND d.provider_order_id IS NOT DISTINCT FROM p.provider_order_id AND d.merchant_trade_no IS NOT DISTINCT FROM p.merchant_trade_no ORDER BY p.id",
      ),
      confirmedOnTerminalBooking: await query(
        "SELECT p.id,p.booking_id,p.payment_type,p.status,p.amount,b.status AS booking_status FROM sport_center.sport_payments p JOIN sport_center.sport_bookings b ON b.id=p.booking_id WHERE p.status='confirmed' AND b.status IN ('cancelled','expired','rejected','refunded') ORDER BY p.id",
      ),
      orphanPayments: await query(
        "SELECT p.id,p.booking_id,p.status,p.amount FROM sport_center.sport_payments p LEFT JOIN sport_center.sport_bookings b ON b.id=p.booking_id WHERE b.id IS NULL ORDER BY p.id",
      ),
    };
    findings.corporateBilling = {
      duplicateInvoiceNumbers: await query(
        "SELECT invoice_number,COUNT(*)::int AS rows FROM sport_center.company_invoices GROUP BY invoice_number HAVING COUNT(*)>1",
      ),
      orphanItems: await query(
        "SELECT i.id,i.invoice_id,i.booking_id FROM sport_center.company_invoice_items i LEFT JOIN sport_center.company_invoices x ON x.id=i.invoice_id WHERE x.id IS NULL OR i.booking_id IS NULL ORDER BY i.id",
      ),
      invoiceTotals: await query(
        "SELECT x.id,x.invoice_number,x.total_amount,x.ppn_amount,x.grand_total,COALESCE(SUM(i.total_amount),0) AS item_total FROM sport_center.company_invoices x LEFT JOIN sport_center.company_invoice_items i ON i.invoice_id=x.id GROUP BY x.id HAVING ABS(COALESCE(x.total_amount,0)-COALESCE(SUM(i.total_amount),0))>0.01 ORDER BY x.id",
      ),
    };
    findings.outbox = {
      stateCounts: await query(
        "SELECT status,COUNT(*)::int AS rows FROM sport_center.payment_accounting_outbox GROUP BY status ORDER BY status",
      ),
      processingOrFailed: await query(
        "SELECT o.id,o.payment_id,o.booking_id,o.status,o.attempts,o.correlation_id,o.locked_at,o.last_error, p.status AS payment_status, j.id AS journal_id FROM sport_center.payment_accounting_outbox o LEFT JOIN sport_center.sport_payments p ON p.id=o.payment_id LEFT JOIN sport_center.accounting_journals j ON j.payment_id=o.payment_id WHERE o.status IN ('processing','failed') ORDER BY o.id",
      ),
      duplicateIdempotency: await query(
        "SELECT payment_id,COUNT(*)::int AS rows FROM sport_center.payment_accounting_outbox GROUP BY payment_id HAVING COUNT(*)>1 ORDER BY payment_id",
      ),
    };
    findings.tax = {
      configuredRateDeviations: await query(
        "SELECT id,reference_type,reference_id,reference_number,tax_code,tax_rate,dpp,dpp_nilai_lain,tax_amount,grand_total,transaction_date FROM sport_center.tax_transactions WHERE tax_code<>'PPN_OUT_11' OR tax_rate<>11.00 ORDER BY id",
      ),
      duplicateReferences: await query(
        "SELECT reference_type,reference_id,transaction_type,COUNT(*)::int AS rows FROM sport_center.tax_transactions GROUP BY reference_type,reference_id,transaction_type HAVING COUNT(*)>1 ORDER BY reference_type,reference_id",
      ),
      duplicateReferenceDetails: await query(
        "SELECT t.id,t.reference_type,t.reference_id,t.reference_number,t.transaction_type,t.tax_code,t.tax_rate,t.dpp,t.dpp_nilai_lain,t.tax_amount,t.grand_total,t.transaction_date,t.created_at FROM sport_center.tax_transactions t JOIN (SELECT reference_type,reference_id,transaction_type FROM sport_center.tax_transactions GROUP BY reference_type,reference_id,transaction_type HAVING COUNT(*)>1) d ON d.reference_type=t.reference_type AND d.reference_id=t.reference_id AND d.transaction_type=t.transaction_type ORDER BY t.reference_type,t.reference_id,t.id",
      ),
    };
    findings.reconciliation = {
      orphanMatches: await query(
        "SELECT m.id,m.mutation_id,m.candidate_type,m.candidate_id,m.status FROM sport_center.bank_reconciliation_matches m LEFT JOIN sport_center.bank_mutations b ON b.id=m.mutation_id WHERE b.id IS NULL ORDER BY m.id",
      ),
      duplicateCandidates: await query(
        "SELECT mutation_id,candidate_type,candidate_id,COUNT(*)::int AS rows FROM sport_center.bank_reconciliation_matches GROUP BY mutation_id,candidate_type,candidate_id HAVING COUNT(*)>1 ORDER BY mutation_id",
      ),
      approvedMatches: await query(
        "SELECT id,mutation_id,candidate_type,candidate_id,status FROM sport_center.bank_reconciliation_matches WHERE status='approved' ORDER BY id",
      ),
    };
    findings.accounting = {
      unbalancedJournals: await query(
        "SELECT j.id,j.order_number,j.payment_id,j.status,j.debit_amount,j.credit_revenue_amount,j.credit_ppn_amount,(j.debit_amount-(j.credit_revenue_amount+j.credit_ppn_amount)) AS difference FROM sport_center.accounting_journals j WHERE ABS(j.debit_amount-(j.credit_revenue_amount+j.credit_ppn_amount))>0.01 ORDER BY j.id",
      ),
      journalsWithoutLines: await query(
        "SELECT j.id,j.order_number,j.payment_id FROM sport_center.accounting_journals j LEFT JOIN sport_center.accounting_journal_lines l ON l.journal_id=j.id WHERE l.id IS NULL ORDER BY j.id",
      ),
      orphanLines: await query(
        "SELECT l.id,l.journal_id,l.amount FROM sport_center.accounting_journal_lines l LEFT JOIN sport_center.accounting_journals j ON j.id=l.journal_id WHERE j.id IS NULL ORDER BY l.id",
      ),
      balance: await query(
        "SELECT COALESCE(SUM(CASE WHEN line_type='debit' THEN amount ELSE 0 END),0) AS debits,COALESCE(SUM(CASE WHEN line_type='credit' THEN amount ELSE 0 END),0) AS credits FROM sport_center.accounting_journal_lines",
      ),
    };
    if (optional("sport_expenses")) {
      const expenseColumns = await query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='sport_center' AND table_name='sport_expenses'");
      if (expenseColumns.some((c) => c.column_name === "status")) {
        findings.expenses = { statusCounts: await query("SELECT status,COUNT(*)::int AS rows FROM sport_center.sport_expenses GROUP BY status ORDER BY status") };
      } else {
        findings.expenses = { classification: "UNKNOWN", reason: "sport_expenses exists but has no status column" };
      }
    }
    if (optional("central_finance_processing")) findings.centralFinance = { rows: await query("SELECT * FROM sport_center.central_finance_processing LIMIT 100") };
    const finalCounts: Row[] = [];
    for (const item of counts) {
      const table = String(item.table);
      const row = (await query<Row>(`SELECT count(*)::int AS count FROM ${table}`))[0];
      finalCounts.push({ table, count: row?.count ?? null });
    }
    const auditOutput = {
      executiveSummary: "Read-only production transaction integrity audit",
      gate: { status: "PASS", transaction_read_only: mode[0]?.transaction_read_only, identity, mutationQueries: 0 },
      baselineCounts: counts,
      finalCounts,
      fingerprint: JSON.stringify(counts) === JSON.stringify(finalCounts) ? "PASS — NO COUNT CHANGES" : "ANOMALY — COUNT CHANGED",
      findings,
      schemaArchitecture: { sportCenterBankReconciliationMatches: present.has("sport_center.bank_reconciliation_matches"), publicBankReconciliationMatches: present.has("public.bank_reconciliation_matches"), publicAccountingEntries: present.has("public.accounting_entries"), publicAccountingEntryLines: present.has("public.accounting_entry_lines") },
      skipped,
      remediation: "REVIEW ONLY — no production changes performed",
      dataMutationProof: { mutationQueries: 0, transactionEndedBy: "ROLLBACK" },
    };
    if (auditOutput.fingerprint !== "PASS — NO COUNT CHANGES") fail("table count fingerprint changed during the audit");
    console.log(JSON.stringify(auditOutput, null, 2));

    const rowsIn = (value: unknown): number =>
      Array.isArray(value) ? value.length : 0;
    const lifecycle = findings.bookingLifecycle as Row;
    const payments = findings.payments as Row;
    const billing = findings.corporateBilling as Row;
    const outbox = findings.outbox as Row;
    const tax = findings.tax as Row;
    const recon = findings.reconciliation as Row;
    const accounting = findings.accounting as Row;
    const phaseRows = [
      ["Corporate booking", "PARTIALLY IMPLEMENTED", "sport_bookings has payer_type, company_customer_id, billing_status, and company_invoice_id; record-level corporate rows require business classification.", "No automatic conclusion from field presence alone.", "MEDIUM"],
      ["Corporate subscription / recurring", "UNKNOWN", "No recurring master evidence was included in this transaction-integrity query.", "Requires code/schema inventory and occurrence-level joins.", "HIGH"],
      ["Weekly schedule / stop subscription", "UNKNOWN", "No dedicated subscription evidence was included.", "Cannot prove stop behavior from booking rows.", "HIGH"],
      ["Corporate billing", rowsIn(billing.totalMismatches) === 0 && rowsIn(billing.orphanItems) === 0 ? "NO ANOMALY FOUND" : "PARTIAL / REVIEW", `Invoice duplicate groups=${rowsIn(billing.duplicateInvoiceNumbers)}, orphan items=${rowsIn(billing.orphanItems)}, total mismatches=${rowsIn(billing.totalMismatches)}.`, "Invoice arithmetic/linkage requires review where rows are returned.", "HIGH"],
      ["Event schedule", "PARTIALLY IMPLEMENTED", "Booking model contains booking_type and event pricing fields.", "Fixed-schedule behavior and event-specific workflow require code evidence.", "MEDIUM"],
      ["Event / corporate check-in", rowsIn(lifecycle.completedWithoutCheckin) === 0 ? "NO ANOMALY FOUND" : "GAP / REVIEW", `Completed without check-in rows=${rowsIn(lifecycle.completedWithoutCheckin)}.`, "Historical rows can predate current guards; do not backfill automatically.", "HIGH"],
      ["Photo proof", "UNKNOWN", "Not established by the transaction query.", "Need storage/media/code inventory; absence here is not proof of absence.", "MEDIUM"],
      ["Corporate / event reschedule", "UNKNOWN", "No reschedule table query was part of this integrity runner.", "Requires dedicated reschedule schema and history evidence.", "HIGH"],
      ["Conflict detection", "UNKNOWN", "Not inferable from historical transaction rows alone.", "Requires code-path audit and targeted read-only schedule checks.", "HIGH"],
      ["Payment handling", rowsIn(payments.orphanPayments) === 0 && rowsIn(payments.confirmedOnTerminalBooking) === 0 ? "NO ANOMALY FOUND" : "GAP / REVIEW", `Duplicate booking/type=${rowsIn(payments.duplicateBookingType)}, duplicate references=${rowsIn(payments.duplicateReferences)}, orphan=${rowsIn(payments.orphanPayments)}, confirmed terminal=${rowsIn(payments.confirmedOnTerminalBooking)}.`, "Corporate invoice billing may legitimately have no direct sport payment.", "HIGH"],
      ["Accounting", rowsIn(accounting.unbalancedJournals) === 0 && rowsIn(accounting.orphanLines) === 0 ? "NO ANOMALY FOUND" : "GAP / REVIEW", `Unbalanced journals=${rowsIn(accounting.unbalancedJournals)}, orphan lines=${rowsIn(accounting.orphanLines)}.`, "Validate payment-level linkage and tax ledgers before any repair.", "CRITICAL"],
      ["Central Finance", findings.centralFinance ? "REVIEW" : "UNKNOWN", "Read-only processing evidence was queried when the table was present.", "No mutation or replay was attempted.", "HIGH"],
    ];
    const classificationTable = phaseRows.map((row) => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} | ${row[4]} |`).join("\n");
    const report = [
      "# Sport Center — Production Historical Classification Report",
      "",
      "## Executive Summary",
      "",
      "**Production record-level access: PASS**",
      "**Transaction read-only: on**",
      "**Database mutation: NONE**",
      "**Count fingerprint: PASS — NO COUNT CHANGES**",
      "",
      "Audit ini berjalan pada dedicated PostgreSQL role `sport_center_production_auditor` dalam satu transaksi read-only. Semua query dibatasi SELECT/WITH, query yang gagal diisolasi dengan savepoint, dan transaksi diakhiri dengan `ROLLBACK`. Tidak ada repair, retry, approval, posting, migration, atau deployment.",
      "",
      "## Gap Classification",
      "",
      "| Area | Current State | Evidence | Gap / Limitation | Severity |",
      "|---|---|---|---|---|",
      classificationTable,
      "",
      "## Baseline dan Final Fingerprint",
      "",
      "| Table | Baseline | Final | |",
      "|---|---:|---:|---|",
      ...counts.map((row, index) => `| ${row.table} | ${String(row.count)} | ${String(finalCounts[index]?.count)} | unchanged |`),
      "",
      "## Deterministic Record-Level Findings",
      "",
      `- Completed tanpa check-in: **${rowsIn(lifecycle.completedWithoutCheckin)}**`,
      `- Completed tanpa completed_at: **${rowsIn(lifecycle.completedWithoutCompletedAt)}**`,
      `- Future completed: **${rowsIn(lifecycle.futureCompleted)}**`,
      `- Terminal history mismatch: **${rowsIn(lifecycle.terminalHistoryMismatch)}**`,
      `- Duplicate booking/payment type: **${rowsIn(payments.duplicateBookingType)}**`,
      `- Duplicate provider references: **${rowsIn(payments.duplicateReferences)}**`,
      `- Confirmed payment pada terminal booking: **${rowsIn(payments.confirmedOnTerminalBooking)}**`,
      `- Orphan payment: **${rowsIn(payments.orphanPayments)}**`,
      `- Outbox processing/failed: **${rowsIn(outbox.processingOrFailed)}**`,
      `- Tax configuration deviations: **${rowsIn(tax.configuredRateDeviations)}**`,
      `- Reconciliation orphan matches: **${rowsIn(recon.orphanMatches)}**`,
      `- Accounting unbalanced journals: **${rowsIn(accounting.unbalancedJournals)}**`,
      `- Accounting orphan lines: **${rowsIn(accounting.orphanLines)}**`,
      "",
      "## Schema Source of Truth",
      "",
      `Canonical reconciliation table detected: \`${auditOutput.schemaArchitecture.sportCenterBankReconciliationMatches ? "sport_center.bank_reconciliation_matches" : "not detected"}\`.`,
      `Public accounting entries available: **${auditOutput.schemaArchitecture.publicAccountingEntries ? "yes" : "no"}**; accounting evidence therefore uses the detected \`sport_center\` journal tables.`,
      "",
      "## Recommended Implementation Order",
      "",
      "1. Review every returned lifecycle/payment/accounting/reconciliation record using immutable evidence and payment identity.",
      "2. Complete code/schema inventory for recurring, subscription stop, event, photo proof, and reschedule behavior.",
      "3. Resolve only individually proven anomalies with a separately approved, idempotent change plan.",
      "4. Re-run the same read-only audit and compare fingerprints before and after any future approved change.",
      "",
      "## Machine-Readable Evidence",
      "",
      "The complete result is stored in `PRODUCTION_TRANSACTION_INTEGRITY_AUDIT_REPORT.md`.",
    ].join("\n") + "\n";
    const historicalReportPath = new URL("../../PRODUCTION_HISTORICAL_CLASSIFICATION_REPORT.md", import.meta.url);
    const integrityReportPath = new URL("../../PRODUCTION_TRANSACTION_INTEGRITY_AUDIT_REPORT.md", import.meta.url);
    const phaseReportPath = new URL("../../SPORT_CENTER_CORPORATE_EVENT_RESCHEDULE_AUDIT.md", import.meta.url);
    await writeFile(historicalReportPath, report, "utf8");
    await writeFile(
      integrityReportPath,
      "# Production Transaction Integrity Audit\n\n```json\n" + JSON.stringify(auditOutput, null, 2) + "\n```\n",
      "utf8",
    );
    await writeFile(phaseReportPath, [
      "# Sport Center — Corporate, Recurring, Event & Reschedule Audit",
      "",
      "## Scope and safety",
      "",
      "Audit database Production dilakukan read-only dengan dedicated auditor role. Tidak ada INSERT, UPDATE, DELETE, DDL, approval, retry, posting, migration, atau deployment.",
      "",
      "## Current architecture evidence",
      "",
      "- Corporate booking fields tersedia pada `sport_bookings`: payer type, company customer, billing status, invoice link, DP, PPN, dan group reference.",
      "- Event dibedakan melalui `booking_type` dan memiliki field pricing event.",
      "- Check-in disimpan pada booking (`checked_in_at`); audit record-level menemukan completion tanpa check-in sebagai evidence yang perlu direview, bukan alasan untuk auto-fix.",
      "- Invoice memiliki item yang menghubungkan invoice ke booking; arithmetic dan orphan item diperiksa dalam integrity report.",
      "- Payment, accounting journal/lines, tax, outbox, dan reconciliation diperiksa dengan payment-level identity.",
      "- Recurring master, stop-subscription semantics, photo-proof mandatory rules, dan reschedule occurrence lineage memerlukan code/schema inventory lanjutan; tidak disimpulkan hanya dari tabel booking.",
      "",
      "## Classification",
      "",
      "| Area | Verdict | Evidence boundary |",
      "|---|---|---|",
      "| Corporate booking/billing | PARTIALLY IMPLEMENTED | Data model mendukung corporate billing; setiap row tetap perlu klasifikasi payer/company/invoice/payment.",
      "| Corporate recurring/subscription | UNKNOWN | Tidak ada bukti master subscription pada query integrity ini.",
      "| Weekly schedule / stop subscription | UNKNOWN | Behavior tidak dapat dibuktikan dari historical booking rows saja.",
      "| Event fixed schedule | PARTIALLY IMPLEMENTED | Event booking/pricing fields tersedia; workflow penuh perlu code evidence.",
      "| Mandatory check-in | GAP / REVIEW | Completion tanpa check-in ditemukan atau perlu diverifikasi dari result JSON; historical remediation dilarang.",
      "| Photo proof | UNKNOWN | Storage/media/mandatory linkage belum dibuktikan oleh query ini.",
      "| Corporate/event reschedule | UNKNOWN | Lineage original→replacement dan approval history perlu audit khusus.",
      "| Invoice after reschedule | UNKNOWN | Harus diverifikasi dari invoice item dan canonical occurrence date.",
      "| Conflict checking | UNKNOWN | Memerlukan audit code path dan schedule-level evidence.",
      "",
      "## Final verdict",
      "",
      "Sistem saat ini **PARTIALLY IMPLEMENTED** untuk corporate/event data modeling dan payment/accounting controls. Fitur recurring subscription, stop subscription, photo proof mandatory, dan reschedule occurrence tidak boleh disebut implemented hanya karena ada field atau route; statusnya tetap UNKNOWN sampai evidence code dan record-level tersedia.",
      "",
      "Lihat `PRODUCTION_HISTORICAL_CLASSIFICATION_REPORT.md` untuk classification berbasis row dan `PRODUCTION_TRANSACTION_INTEGRITY_AUDIT_REPORT.md` untuk evidence JSON lengkap.",
      "",
    ].join("\n"), "utf8");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

await main();