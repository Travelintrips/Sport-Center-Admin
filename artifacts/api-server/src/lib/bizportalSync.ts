import pg from "pg";
import type { Booking, GymMembership, CompanyInvoice } from "@workspace/db";
import { postSportCenterBookingPayment } from "./accounting";

const { Pool } = pg;

const PROD_URL =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV;

let _prodPool: pg.Pool | null = null;
export function getProdPool(): pg.Pool | null {
  if (!PROD_URL) return null;
  if (!_prodPool) {
    _prodPool = new Pool({
      connectionString: PROD_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      options: "-c search_path=sport_center,public",
    });
  }
  return _prodPool;
}

export const bizportalSyncConfigured = Boolean(PROD_URL);

export type SportCenterPaymentAuditStatus =
  | "COMPLETE"
  | "MIRROR_MISSING"
  | "ACCOUNTING_ENTRY_MISSING"
  | "GL_UNBALANCED"
  | "TAX_LEDGER_MISSING"
  | "COMPANY_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "PAYMENT_METHOD_MISSING"
  | "PROVIDER_MISSING";

function paymentAuditStatus(row: any): SportCenterPaymentAuditStatus {
  if (!row.mirror_id) return "MIRROR_MISSING";
  if (!row.entry_id || row.entry_status !== "posted" || row.entry_source_payment_id == null) {
    return "ACCOUNTING_ENTRY_MISSING";
  }
  if (Number(row.gl_line_count ?? 0) < 2 || Math.abs(Number(row.gl_debit ?? 0) - Number(row.gl_credit ?? 0)) > 0.005) {
    return "GL_UNBALANCED";
  }
  if (row.source_company_id != null &&
      (row.mirror_company_id !== row.source_company_id || row.entry_company_id !== row.source_company_id)) {
    return "COMPANY_MISMATCH";
  }
  if (Number(row.source_amount) !== Number(row.mirror_amount)) return "AMOUNT_MISMATCH";
  if (!String(row.entry_payment_method ?? "").trim()) return "PAYMENT_METHOD_MISSING";
  if (!String(row.entry_payment_provider ?? "").trim() ||
      String(row.source_provider ?? "unknown").trim().toLowerCase() !==
        String(row.entry_payment_provider ?? "unknown").trim().toLowerCase()) {
    return "PROVIDER_MISSING";
  }
  if (Number(row.expected_tax_amount ?? 0) > 0 &&
      (!row.tax_transaction_id || !row.gl_tax_line_id ||
       Math.abs(Number(row.source_tax_amount ?? 0) - Number(row.public_tax_amount ?? 0)) > 0.005 ||
       Math.abs(Number(row.source_tax_amount ?? 0) - Number(row.expected_tax_amount ?? 0)) > 0.005)) {
    return "TAX_LEDGER_MISSING";
  }
  return "COMPLETE";
}

export async function auditSportCenterPayment(sourcePaymentId: number): Promise<{
  readOnly: true;
  sourcePaymentId: number;
  status: SportCenterPaymentAuditStatus;
  source: Record<string, unknown> | null;
  mirror: Record<string, unknown> | null;
  accounting: Record<string, unknown> | null;
  tax: { sportCenter: Record<string, unknown> | null; publicGl: Record<string, unknown> | null };
  validation: Record<string, boolean>;
}> {
  const pool = getProdPool();
  if (!pool) throw new Error("BIZPORTAL_DATABASE_NOT_CONFIGURED");

  const { rows } = await pool.query(
    `SELECT
       sp.id AS source_id, sp.booking_id AS source_booking_id, sp.company_id AS source_company_id,
       sp.amount AS source_amount, sp.payment_type AS source_payment_type,
       sp.payment_method AS source_payment_method, sp.payment_provider::text AS source_provider,
       COALESCE(sp.paid_at, sp.confirmed_at) AS source_paid_at,
       sp.provider_reference AS source_provider_reference,
       sp.provider_order_id AS source_provider_order_id,
       sp.merchant_trade_no AS source_merchant_trade_no,
       sp.provider_trade_no AS source_provider_trade_no,
       sp.bank_account_id AS source_bank_account_id,
        sb.order_number, sb.ppn_rate,
        CASE WHEN COALESCE(sb.ppn_rate, 0) > 0
          THEN ROUND((sp.amount * sb.ppn_rate) / (100 + sb.ppn_rate), 0)
          ELSE 0
        END AS expected_tax_amount,
       m.id AS mirror_id, m.source_payment_id AS mirror_source_payment_id,
       m.amount AS mirror_amount, m.method AS mirror_method, m.payment_provider AS mirror_provider,
       m.company_id AS mirror_company_id, m.bank_account_id AS mirror_bank_account_id,
       m.posting_status AS mirror_posting_status, m.entry_id AS mirror_entry_id,
       ae.id AS entry_id, ae.correlation_id, ae.company_id AS entry_company_id,
        ae.source_payment_id AS entry_source_payment_id,
       ae.payment_method AS entry_payment_method, ae.payment_provider AS entry_payment_provider,
       ae.payment_type AS entry_payment_type, ae.total_debit, ae.total_credit,
       ae.status::text AS entry_status,
       gl.gl_line_count, gl.gl_debit, gl.gl_credit,
       tt.id AS tax_transaction_id, tt.tax_amount AS source_tax_amount,
       gtl.id AS gl_tax_line_id, gtl.tax_amount AS public_tax_amount
     FROM sport_center.sport_payments sp
     JOIN sport_center.sport_bookings sb ON sb.id = sp.booking_id
     LEFT JOIN public.sport_payments m
       ON m.source_payment_id = sp.id
       OR m.payment_number = 'SCPAY-SC-' || sp.id::text
     LEFT JOIN public.accounting_entries ae
       ON ae.id = m.entry_id
       OR ae.correlation_id = 'sc_payment_' || sp.id::text
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS gl_line_count,
              COALESCE(SUM(debit), 0) AS gl_debit,
              COALESCE(SUM(credit), 0) AS gl_credit
         FROM public.accounting_entry_lines
        WHERE entry_id = ae.id
     ) gl ON true
     LEFT JOIN LATERAL (
       SELECT id, tax_amount
         FROM sport_center.tax_transactions
        WHERE reference_type = 'sport_center_payment'
          AND reference_id = sp.id
          AND transaction_type = 'original'
          AND status = 'posted'
        ORDER BY id DESC
        LIMIT 1
     ) tt ON true
     LEFT JOIN LATERAL (
       SELECT id, tax_amount
         FROM public.gl_tax_lines
        WHERE accounting_entry_id = ae.id
          AND tax_type = 'PPN_OUT'
          AND entity_type = 'sport_center_payment'
          AND entity_id = sp.id
        ORDER BY id DESC
        LIMIT 1
     ) gtl ON true
    WHERE sp.id = $1
    LIMIT 1`,
    [sourcePaymentId],
  );

  const row = rows[0];
  if (!row) {
    return {
      readOnly: true,
      sourcePaymentId,
      status: "MIRROR_MISSING",
      source: null,
      mirror: null,
      accounting: null,
      tax: { sportCenter: null, publicGl: null },
      validation: { amountMatch: false, companyMatch: false, paymentMethodMatch: false, providerMatch: false, glBalanced: false, taxComplete: false },
    };
  }
  const status = paymentAuditStatus(row);
  return {
    readOnly: true,
    sourcePaymentId,
    status,
    source: {
      id: Number(row.source_id),
      booking: Number(row.source_booking_id),
      company: row.source_company_id == null ? null : Number(row.source_company_id),
      amount: Number(row.source_amount),
      paymentType: row.source_payment_type,
      paymentMethod: row.source_payment_method,
      provider: row.source_provider,
      paidAt: row.source_paid_at,
    },
    mirror: row.mirror_id ? {
      id: Number(row.mirror_id),
      sourcePaymentId: row.mirror_source_payment_id == null ? null : Number(row.mirror_source_payment_id),
      amount: Number(row.mirror_amount),
      method: row.mirror_method,
      provider: row.mirror_provider,
      company: row.mirror_company_id == null ? null : Number(row.mirror_company_id),
      bankAccount: row.mirror_bank_account_id,
      postingStatus: row.mirror_posting_status,
      entryId: row.mirror_entry_id == null ? null : Number(row.mirror_entry_id),
    } : null,
    accounting: row.entry_id ? {
      entryId: Number(row.entry_id),
      correlationId: row.correlation_id,
      company: row.entry_company_id == null ? null : Number(row.entry_company_id),
      paymentMethod: row.entry_payment_method,
      provider: row.entry_payment_provider,
      paymentType: row.entry_payment_type,
      debit: Number(row.total_debit ?? 0),
      credit: Number(row.total_credit ?? 0),
      status: row.entry_status,
    } : null,
    tax: {
      sportCenter: row.tax_transaction_id ? { id: Number(row.tax_transaction_id), taxAmount: Number(row.source_tax_amount ?? 0) } : null,
      publicGl: row.gl_tax_line_id ? { id: Number(row.gl_tax_line_id), taxAmount: Number(row.public_tax_amount ?? 0) } : null,
    },
    validation: {
      amountMatch: Number(row.source_amount) === Number(row.mirror_amount),
      companyMatch: row.source_company_id == null || Number(row.source_company_id) === Number(row.mirror_company_id) && Number(row.source_company_id) === Number(row.entry_company_id),
      paymentMethodMatch: String(row.source_payment_method ?? "").trim() === String(row.entry_payment_method ?? "").trim(),
      providerMatch: String(row.source_provider ?? "unknown").trim().toLowerCase() === String(row.entry_payment_provider ?? "unknown").trim().toLowerCase(),
      glBalanced: Number(row.gl_line_count ?? 0) >= 2 && Math.abs(Number(row.gl_debit ?? 0) - Number(row.gl_credit ?? 0)) <= 0.005,
      taxComplete: Number(row.expected_tax_amount ?? 0) <= 0 || Boolean(row.tax_transaction_id && row.gl_tax_line_id),
    },
  };
}

