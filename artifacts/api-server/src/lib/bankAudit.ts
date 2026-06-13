import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface AuditFinding {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
  count: number;
  details?: any[];
}

export interface AuditResult {
  summary: { critical: number; warning: number; info: number; productionReady: boolean };
  findings: AuditFinding[];
  auditTimestamp: string;
}

export async function runBankAudit(): Promise<AuditResult> {
  const findings: AuditFinding[] = [];

  // 1. Duplicate journals
  const { rows: dupJournals } = await db.execute(sql`
    SELECT journal_id AS "journalId", COUNT(*)::int AS cnt
    FROM sport_center.bank_journal_entries
    GROUP BY journal_id HAVING COUNT(*) > 1
  `);
  if ((dupJournals as any[]).length > 0) {
    findings.push({
      severity: "critical",
      category: "duplicate_journal",
      message: `${(dupJournals as any[]).length} journal ID duplikat ditemukan.`,
      count: (dupJournals as any[]).length,
      details: dupJournals as any[],
    });
  }

  // 2. Approved mutations tanpa approvedBy
  const { rows: noAuditRows } = await db.execute(sql`
    SELECT bm.id, bm.transaction_date AS "transactionDate", bm.amount
    FROM sport_center.bank_mutations bm
    WHERE bm.status = 'approved' AND bm.approved_by IS NULL
    LIMIT 50
  `);
  if ((noAuditRows as any[]).length > 0) {
    findings.push({
      severity: "warning",
      category: "missing_approved_by",
      message: `${(noAuditRows as any[]).length} mutasi approved tanpa data approvedBy.`,
      count: (noAuditRows as any[]).length,
      details: noAuditRows as any[],
    });
  }

  // 3. Invoice paid_amount > grand_total
  const { rows: overPaidInvoices } = await db.execute(sql`
    SELECT id, invoice_number AS "invoiceNumber", grand_total AS "grandTotal", paid_amount AS "paidAmount"
    FROM sport_center.company_invoices
    WHERE paid_amount IS NOT NULL
      AND grand_total IS NOT NULL
      AND paid_amount::numeric > grand_total::numeric + 0.01
    LIMIT 20
  `);
  if ((overPaidInvoices as any[]).length > 0) {
    findings.push({
      severity: "critical",
      category: "invoice_overpaid",
      message: `${(overPaidInvoices as any[]).length} invoice dengan paid_amount melebihi grand_total.`,
      count: (overPaidInvoices as any[]).length,
      details: overPaidInvoices as any[],
    });
  }

  // 4. Closing dengan selisih != 0
  const { rows: badClosings } = await db.execute(sql`
    SELECT id, period_year AS "periodYear", period_month AS "periodMonth",
           difference::text AS "difference", status
    FROM sport_center.bank_reconciliation_closing
    WHERE status = 'closed' AND ABS(difference::numeric) > 0.01
  `);
  if ((badClosings as any[]).length > 0) {
    findings.push({
      severity: "critical",
      category: "closing_with_difference",
      message: `${(badClosings as any[]).length} periode ditutup dengan selisih != 0.`,
      count: (badClosings as any[]).length,
      details: badClosings as any[],
    });
  }

  // 5. Approved mutations di periode tertutup tanpa jurnal
  const { rows: lockedUnposted } = await db.execute(sql`
    SELECT bm.id, bm.transaction_date AS "transactionDate", bm.amount, bm.accounting_posted AS "accountingPosted"
    FROM sport_center.bank_mutations bm
    JOIN sport_center.bank_reconciliation_closing bc
      ON TO_CHAR(TO_DATE(bm.transaction_date, 'YYYY-MM-DD'), 'YYYY-MM') =
         TO_CHAR(TO_DATE(bc.period_year::text || '-' || LPAD(bc.period_month::text,2,'0') || '-01', 'YYYY-MM-DD'), 'YYYY-MM')
      AND bc.status = 'closed'
    WHERE bm.status = 'approved' AND bm.accounting_posted = false
    LIMIT 20
  `);
  if ((lockedUnposted as any[]).length > 0) {
    findings.push({
      severity: "critical",
      category: "closed_period_unposted",
      message: `${(lockedUnposted as any[]).length} mutasi approved di periode tertutup belum diposting jurnal.`,
      count: (lockedUnposted as any[]).length,
      details: lockedUnposted as any[],
    });
  }

  // 6. Mutations tanpa company_id (info — normal single-company)
  const { rows: noCompany } = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM sport_center.bank_mutations WHERE company_id IS NULL
  `);
  const noCompanyCnt = Number((noCompany as any[])[0]?.cnt ?? 0);
  findings.push({
    severity: "info",
    category: "no_company_id",
    message: `${noCompanyCnt} mutasi tanpa company_id (normal untuk sistem single-company).`,
    count: noCompanyCnt,
  });

  // 7. Approved mutations tanpa jurnal
  const { rows: approvedNoJournal } = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM sport_center.bank_mutations
    WHERE status = 'approved' AND accounting_posted = false
  `);
  const unpostedCnt = Number((approvedNoJournal as any[])[0]?.cnt ?? 0);
  if (unpostedCnt > 0) {
    findings.push({
      severity: "warning",
      category: "approved_unposted_journal",
      message: `${unpostedCnt} mutasi approved belum memiliki jurnal akuntansi.`,
      count: unpostedCnt,
    });
  }

  const summary = {
    critical: findings.filter((f) => f.severity === "critical").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    productionReady: findings.filter((f) => f.severity === "critical").length === 0,
  };

  return { summary, findings, auditTimestamp: new Date().toISOString() };
}
