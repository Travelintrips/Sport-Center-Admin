import pg from "pg";
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
    console.log(JSON.stringify({
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
    }, null, 2));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

await main();