export async function dryRunConfirmedPaymentAccounting(): Promise<{
  readOnly: true;
  scanned: number;
  mirrorMissing: number;
  accountingEntryMissing: number;
  paymentMethodMissing: number;
  paymentProviderMissing: number;
  companyMismatch: number;
  glUnbalanced: number;
  taxLedgerMissing: number;
  duplicateCorrelationId: number;
}> {
  const pool = getProdPool();
  if (!pool) throw new Error("BIZPORTAL_DATABASE_NOT_CONFIGURED");
  const { rows } = await pool.query(`
    WITH confirmed AS (
       SELECT sp.id, sp.amount, sp.company_id, sp.payment_method, sp.payment_provider::text AS provider,
              CASE WHEN COALESCE(sb.ppn_rate, 0) > 0
                THEN ROUND((sp.amount * sb.ppn_rate) / (100 + sb.ppn_rate), 0)
                ELSE 0
              END AS booking_tax
        FROM sport_center.sport_payments sp
        JOIN sport_center.sport_bookings sb ON sb.id = sp.booking_id
       WHERE sp.status = 'confirmed'
    ),
    linked AS (
      SELECT c.*,
             m.id AS mirror_id, m.amount AS mirror_amount, m.company_id AS mirror_company_id,
              m.entry_id, ae.status::text AS entry_status,
              ae.source_payment_id AS entry_source_payment_id,
             ae.company_id AS entry_company_id, ae.payment_method AS entry_payment_method,
             ae.payment_provider AS entry_payment_provider
        FROM confirmed c
        LEFT JOIN public.sport_payments m
          ON m.source_payment_id = c.id OR m.payment_number = 'SCPAY-SC-' || c.id::text
        LEFT JOIN public.accounting_entries ae
          ON ae.id = m.entry_id OR ae.correlation_id = 'sc_payment_' || c.id::text
    ),
    gl AS (
      SELECT l.id,
             COUNT(ael.*)::int AS line_count,
             COALESCE(SUM(ael.debit), 0) AS debit,
             COALESCE(SUM(ael.credit), 0) AS credit
        FROM linked l
        LEFT JOIN public.accounting_entry_lines ael ON ael.entry_id = l.entry_id
       GROUP BY l.id
    ),
    counts AS (
      SELECT COUNT(*)::int AS scanned,
             COUNT(*) FILTER (WHERE mirror_id IS NULL)::int AS mirror_missing,
              COUNT(*) FILTER (WHERE mirror_id IS NOT NULL AND (entry_id IS NULL OR entry_status <> 'posted' OR entry_source_payment_id IS NULL))::int AS entry_missing,
             COUNT(*) FILTER (WHERE entry_id IS NOT NULL AND NULLIF(BTRIM(entry_payment_method), '') IS NULL)::int AS method_missing,
              COUNT(*) FILTER (WHERE entry_id IS NOT NULL AND (
                NULLIF(BTRIM(entry_payment_provider), '') IS NULL
                OR LOWER(COALESCE(provider, 'unknown')) <> LOWER(COALESCE(entry_payment_provider, 'unknown'))
              ))::int AS provider_missing,
             COUNT(*) FILTER (WHERE company_id IS NOT NULL AND (mirror_company_id IS DISTINCT FROM company_id OR entry_company_id IS DISTINCT FROM company_id))::int AS company_mismatch,
             COUNT(*) FILTER (WHERE entry_id IS NOT NULL AND (line_count < 2 OR ABS(debit - credit) > 0.005))::int AS gl_unbalanced,
             COUNT(*) FILTER (WHERE booking_tax > 0 AND (NOT EXISTS (SELECT 1 FROM sport_center.tax_transactions tt WHERE tt.reference_type = 'sport_center_payment' AND tt.reference_id = linked.id AND tt.transaction_type = 'original' AND tt.status = 'posted') OR NOT EXISTS (SELECT 1 FROM public.gl_tax_lines gtl WHERE gtl.accounting_entry_id = linked.entry_id AND gtl.tax_type = 'PPN_OUT' AND gtl.entity_type = 'sport_center_payment' AND gtl.entity_id = linked.id)))::int AS tax_missing
        FROM linked
        LEFT JOIN gl ON gl.id = linked.id
    )
    SELECT * FROM counts
  `);
  const duplicate = await pool.query(`
    SELECT COUNT(*)::int AS count
      FROM (
        SELECT correlation_id
          FROM public.accounting_entries
         WHERE correlation_id LIKE 'sc_payment_%'
         GROUP BY correlation_id
        HAVING COUNT(*) > 1
      ) duplicates
  `);
  const row = rows[0] ?? {};
  return {
    readOnly: true,
    scanned: Number(row.scanned ?? 0),
    mirrorMissing: Number(row.mirror_missing ?? 0),
    accountingEntryMissing: Number(row.entry_missing ?? 0),
    paymentMethodMissing: Number(row.method_missing ?? 0),
    paymentProviderMissing: Number(row.provider_missing ?? 0),
    companyMismatch: Number(row.company_mismatch ?? 0),
    glUnbalanced: Number(row.gl_unbalanced ?? 0),
    taxLedgerMissing: Number(row.tax_missing ?? 0),
    duplicateCorrelationId: Number(duplicate.rows[0]?.count ?? 0),
  };
}

