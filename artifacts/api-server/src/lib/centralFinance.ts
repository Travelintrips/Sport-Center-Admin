import pg from "pg";
import { isCentralFinanceMode, getSportCenterFinanceMode } from "./financeBoundary";
import {
  postSportCenterBookingPayment,
  type SportCenterBookingPaymentPosting,
} from "./accounting";

const DEV_DB_URL = process.env.SUPABASE_DATABASE_URL_DEV;
let centralPool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  if (!DEV_DB_URL) return null;
  centralPool ??= new pg.Pool({
    connectionString: DEV_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });
  return centralPool;
}

type FinanceEvent = {
  outboxId: number;
  paymentId: number;
  bookingId: number;
  companyId: number | null;
  amount: number;
  paymentType: string;
  paymentMethod: string | null;
  paymentProvider: string | null;
  providerReference: string | null;
  providerOrderId: string | null;
  paidAt: string | null;
  confirmedAt: string | null;
  correlationId: string;
  orderNumber: string;
};

type ConfigResult = {
  companyId: number;
  taxRate: number;
  settlementBankAccountId: string;
  provider: string;
};

function isDeterministicConfigError(message: string): boolean {
  return /COMPANY_|PROVIDER_MISSING|PAYMENT_METHOD_MISSING|CONFIG_|TAX_|COA_|AMBIGUOUS|INACTIVE/.test(message);
}

async function resolveConfig(pool: pg.Pool, event: FinanceEvent): Promise<ConfigResult> {
  if (event.companyId == null) throw new Error("COMPANY_MISSING");

  const company = await pool.query(
    `SELECT id FROM public.companies WHERE id = $1 AND is_active = true LIMIT 1`,
    [event.companyId],
  );
  if (company.rows.length !== 1) throw new Error("COMPANY_MISSING_OR_INACTIVE");

  const provider = String(event.paymentProvider ?? "").trim().toLowerCase();
  if (!event.paymentMethod?.trim()) throw new Error("PAYMENT_METHOD_MISSING");
  if (event.paymentMethod.trim().toUpperCase() === "QRIS" && !provider) {
    throw new Error("PROVIDER_MISSING");
  }

  const effectiveDate = (event.paidAt ?? event.confirmedAt ?? new Date().toISOString()).slice(0, 10);
  const settlement = await pool.query(
    `SELECT bank_account_id
       FROM sport_center.payment_settlement_configs
      WHERE company_id = $1
        AND provider_code = $2
        AND is_active = true
        AND effective_from <= $3::date
        AND (effective_until IS NULL OR effective_until >= $3::date)
      ORDER BY effective_from DESC
      LIMIT 2`,
    [event.companyId, provider || "mandiri_direct", effectiveDate],
  );
  if (settlement.rows.length !== 1) throw new Error("CONFIG_SETTLEMENT_AMBIGUOUS_OR_MISSING");

  const tax = await pool.query(
    `SELECT tax_rate
       FROM sport_center.tax_settings
      WHERE is_active = true
        AND applies_to = 'sport_booking'
        AND (effective_date IS NULL OR effective_date <= $1::date)
      ORDER BY effective_date DESC NULLS LAST, id DESC
      LIMIT 2`,
    [effectiveDate],
  );
  if (tax.rows.length > 1) throw new Error("TAX_CONFIG_AMBIGUOUS");

  return {
    companyId: Number(event.companyId),
    taxRate: Number(tax.rows[0]?.tax_rate ?? 0),
    settlementBankAccountId: String(settlement.rows[0].bank_account_id),
    provider: provider || "mandiri_direct",
  };
}