export async function initBizportalTables(): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;
  try {
    // PostgreSQL requires a newly-added enum value to be committed before a
    // later statement can use it in a partial index predicate.
    const sourceEnum = await pool.query<{ exists: boolean; has_value: boolean }>(`
      SELECT EXISTS (
        SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typname = 'accounting_entry_source'
           AND n.nspname = 'public'
      ) AS exists,
      EXISTS (
        SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typname = 'accounting_entry_source'
           AND n.nspname = 'public'
           AND e.enumlabel = 'sport_center_payment'
      ) AS has_value
    `);
    if (sourceEnum.rows[0]?.exists && !sourceEnum.rows[0]?.has_value) {
      await pool.query(
        `ALTER TYPE public.accounting_entry_source ADD VALUE 'sport_center_payment'`,
      );
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sport_center.sport_bookings_sync (
        id                SERIAL PRIMARY KEY,
        booking_code      TEXT UNIQUE NOT NULL,
        facility_id       TEXT,
        facility_name     TEXT,
        customer_name     TEXT,
        customer_phone    TEXT,
        customer_email    TEXT,
        date              TEXT,
        start_time        TEXT,
        end_time          TEXT,
        total_hours       NUMERIC,
        total_price       BIGINT,
        notes             TEXT,
        status            TEXT DEFAULT 'pending_payment',
        payment_status    TEXT DEFAULT 'unpaid',
        payment_proof_url TEXT,
        payment_proof_at  TIMESTAMPTZ,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE sport_center.sport_bookings_sync
        ADD COLUMN IF NOT EXISTS ppn_rate      NUMERIC(5,2),
        ADD COLUMN IF NOT EXISTS dpp           BIGINT,
        ADD COLUMN IF NOT EXISTS dpp_nilai_lain BIGINT,
        ADD COLUMN IF NOT EXISTS ppn_amount    BIGINT,
        ADD COLUMN IF NOT EXISTS grand_total   BIGINT,
        ADD COLUMN IF NOT EXISTS group_ref     TEXT,
        ADD COLUMN IF NOT EXISTS group_total   BIGINT;
      CREATE TABLE IF NOT EXISTS sport_center.sport_memberships_sync (
        id                SERIAL PRIMARY KEY,
        name              TEXT,
        email             TEXT,
        phone             TEXT,
        start_date        TEXT,
        end_date          TEXT,
        months            INTEGER,
        total_price       BIGINT,
        status            TEXT DEFAULT 'active',
        notes             TEXT,
        payment_method    TEXT,
        payment_proof_url TEXT,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE public.sport_payments
        ADD COLUMN IF NOT EXISTS entry_id BIGINT,
        ADD COLUMN IF NOT EXISTS posting_error TEXT,
        ADD COLUMN IF NOT EXISTS source_payment_id BIGINT,
        ADD COLUMN IF NOT EXISTS payment_provider TEXT,
        ADD COLUMN IF NOT EXISTS provider_code TEXT,
        ADD COLUMN IF NOT EXISTS provider_reference TEXT,
        ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
        ADD COLUMN IF NOT EXISTS merchant_trade_no TEXT,
        ADD COLUMN IF NOT EXISTS provider_trade_no TEXT,
        ADD COLUMN IF NOT EXISTS company_id INTEGER,
        ADD COLUMN IF NOT EXISTS bank_account_id TEXT,
        ADD COLUMN IF NOT EXISTS expected_settlement_date TEXT;
      ALTER TABLE public.accounting_entries
        ADD COLUMN IF NOT EXISTS payment_method TEXT,
        ADD COLUMN IF NOT EXISTS payment_provider TEXT,
        ADD COLUMN IF NOT EXISTS payment_type TEXT,
        ADD COLUMN IF NOT EXISTS source_payment_id BIGINT,
        ADD COLUMN IF NOT EXISTS company_id INTEGER,
        ADD COLUMN IF NOT EXISTS bank_account_id TEXT,
        ADD COLUMN IF NOT EXISTS provider_reference TEXT,
        ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
        ADD COLUMN IF NOT EXISTS merchant_trade_no TEXT,
        ADD COLUMN IF NOT EXISTS provider_trade_no TEXT;
      CREATE INDEX IF NOT EXISTS idx_public_sport_payments_source_payment_id
        ON public.sport_payments (source_payment_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_public_sport_payments_source_payment_id
        ON public.sport_payments (source_payment_id)
        WHERE source_payment_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_public_accounting_entries_source_payment_id
        ON public.accounting_entries (source_payment_id)
        WHERE source_payment_id IS NOT NULL;
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE t.typname = 'accounting_entry_source'
             AND n.nspname = 'public'
        ) THEN
          ALTER TYPE public.accounting_entry_source
            ADD VALUE IF NOT EXISTS 'sport_center_payment';
        END IF;
      END
      $$;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_public_accounting_entries_sc_payment_correlation
        ON public.accounting_entries (correlation_id)
        WHERE source = 'sport_center_payment'
          AND correlation_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS sport_center.payment_accounting_outbox (
        id SERIAL PRIMARY KEY,
        payment_id INTEGER NOT NULL REFERENCES sport_center.sport_payments(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL DEFAULT 'payment_confirmed',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_at TIMESTAMPTZ,
        processed_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT payment_accounting_outbox_payment_event_unique UNIQUE (payment_id, event_type)
      );
      CREATE INDEX IF NOT EXISTS payment_accounting_outbox_ready_idx
        ON sport_center.payment_accounting_outbox (status, available_at, locked_at);
      CREATE OR REPLACE FUNCTION sport_center.enqueue_payment_accounting_outbox()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status::text = 'confirmed' THEN
          IF TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'confirmed' THEN
            INSERT INTO sport_center.payment_accounting_outbox
              (payment_id, event_type, status, available_at, created_at, updated_at)
            VALUES (NEW.id, 'payment_confirmed', 'pending', NOW(), NOW(), NOW())
            ON CONFLICT (payment_id, event_type) DO UPDATE
              SET status = CASE
                    WHEN sport_center.payment_accounting_outbox.status = 'posted'
                      THEN sport_center.payment_accounting_outbox.status
                    ELSE 'pending'
                  END,
                  available_at = CASE
                    WHEN sport_center.payment_accounting_outbox.status = 'posted'
                      THEN sport_center.payment_accounting_outbox.available_at
                    ELSE NOW()
                  END,
                  locked_at = NULL,
                  updated_at = NOW();
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;
      DROP TRIGGER IF EXISTS trg_payment_accounting_outbox ON sport_center.sport_payments;
      CREATE TRIGGER trg_payment_accounting_outbox
      AFTER INSERT OR UPDATE OF status ON sport_center.sport_payments
      FOR EACH ROW EXECUTE FUNCTION sport_center.enqueue_payment_accounting_outbox();
      ALTER TABLE public.sport_payments
        ALTER COLUMN posting_status SET DEFAULT 'unposted';
    `);
    console.info("[bizportalSync] ✓ BizPortal tables ensured (schema: sport_center)");
  } catch (err: any) {
    console.warn(`[bizportalSync] ⚠ Could not ensure BizPortal tables: ${err?.message}`);
  }
}

export type LegacyPaymentLinkClassification =
  | "linked"
  | "safe_candidate"
  | "ambiguous"
  | "unresolved";

export type LegacySportCenterPaymentAuditRow = {
  accountingPaymentId: number;
  paymentNumber: string | null;
  ref: string | null;
  amount: number;
  entryId: number | null;
  entryExists: boolean;
  entryStatus: string | null;
  entrySource: string | null;
  linkedSportPaymentId: number | null;
  candidateSportPaymentIds: number[];
  refMatchCount: number;
  exactMatchCount: number;
  availableExactMatchCount: number;
  classification: LegacyPaymentLinkClassification;
};

export type LegacySportCenterPaymentAudit = {
  configured: boolean;
  scannedAt: string;
  totalRows: number;
  totalAmount: number;
  byClassification: Record<LegacyPaymentLinkClassification, { rows: number; amount: number }>;
  safeCandidateCount: number;
  safeCandidateAmount: number;
  exceptions: LegacySportCenterPaymentAuditRow[];
};

function classifyLegacyPaymentLink(row: {
  linkedSportPaymentId: number | null;
  refMatchCount: number;
  exactMatchCount: number;
  availableExactMatchCount: number;
}): LegacyPaymentLinkClassification {
  if (row.linkedSportPaymentId !== null) return "linked";
  if (row.availableExactMatchCount === 1 && row.exactMatchCount === 1) return "safe_candidate";
  if (row.exactMatchCount > 0 || row.refMatchCount > 0) return "ambiguous";
  return "unresolved";
}

/**
 * Audit the old public.accounting_payments stream without deleting or voiding
 * anything. The old table has no reliable reverse FK to public.sport_payments,
 * so only one-to-one ref+amount matches are eligible for linking.
 */
export async function auditLegacySportCenterPayments(): Promise<LegacySportCenterPaymentAudit> {
  const pool = getProdPool();
  const emptyByClassification = (): Record<LegacyPaymentLinkClassification, { rows: number; amount: number }> => ({
    linked: { rows: 0, amount: 0 },
    safe_candidate: { rows: 0, amount: 0 },
    ambiguous: { rows: 0, amount: 0 },
    unresolved: { rows: 0, amount: 0 },
  });
  const empty: LegacySportCenterPaymentAudit = {
    configured: Boolean(pool),
    scannedAt: new Date().toISOString(),
    totalRows: 0,
    totalAmount: 0,
    byClassification: emptyByClassification(),
    safeCandidateCount: 0,
    safeCandidateAmount: 0,
    exceptions: [],
  };
  if (!pool) return empty;

  const { rows } = await pool.query(`
    SELECT
      ap.id AS accounting_payment_id,
      ap.payment_number,
      ap.ref,
      ap.amount,
      ap.entry_id,
      ae.id AS entry_exists_id,
      ae.status::text AS entry_status,
      ae.source::text AS entry_source,
      linked.id AS linked_sport_payment_id,
      COALESCE(ref_matches.ref_match_count, 0)::int AS ref_match_count,
      COALESCE(exact_matches.exact_match_count, 0)::int AS exact_match_count,
      COALESCE(available_exact_matches.available_exact_match_count, 0)::int
        AS available_exact_match_count,
      COALESCE(exact_matches.candidate_ids, ARRAY[]::int[]) AS candidate_sport_payment_ids
    FROM public.accounting_payments ap
    LEFT JOIN public.accounting_entries ae ON ae.id = ap.entry_id
    LEFT JOIN LATERAL (
      SELECT sp.id
      FROM public.sport_payments sp
      WHERE sp.accounting_payment_id = ap.id
      ORDER BY sp.id
      LIMIT 1
    ) linked ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS ref_match_count
      FROM public.sport_payments sp
      WHERE ap.ref IS NOT NULL
        AND sp.payment_number = ap.ref
    ) ref_matches ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS exact_match_count,
        ARRAY_AGG(sp.id ORDER BY sp.id)::int[] AS candidate_ids
      FROM public.sport_payments sp
      WHERE ap.ref IS NOT NULL
        AND sp.payment_number = ap.ref
        AND sp.amount = ap.amount
    ) exact_matches ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS available_exact_match_count
      FROM public.sport_payments sp
      WHERE ap.ref IS NOT NULL
        AND sp.payment_number = ap.ref
        AND sp.amount = ap.amount
        AND sp.accounting_payment_id IS NULL
    ) available_exact_matches ON true
    WHERE ap.source_type = 'sport_center'
    ORDER BY ap.id
  `);

  const auditRows: LegacySportCenterPaymentAuditRow[] = rows.map((row: any) => {
    const normalized = {
      linkedSportPaymentId: row.linked_sport_payment_id == null ? null : Number(row.linked_sport_payment_id),
      refMatchCount: Number(row.ref_match_count ?? 0),
      exactMatchCount: Number(row.exact_match_count ?? 0),
      availableExactMatchCount: Number(row.available_exact_match_count ?? 0),
    };
    return {
      accountingPaymentId: Number(row.accounting_payment_id),
      paymentNumber: row.payment_number == null ? null : String(row.payment_number),
      ref: row.ref == null ? null : String(row.ref),
      amount: Number(row.amount ?? 0),
      entryId: row.entry_id == null ? null : Number(row.entry_id),
      entryExists: row.entry_exists_id != null,
      entryStatus: row.entry_status == null ? null : String(row.entry_status),
      entrySource: row.entry_source == null ? null : String(row.entry_source),
      linkedSportPaymentId: normalized.linkedSportPaymentId,
      candidateSportPaymentIds: Array.isArray(row.candidate_sport_payment_ids)
        ? row.candidate_sport_payment_ids.map(Number)
        : [],
      refMatchCount: normalized.refMatchCount,
      exactMatchCount: normalized.exactMatchCount,
      availableExactMatchCount: normalized.availableExactMatchCount,
      classification: classifyLegacyPaymentLink(normalized),
    };
  });

  const byClassification = emptyByClassification();
  for (const row of auditRows) {
    const bucket = byClassification[row.classification];
    bucket.rows++;
    bucket.amount += row.amount;
  }

  return {
    configured: true,
    scannedAt: new Date().toISOString(),
    totalRows: auditRows.length,
    totalAmount: auditRows.reduce((sum, row) => sum + row.amount, 0),
    byClassification,
    safeCandidateCount: byClassification.safe_candidate.rows,
    safeCandidateAmount: byClassification.safe_candidate.amount,
    // Keep the endpoint useful without exposing the entire historical table.
    exceptions: auditRows
      .filter((row) => row.classification !== "linked")
      .slice(0, 100),
  };
}

/**
 * Link only deterministic legacy rows. This is intentionally an UPDATE of a
 * nullable reference, never a DELETE/void/reversal of either audit stream.
 * Callers must opt in with apply=true; dry-run is the default.
 */
export async function reconcileLegacySportCenterPaymentLinks(options?: {
  apply?: boolean;
}): Promise<
  LegacySportCenterPaymentAudit & {
    applied: boolean;
    linkedRows: number;
    appliedCandidateCount: number;
    appliedCandidateAmount: number;
  }
> {
  const audit = await auditLegacySportCenterPayments();
  const apply = options?.apply === true;
  const pool = getProdPool();
  if (!apply || !pool || audit.safeCandidateCount === 0) {
    return {
      ...audit,
      applied: false,
      linkedRows: 0,
      appliedCandidateCount: 0,
      appliedCandidateAmount: 0,
    };
  }

  const appliedCandidateCount = audit.safeCandidateCount;
  const appliedCandidateAmount = audit.safeCandidateAmount;
  const client = await pool.connect();
  let linkedRows = 0;
  try {
    await client.query("BEGIN");
    const updateResult = await client.query(`
      UPDATE public.sport_payments sp
         SET accounting_payment_id = ap.id,
             updated_at = NOW()
        FROM public.accounting_payments ap
       WHERE ap.source_type = 'sport_center'
         AND ap.ref IS NOT NULL
         AND sp.accounting_payment_id IS NULL
         AND sp.payment_number = ap.ref
         AND sp.amount = ap.amount
         AND NOT EXISTS (
           SELECT 1
           FROM public.sport_payments already_linked
           WHERE already_linked.accounting_payment_id = ap.id
         )
         AND (
           SELECT COUNT(*)
           FROM public.sport_payments same_ref
           WHERE same_ref.payment_number = ap.ref
         ) = 1
         AND (
           SELECT COUNT(*)
           FROM public.sport_payments same_exact
           WHERE same_exact.payment_number = ap.ref
             AND same_exact.amount = ap.amount
             AND same_exact.accounting_payment_id IS NULL
         ) = 1
    `);
    linkedRows = updateResult.rowCount ?? 0;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const after = await auditLegacySportCenterPayments();
  return {
    ...after,
    applied: true,
    linkedRows,
    appliedCandidateCount,
    appliedCandidateAmount,
  };
}

// In-memory last sync tracking for diagnostic endpoint
export const lastSyncState = {
  booking:    { at: null as string | null, success: null as boolean | null, error: null as string | null },
  membership: { at: null as string | null, success: null as boolean | null, error: null as string | null },
  status:     { at: null as string | null, success: null as boolean | null, error: null as string | null },
};

async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 2): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        console.warn(`[bizportalSync] Retry ${attempt + 1}/${retries} for ${label}: ${err?.message}`);
      }
    }
  }
  throw lastErr;
}

function toStatus(scStatus: string): string {
  switch (scStatus) {
    case "confirmed":  return "confirmed";
    case "completed":  return "completed";
    case "cancelled":
    case "rejected":
    case "expired":
    case "refunded":   return "cancelled";
    default:           return "pending_payment";
  }
}

function toPaymentStatus(scStatus: string): string {
  switch (scStatus) {
    case "paid":
    case "confirmed":
    case "completed":         return "paid";
    case "waiting_confirmation": return "pending";
    default:                  return "unpaid";
  }
}

export interface SyncBookingPayload {
  booking: Booking;
  facilityName: string;
  facilityCategory?: string | null;
  paymentProofUrl?: string | null;
  paidAt?: Date | null;

  /** group_ref dari booking gabungan (misal GRP-12345) */
  groupRef?: string | null;
  /** Total nominal seluruh booking dalam satu group (untuk rekonsiliasi bank) */
  groupTotal?: number | null;

  /** Override total_price sent to BizPortal (used for group bookings: primary=groupTotal, siblings=0) */
  overrideTotalPrice?: number;

}


function calcTaxBreakdown(booking: Booking): {
  ppnRate: number | null;
  dpp: number | null;
  dppNilaiLain: number | null;
  ppnAmount: number | null;
  grandTotal: number | null;
} {
  const rate = booking.ppnRate != null ? Number(booking.ppnRate) : null;
  const storedPpn = booking.ppnAmount != null ? Math.round(Number(booking.ppnAmount)) : null;
  const storedGrand = booking.grandTotal != null ? Math.round(Number(booking.grandTotal)) : null;

  if (rate === null || rate === 0 || storedPpn === null || storedGrand === null) {
    return { ppnRate: null, dpp: null, dppNilaiLain: null, ppnAmount: null, grandTotal: null };
  }

  const dpp = storedGrand - storedPpn;
  const dppNilaiLain = Math.round(dpp * 11 / 12);
  return { ppnRate: rate, dpp, dppNilaiLain, ppnAmount: storedPpn, grandTotal: storedGrand };
}

export async function syncBookingToBizportal(payload: SyncBookingPayload): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;


  const { booking, facilityName, facilityCategory, paymentProofUrl, paidAt, groupRef, groupTotal, overrideTotalPrice } = payload;
  // facility_id di sport_bookings_sync adalah INTEGER — kirim langsung, bukan string "sc-X"
  const bizFacilityId = booking.facilityId;

  const status        = toStatus(booking.status);
  const paymentStatus = toPaymentStatus(booking.status);
  const tax           = calcTaxBreakdown(booking);
  const totalPriceSent = overrideTotalPrice !== undefined ? overrideTotalPrice : Math.round(Number(booking.totalPrice));

  try {
    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.sport_bookings_sync
          (booking_code, facility_id, facility_name, customer_name, customer_phone, customer_email,
           date, start_time, end_time, total_hours, total_price, notes, status,
           payment_status, payment_proof_url, payment_proof_at,
           ppn_rate, dpp, dpp_nilai_lain, ppn_amount, grand_total,
           group_ref, group_total,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW())
         ON CONFLICT (booking_code) DO UPDATE SET
           facility_name     = EXCLUDED.facility_name,
           customer_name     = EXCLUDED.customer_name,
           customer_phone    = EXCLUDED.customer_phone,
           customer_email    = EXCLUDED.customer_email,
           date              = EXCLUDED.date,
           start_time        = EXCLUDED.start_time,
           end_time          = EXCLUDED.end_time,
           total_hours       = EXCLUDED.total_hours,
           total_price       = EXCLUDED.total_price,
           notes             = EXCLUDED.notes,
           status            = EXCLUDED.status,
           payment_status    = EXCLUDED.payment_status,
           payment_proof_url = COALESCE(EXCLUDED.payment_proof_url, sport_bookings_sync.payment_proof_url),
           payment_proof_at  = COALESCE(EXCLUDED.payment_proof_at,  sport_bookings_sync.payment_proof_at),

           ppn_rate          = COALESCE(EXCLUDED.ppn_rate,          sport_bookings_sync.ppn_rate),
           dpp               = COALESCE(EXCLUDED.dpp,               sport_bookings_sync.dpp),
           dpp_nilai_lain    = COALESCE(EXCLUDED.dpp_nilai_lain,    sport_bookings_sync.dpp_nilai_lain),
           ppn_amount        = COALESCE(EXCLUDED.ppn_amount,        sport_bookings_sync.ppn_amount),
           grand_total       = COALESCE(EXCLUDED.grand_total,       sport_bookings_sync.grand_total),
           group_ref         = COALESCE(EXCLUDED.group_ref,         sport_bookings_sync.group_ref),
           group_total       = COALESCE(EXCLUDED.group_total,       sport_bookings_sync.group_total),

           ppn_rate          = EXCLUDED.ppn_rate,
           dpp               = EXCLUDED.dpp,
           dpp_nilai_lain    = EXCLUDED.dpp_nilai_lain,
           ppn_amount        = EXCLUDED.ppn_amount,
           grand_total       = EXCLUDED.grand_total,

           updated_at        = NOW()`,
        [
          booking.orderNumber,
          bizFacilityId,
          facilityName,
          booking.customerName,
          booking.customerPhone,
          booking.customerEmail,
          booking.bookingDate,
          booking.startTime,
          booking.endTime,
          booking.durationHours,
          totalPriceSent,
          booking.notes || null,
          status,
          paymentStatus,
          paymentProofUrl || null,
          paidAt || null,
          tax.ppnRate,
          tax.dpp,
          tax.dppNilaiLain,
          tax.ppnAmount,
          tax.grandTotal,
          groupRef || (booking as any).groupRef || null,
          groupTotal ?? null,
          booking.createdAt,
        ]
      );
    }, `syncBooking:${booking.orderNumber}`);

    lastSyncState.booking = { at: new Date().toISOString(), success: true, error: null };
    console.info(`[bizportalSync] ✓ Booking synced: ${booking.orderNumber} → ${status}`);
  } catch (err: any) {
    lastSyncState.booking = { at: new Date().toISOString(), success: false, error: err?.message };
    console.error(`[bizportalSync] ✗ Booking sync failed: ${booking.orderNumber} — ${err?.message}`);
    // Rethrow so callers that await this (e.g. the manual full-resync endpoint)
    // can correctly count failures. Fire-and-forget call sites already use
    // `.catch(() => {})`, so this is safe for them.
    throw err;
  }
}

export async function syncMembershipToBizportal(membership: GymMembership): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  try {
    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.sport_memberships_sync
          (id, name, email, phone, start_date, end_date, months, total_price,
           status, notes, payment_method, payment_proof_url, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET
           name              = EXCLUDED.name,
           email             = EXCLUDED.email,
           phone             = EXCLUDED.phone,
           start_date        = EXCLUDED.start_date,
           end_date          = EXCLUDED.end_date,
           months            = EXCLUDED.months,
           total_price       = EXCLUDED.total_price,
           status            = EXCLUDED.status,
           notes             = EXCLUDED.notes,
           payment_method    = COALESCE(EXCLUDED.payment_method,    sport_memberships_sync.payment_method),
           payment_proof_url = COALESCE(EXCLUDED.payment_proof_url, sport_memberships_sync.payment_proof_url),
           updated_at        = EXCLUDED.updated_at`,
        [
          membership.id,
          membership.name,
          membership.email,
          membership.phone,
          membership.startDate,
          membership.endDate,
          membership.months,
          Math.round(Number(membership.totalPrice)),
          membership.status,
          membership.notes || null,
          membership.paymentMethod || null,
          membership.paymentProofUrl || null,
          membership.createdAt,
          membership.updatedAt,
        ]
      );
    }, `syncMembership:${membership.id}`);

    lastSyncState.membership = { at: new Date().toISOString(), success: true, error: null };
    console.info(`[bizportalSync] ✓ Membership synced: ID=${membership.id} → ${membership.status}`);
  } catch (err: any) {
    lastSyncState.membership = { at: new Date().toISOString(), success: false, error: err?.message };
    console.error(`[bizportalSync] ✗ Membership sync failed: ID=${membership.id} — ${err?.message}`);
    throw err;
  }
}

export async function deleteBookingFromBizportal(orderNumber: string): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  try {
    await withRetry(async () => {
      await pool.query(
        `DELETE FROM sport_center.sport_bookings_sync WHERE booking_code = $1`,
        [orderNumber]
      );
    }, `deleteBooking:${orderNumber}`);

    console.info(`[bizportalSync] ✓ Booking deleted from BizPortal: ${orderNumber}`);
  } catch (err: any) {
    console.error(`[bizportalSync] ✗ Booking delete failed: ${orderNumber} — ${err?.message}`);
  }
}

// ── Bank Mutation Push ──────────────────────────────────────────────────────
// Saat booking payment dikonfirmasi, otomatis buat entry bank_mutations
// dengan bankAccountId = nomor rekening dari settings (Mandiri CST).
// Idempotent: mutationKey 'SC-{orderNumber}' dicek sebelum insert.
export async function pushConfirmedPaymentAsBankMutation(
  booking: Booking,
  confirmedAt?: Date | null,
): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const amount =
    booking.grandTotal != null && Number(booking.grandTotal) > 0
      ? Math.round(Number(booking.grandTotal))
      : Math.round(Number(booking.totalPrice));
  if (amount <= 0) return;

  const mutationKey = `SC-${booking.orderNumber}`;
  const transactionDate = confirmedAt
    ? confirmedAt.toISOString().split("T")[0]!
    : new Date().toISOString().split("T")[0]!;
  const description = `SPORT CENTER | ${booking.orderNumber} | ${booking.customerName}`;
  const normalizedDescription = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  try {
    // Ambil bankAccountId (nomor rekening Mandiri CST) dari settings
    let bankAccountId: string | null = null;
    try {
      const { rows } = await pool.query(
        `SELECT bank_account FROM sport_center.settings LIMIT 1`,
      );
      if (rows[0]?.bank_account) bankAccountId = String(rows[0].bank_account);
    } catch {
      // non-fatal — lanjut tanpa bankAccountId
    }

    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.bank_mutations
           (bank_account_id, transaction_date, description, credit_amount, debit_amount,
            amount, direction, mutation_key, normalized_description, provider_order_id,
            status, matched_order_id, created_at, updated_at)
         SELECT $1,$2,$3,$4,'0',$4,'IN',$5,$6,$7,'auto_matched',$8,NOW(),NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM sport_center.bank_mutations WHERE mutation_key = $5
         )`,
        [
          bankAccountId,
          transactionDate,
          description,
          String(amount),
          mutationKey,
          normalizedDescription,
          booking.orderNumber,
          booking.id,
        ],
      );
    }, `pushBankMutation:${booking.orderNumber}`);

    console.info(`[bizportalSync] ✓ Bank mutation created: ${booking.orderNumber} → Rp ${amount.toLocaleString("id-ID")}`);
  } catch (err: any) {
    console.error(`[bizportalSync] ✗ Bank mutation push failed: ${booking.orderNumber} — ${err?.message}`);
  }
}