async function readEvent(pool: pg.Pool, outboxId: number, paymentId: number): Promise<FinanceEvent | null> {
  const result = await pool.query(
    `SELECT o.id AS outbox_id, o.payment_id, o.booking_id, o.company_id, o.amount,
            o.payment_type, o.payment_method, o.payment_provider,
            o.provider_reference, o.provider_order_id, o.paid_at, o.confirmed_at,
            o.correlation_id, b.order_number
       FROM sport_center.payment_accounting_outbox o
       JOIN sport_center.sport_bookings b ON b.id = o.booking_id
      WHERE o.id = $1 AND o.payment_id = $2 AND o.event_type = 'payment_confirmed'
        AND o.status = 'processing'`,
    [outboxId, paymentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    outboxId: Number(row.outbox_id),
    paymentId: Number(row.payment_id),
    bookingId: Number(row.booking_id),
    companyId: row.company_id == null ? null : Number(row.company_id),
    amount: Number(row.amount),
    paymentType: String(row.payment_type ?? "full_payment"),
    paymentMethod: row.payment_method == null ? null : String(row.payment_method),
    paymentProvider: row.payment_provider == null ? null : String(row.payment_provider),
    providerReference: row.provider_reference == null ? null : String(row.provider_reference),
    providerOrderId: row.provider_order_id == null ? null : String(row.provider_order_id),
    paidAt: row.paid_at == null ? null : String(row.paid_at),
    confirmedAt: row.confirmed_at == null ? null : String(row.confirmed_at),
    correlationId: String(row.correlation_id),
    orderNumber: String(row.order_number),
  };
}

async function markFailure(pool: pg.Pool, event: FinanceEvent, error: unknown): Promise<"retry" | "manual_review"> {
  const message = String((error as { message?: string })?.message ?? error).slice(0, 1000);
  const status = isDeterministicConfigError(message) ? "manual_review" : "failed";
  await pool.query(
    `UPDATE sport_center.payment_accounting_outbox
        SET status = $2,
            available_at = CASE WHEN $2 = 'failed'
              THEN NOW() + LEAST(INTERVAL '1 hour', INTERVAL '5 minutes' * GREATEST(attempts, 1))
              ELSE available_at END,
            locked_at = NULL, last_error = $3, updated_at = NOW()
      WHERE id = $1`,
    [event.outboxId, status, message],
  );
  await pool.query(
    `UPDATE sport_center.central_finance_processing
        SET status = $2,
            available_at = CASE WHEN $2 = 'failed'
              THEN NOW() + LEAST(INTERVAL '1 hour', INTERVAL '5 minutes' * GREATEST(attempts, 1))
              ELSE available_at END,
            locked_at = NULL, last_error = $3, updated_at = NOW()
      WHERE correlation_id = $1`,
    [event.correlationId, status, message],
  );
  return status === "failed" ? "retry" : "manual_review";
}

async function processEvent(pool: pg.Pool, event: FinanceEvent): Promise<boolean> {
  const config = await resolveConfig(pool, event);
  const posting: SportCenterBookingPaymentPosting = {
    paymentNumber: `SCPAY-SC-${event.paymentId}`,
    sourcePaymentId: event.paymentId,
    bookingId: event.bookingId,
    orderNumber: event.orderNumber,
    amount: event.amount,
    paymentMethod: event.paymentMethod,
    paymentType: event.paymentType,
    paidAt: event.paidAt ?? event.confirmedAt,
    ppnRate: config.taxRate,
    paymentProvider: config.provider,
    companyId: config.companyId,
    bankAccountId: config.settlementBankAccountId,
    providerReference: event.providerReference,
    providerOrderId: event.providerOrderId,
  };
  const result = await postSportCenterBookingPayment(posting);
  await pool.query(
    `UPDATE sport_center.payment_accounting_outbox
        SET status = 'posted', processed_at = NOW(), locked_at = NULL,
            last_error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [event.outboxId],
  );
  await pool.query(
    `UPDATE sport_center.central_finance_processing
        SET status = 'posted', processed_at = NOW(), locked_at = NULL,
            last_error = NULL, updated_at = NOW()
      WHERE correlation_id = $1`,
    [event.correlationId],
  );
  return !result.alreadyPosted;
}

export async function processCentralFinance(): Promise<{
  claimed: number;
  posted: number;
  retried: number;
  manualReview: number;
}> {
  const pool = getPool();
  if (!pool || !isCentralFinanceMode() || process.env.NODE_ENV === "production") {
    return { claimed: 0, posted: 0, retried: 0, manualReview: 0 };
  }

  await pool.query(
    `INSERT INTO sport_center.central_finance_processing
       (source_project, source_payment_id, event_type, correlation_id)
     SELECT source_project, payment_id, event_type, correlation_id
       FROM sport_center.payment_accounting_outbox
      WHERE event_type = 'payment_confirmed'
     ON CONFLICT (source_project, source_payment_id, event_type) DO NOTHING`,
  );

  const client = await pool.connect();
  let claimed: Array<{ id: number; paymentId: number; correlationId: string }> = [];
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT c.id, c.source_payment_id, c.correlation_id
         FROM sport_center.central_finance_processing c
        WHERE c.status IN ('pending', 'failed')
          AND c.available_at <= NOW()
          AND (c.locked_at IS NULL OR c.locked_at < NOW() - INTERVAL '15 minutes')
        ORDER BY c.id
        FOR UPDATE SKIP LOCKED LIMIT 50`,
    );
    claimed = result.rows.map((row) => ({
      id: Number(row.id),
      paymentId: Number(row.source_payment_id),
      correlationId: String(row.correlation_id),
    }));
    if (claimed.length) {
      await client.query(
        `UPDATE sport_center.central_finance_processing
            SET status = 'processing', attempts = attempts + 1,
                locked_at = NOW(), updated_at = NOW()
          WHERE id = ANY($1::int[])`,
        [claimed.map((row) => row.id)],
      );
      await client.query(
        `UPDATE sport_center.payment_accounting_outbox
            SET status = 'processing', attempts = attempts + 1,
                locked_at = NOW(), updated_at = NOW()
          WHERE correlation_id = ANY($1::text[]) AND status <> 'posted'`,
        [claimed.map((row) => row.correlationId)],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  let posted = 0;
  let retried = 0;
  let manualReview = 0;
  for (const claim of claimed) {
    const event = await readEvent(pool, claim.id, claim.paymentId);
    if (!event) continue;
    try {
      if (await processEvent(pool, event)) posted++;
    } catch (error) {
      const result = await markFailure(pool, event, error);
      if (result === "retry") retried++;
      else manualReview++;
    }
  }
  return { claimed: claimed.length, posted, retried, manualReview };
}

export function centralFinanceModeForDiagnostics(): string {
  return getSportCenterFinanceMode();
}