async function getBankAccountId(pool: pg.Pool): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT bank_account FROM sport_center.settings LIMIT 1`,
    );
    return rows[0]?.bank_account ? String(rows[0].bank_account) : null;
  } catch {
    return null;
  }
}

// ── Membership Bank Mutation Push ───────────────────────────────────────────
// Saat membership gym berstatus "active" (lunas), otomatis buat entry
// bank_mutations dengan bankAccountId = nomor rekening dari settings (Mandiri CST).
// Idempotent: mutationKey 'SC-MB-{id}' dicek sebelum insert.
export async function pushMembershipPaymentAsBankMutation(
  membership: GymMembership,
  confirmedAt?: Date | null,
): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const amount = Math.round(Number(membership.totalPrice));
  if (amount <= 0) return;

  const mutationKey = `SC-MB-${membership.id}`;
  const transactionDate = confirmedAt
    ? confirmedAt.toISOString().split("T")[0]!
    : new Date().toISOString().split("T")[0]!;
  const description = `SPORT CENTER MEMBER GYM | MB-${membership.id} | ${membership.name}`;
  const normalizedDescription = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  try {
    const bankAccountId = await getBankAccountId(pool);

    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.bank_mutations
           (bank_account_id, transaction_date, description, credit_amount, debit_amount,
            amount, direction, mutation_key, normalized_description, provider_order_id,
            status, matched_order_id, created_at, updated_at)
         SELECT $1,$2,$3,$4,'0',$4,'IN',$5,$6,$7,'auto_matched',$8,NOW(),NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM sport_center.bank_mutations WHERE mutation_key = $5
         )`,
        [
          bankAccountId,
          transactionDate,
          description,
          String(amount),
          mutationKey,
          normalizedDescription,
          mutationKey,
          null,
        ],
      );
    }, `pushMembershipMutation:${membership.id}`);

    console.info(`[bizportalSync] ✓ Bank mutation created (membership): MB-${membership.id} → Rp ${amount.toLocaleString("id-ID")}`);
  } catch (err: any) {
    console.error(`[bizportalSync] ✗ Bank mutation push failed (membership): MB-${membership.id} — ${err?.message}`);
  }
}

// ── Company Invoice Bank Mutation Push ──────────────────────────────────────
// Saat invoice perusahaan ditandai "paid" (lunas), otomatis buat entry
// bank_mutations dengan bankAccountId = nomor rekening dari settings (Mandiri CST).
// Idempotent: mutationKey 'SC-INV-{invoiceNumber}' dicek sebelum insert.
export async function pushInvoicePaymentAsBankMutation(
  invoice: CompanyInvoice,
  companyName?: string | null,
  confirmedAt?: Date | null,
): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const amount =
    invoice.grandTotal != null && Number(invoice.grandTotal) > 0
      ? Math.round(Number(invoice.grandTotal))
      : Math.round(Number(invoice.totalAmount));
  if (amount <= 0) return;

  const mutationKey = `SC-INV-${invoice.invoiceNumber}`;
  const transactionDate = confirmedAt
    ? confirmedAt.toISOString().split("T")[0]!
    : new Date().toISOString().split("T")[0]!;
  const description = `SPORT CENTER INVOICE PERUSAHAAN | ${invoice.invoiceNumber} | ${companyName || ""}`.trim();
  const normalizedDescription = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  try {
    const bankAccountId = await getBankAccountId(pool);

    await withRetry(async () => {
      await pool.query(
        `INSERT INTO sport_center.bank_mutations
           (bank_account_id, transaction_date, description, credit_amount, debit_amount,
            amount, direction, mutation_key, normalized_description, provider_order_id,
            status, matched_order_id, created_at, updated_at)
         SELECT $1,$2,$3,$4,'0',$4,'IN',$5,$6,$7,'auto_matched',$8,NOW(),NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM sport_center.bank_mutations WHERE mutation_key = $5
         )`,
        [
          bankAccountId,
          transactionDate,
          description,
          String(amount),
          mutationKey,
          normalizedDescription,
          mutationKey,
          null,
        ],
      );
    }, `pushInvoiceMutation:${invoice.invoiceNumber}`);

    console.info(`[bizportalSync] ✓ Bank mutation created (invoice): ${invoice.invoiceNumber} → Rp ${amount.toLocaleString("id-ID")}`);
  } catch (err: any) {
    console.error(`[bizportalSync] ✗ Bank mutation push failed (invoice): ${invoice.invoiceNumber} — ${err?.message}`);
  }
}

// ── Bulk Payment Push ────────────────────────────────────────────────────────
// Push semua payment confirmed dari Sport Center ke public.sport_payments BizPortal.
// Idempotent: payment_number 'SCPAY-SC-{sc_payment_id}' dicek sebelum insert.
// Juga update payment_status di public.sport_bookings agar konsisten.
export interface BulkPaymentPushResult {
  total: number;
  pushed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export async function countPendingPaymentMirrors(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query(`
    SELECT COUNT(*) AS pending
    FROM sport_center.sport_payments sp
    JOIN sport_center.sport_bookings sb ON sb.id = sp.booking_id
    LEFT JOIN public.sport_bookings pb ON pb.sc_booking_id = sb.id
    LEFT JOIN public.sport_payments bpay
      ON bpay.payment_number = 'SCPAY-SC-' || sp.id::text
    LEFT JOIN public.accounting_entries bentry ON bentry.id = bpay.entry_id
    WHERE sp.status = 'confirmed'
      AND pb.id IS NOT NULL
      AND (
        bpay.id IS NULL
        OR bpay.posting_status IS DISTINCT FROM 'posted'
        OR bpay.entry_id IS NULL
        OR bentry.id IS NULL
        OR bentry.status IS DISTINCT FROM 'posted'
      )
  `);
  return Number(rows[0]?.pending ?? 0);
}

/**
 * Claim and process durable payment-confirmation events. The database trigger
 * creates the outbox row in the same transaction as confirmation, so a
 * process crash cannot lose the accounting/mirror work.
 */
export async function processPaymentAccountingOutbox(): Promise<{
  claimed: number;
  posted: number;
  retried: number;
}> {
  const pool = getProdPool();
  if (!pool) return { claimed: 0, posted: 0, retried: 0 };

  const client = await pool.connect();
  let claimed: Array<{ id: number; payment_id: number }> = [];
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT id, payment_id
        FROM sport_center.payment_accounting_outbox
       WHERE status IN ('pending', 'failed')
         AND available_at <= NOW()
         AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '15 minutes')
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 50
    `);
    claimed = result.rows.map((row) => ({
      id: Number(row.id),
      payment_id: Number(row.payment_id),
    }));
    if (claimed.length > 0) {
      await client.query(
        `UPDATE sport_center.payment_accounting_outbox
            SET status = 'processing',
                attempts = attempts + 1,
                locked_at = NOW(),
                updated_at = NOW()
          WHERE id = ANY($1::int[])`,
        [claimed.map((row) => row.id)],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    throw err;
  }
  client.release();

  if (claimed.length === 0) return { claimed: 0, posted: 0, retried: 0 };

  // The bulk path is idempotent and handles both missing mirrors and failed
  // public entries. It also preserves DP/pelunasan payment-level identity.
  await bulkPushPaymentsToBizportal();

  let posted = 0;
  let retried = 0;
  for (const event of claimed) {
    try {
      const result = await pool.query(`
        SELECT sp.status,
               m.posting_status,
               m.entry_id,
               ae.status AS entry_status
          FROM sport_center.sport_payments sp
          LEFT JOIN public.sport_payments m
            ON m.source_payment_id = sp.id
            OR m.payment_number = 'SCPAY-SC-' || sp.id::text
          LEFT JOIN public.accounting_entries ae
            ON ae.id = m.entry_id
         WHERE sp.id = $1
         ORDER BY CASE WHEN m.source_payment_id = sp.id THEN 0 ELSE 1 END
         LIMIT 1
      `, [event.payment_id]);
      const row = result.rows[0];
      const complete =
        row?.status === "confirmed" &&
        row?.posting_status === "posted" &&
        row?.entry_id != null &&
        row?.entry_status === "posted";

      if (complete) {
        await pool.query(
          `UPDATE sport_center.payment_accounting_outbox
              SET status = 'posted', processed_at = NOW(), locked_at = NULL,
                  last_error = NULL, updated_at = NOW()
            WHERE id = $1`,
          [event.id],
        );
        posted++;
      } else {
        await pool.query(
          `UPDATE sport_center.payment_accounting_outbox
              SET status = 'failed',
                  available_at = NOW() + LEAST(INTERVAL '1 hour', INTERVAL '5 minutes' * GREATEST(attempts, 1)),
                  locked_at = NULL,
                  last_error = $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [event.id, "PAYMENT_ACCOUNTING_INCOMPLETE"],
        );
        retried++;
      }
    } catch (err: any) {
      await pool.query(
        `UPDATE sport_center.payment_accounting_outbox
            SET status = 'failed',
                available_at = NOW() + LEAST(INTERVAL '1 hour', INTERVAL '5 minutes' * GREATEST(attempts, 1)),
                locked_at = NULL,
                last_error = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [event.id, String(err?.message ?? err).slice(0, 1000)],
      ).catch(() => {});
      retried++;
    }
  }

  return { claimed: claimed.length, posted, retried };
}

export async function bulkPushPaymentsToBizportal(): Promise<BulkPaymentPushResult> {
  const pool = getProdPool();
  if (!pool) return { total: 0, pushed: 0, skipped: 0, failed: 0, errors: [] };

  const result: BulkPaymentPushResult = { total: 0, pushed: 0, skipped: 0, failed: 0, errors: [] };

  try {
    // Ambil semua SC payments confirmed beserta data booking-nya.
    // Tidak menggunakan grand_total booking — setiap baris payment punya amount-nya
    // sendiri (penting untuk flow DP/pelunasan agar tidak double-count).
    const { rows: scPayments } = await pool.query(`
      SELECT
        sp.id             AS sc_payment_id,
        sp.amount         AS payment_amount,
        sp.payment_method,
        sp.payment_provider,
        sp.company_id,
        sp.bank_account_id,
        sp.expected_settlement_date,
        sp.provider_reference,
        sp.provider_order_id,
        sp.merchant_trade_no,
        sp.provider_trade_no,
        sp.payment_type,
        COALESCE(sp.paid_at, sp.confirmed_at) AS paid_at,
        sp.created_at     AS payment_created_at,
        sb.order_number,
        sb.ppn_rate,
        sb.ppn_amount,
        pb.id             AS biz_booking_id
      FROM sport_center.sport_payments sp
      JOIN sport_center.sport_bookings sb ON sb.id = sp.booking_id
      LEFT JOIN public.sport_bookings pb ON pb.sc_booking_id = sb.id
      WHERE sp.status = 'confirmed'
      ORDER BY sp.id
    `);

    result.total = scPayments.length;

    for (const p of scPayments) {
      const paymentNumber = `SCPAY-SC-${p.sc_payment_id}`;
      try {
        if (!p.biz_booking_id) {
          // Booking SC belum ada di BizPortal — skip
          result.skipped++;
          continue;
        }

        // Gunakan jumlah yang benar-benar dibayar per payment record (bukan grand_total booking)
        const amount  = Math.round(Number(p.payment_amount));
        const taxRate = p.ppn_rate   != null ? Number(p.ppn_rate)   : 0;
        // Distribusikan PPN secara proporsional tidak diperlukan untuk pencatatan BizPortal;
        // masukkan 0 agar tidak salah alokasi — BizPortal menghitung ulang dari tarifnya sendiri.
        const taxAmount = 0;

        // INSERT ... ON CONFLICT DO NOTHING — atomik dan idempotent tanpa race condition
        const { rowCount } = await pool.query(
          `INSERT INTO public.sport_payments
             (booking_id, payment_number, amount, method, status, paid_at,
              payment_type, tax_rate, tax_amount, source, posting_status, source_payment_id,
               payment_provider, provider_code, provider_reference, provider_order_id, merchant_trade_no, provider_trade_no,
              company_id, bank_account_id, expected_settlement_date,
              created_at, updated_at)
           VALUES ($1,$2,$3,$4,'paid',$5,$6,$7,$8,'SPORT_CENTER_SUPABASE','unposted',$9,
                    $10,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
           ON CONFLICT (payment_number) DO NOTHING`,
          [
            p.biz_booking_id,
            paymentNumber,
            String(amount),
            p.payment_method || 'Transfer Bank',
            p.paid_at || p.payment_created_at,
            p.payment_type || 'booking',
            taxRate,
            taxAmount,
            p.sc_payment_id,
            p.payment_provider || null,
            p.provider_reference || null,
            p.provider_order_id || null,
            p.merchant_trade_no || null,
            p.provider_trade_no || null,
            p.company_id || null,
            p.bank_account_id || null,
            p.expected_settlement_date || null,
          ]
        );
        // Replays also repair metadata on an already-existing mirror without
        // overwriting a non-null provider value with an older/null payload.
        await pool.query(
          `UPDATE public.sport_payments
              SET source_payment_id = COALESCE(source_payment_id, $2),
                  payment_provider = COALESCE(payment_provider, provider_code, $3),
                  provider_code = COALESCE(payment_provider, provider_code, $3),
                  provider_reference = COALESCE(provider_reference, $4),
                   provider_order_id = COALESCE(provider_order_id, $5),
                   merchant_trade_no = COALESCE(merchant_trade_no, $6),
                   provider_trade_no = COALESCE(provider_trade_no, $7),
                   company_id = COALESCE(company_id, $8),
                   bank_account_id = COALESCE(bank_account_id, $9),
                   expected_settlement_date = COALESCE(expected_settlement_date, $10),
                   paid_at = COALESCE(paid_at, $11),
                  updated_at = NOW()
            WHERE payment_number = $1`,
          [
            paymentNumber,
            p.sc_payment_id,
            p.payment_provider || null,
            p.provider_reference || null,
            p.provider_order_id || null,
            p.merchant_trade_no || null,
            p.provider_trade_no || null,
            p.company_id || null,
            p.bank_account_id || null,
            p.expected_settlement_date || null,
            p.paid_at || p.payment_created_at,
          ],
        );

        const mirroredPaymentResult = await pool.query(
          `SELECT id, entry_id, posting_status
             FROM public.sport_payments
            WHERE payment_number = $1
            LIMIT 1`,
          [paymentNumber],
        );
        const mirroredPayment = mirroredPaymentResult.rows[0];
        if (!mirroredPayment) {
          throw new Error(`Payment mirror ${paymentNumber} tidak ditemukan setelah upsert.`);
        }

        const wasAlreadyPresent = (rowCount ?? 0) === 0;
        if (wasAlreadyPresent && mirroredPayment.posting_status === "posted" && mirroredPayment.entry_id) {
          // Mirror dan accounting sudah selesai dari sync sebelumnya.
          result.skipped++;
        } else {
          await postSportCenterBookingPayment({
            paymentNumber,
            bookingId: Number(p.biz_booking_id),
            orderNumber: String(p.order_number),
            amount,
            paymentMethod: p.payment_method,
            paymentType: p.payment_type,
            paidAt: p.paid_at || p.payment_created_at,
            ppnRate: taxRate,
            sourcePaymentId: Number(p.sc_payment_id),
          });

          if (wasAlreadyPresent) {
            result.skipped++;
          } else {
            result.pushed++;
          }
        }

        // Update payment_status di public.sport_bookings hanya jika semua payment booking ini sudah confirmed
        await pool.query(
          `UPDATE public.sport_bookings pb
           SET payment_status = 'paid', updated_at = NOW()
           WHERE pb.id = $1
             AND pb.payment_status != 'paid'
             AND NOT EXISTS (
               SELECT 1 FROM sport_center.sport_payments sp2
               JOIN sport_center.sport_bookings sb2 ON sb2.id = sp2.booking_id
               WHERE sb2.id = (SELECT sc_booking_id FROM public.sport_bookings WHERE id = $1)
                 AND sp2.status != 'confirmed'
                 AND sp2.payment_type != 'dp'
             )`,
          [p.biz_booking_id]
        );

        console.info(`[bizportalSync] ✓ Payment pushed: ${p.order_number} (${paymentNumber}) → Rp ${amount.toLocaleString('id-ID')}`);
      } catch (err: any) {
        result.failed++;
        result.errors.push(`${p.order_number} (SC-PAY-${p.sc_payment_id}): ${err?.message ?? 'unknown'}`);
        console.error(`[bizportalSync] ✗ Payment push failed: ${p.order_number} — ${err?.message}`);
      }
    }
  } catch (err: any) {
    // Fatal error (e.g. DB query gagal sebelum loop) — hitung sebagai failure
    result.failed++;
    result.errors.push(`Fatal: ${err?.message}`);
    console.error(`[bizportalSync] ✗ bulkPushPaymentsToBizportal fatal: ${err?.message}`);
  }

  return result;
}

export async function syncStatusToBizportal(
  orderNumber: string,
  scStatus: string,
  paymentProofUrl?: string | null,
  paidAt?: Date | null,
  booking?: Booking
): Promise<void> {
  const pool = getProdPool();
  if (!pool) return;

  const tax = booking ? calcTaxBreakdown(booking) : null;

  try {
    await withRetry(async () => {
      await pool.query(
        `UPDATE sport_center.sport_bookings_sync
         SET status            = $2,
             payment_status    = $3,
             payment_proof_url = COALESCE($4, payment_proof_url),
             payment_proof_at  = COALESCE($5, payment_proof_at),
             ppn_rate          = COALESCE($6, ppn_rate),
             dpp               = COALESCE($7, dpp),
             dpp_nilai_lain    = COALESCE($8, dpp_nilai_lain),
             ppn_amount        = COALESCE($9, ppn_amount),
             grand_total       = COALESCE($10, grand_total),
             updated_at        = NOW()
         WHERE booking_code    = $1`,
        [
          orderNumber,
          toStatus(scStatus),
          toPaymentStatus(scStatus),
          paymentProofUrl || null,
          paidAt || null,
          tax?.ppnRate ?? null,
          tax?.dpp ?? null,
          tax?.dppNilaiLain ?? null,
          tax?.ppnAmount ?? null,
          tax?.grandTotal ?? null,
        ]
      );
    }, `syncStatus:${orderNumber}`);

    lastSyncState.status = { at: new Date().toISOString(), success: true, error: null };
    console.info(`[bizportalSync] ✓ Status synced: ${orderNumber} → ${toStatus(scStatus)}`);
  } catch (err: any) {
    lastSyncState.status = { at: new Date().toISOString(), success: false, error: err?.message };
    console.error(`[bizportalSync] ✗ Status sync failed: ${orderNumber} — ${err?.message}`);
  }
}
