import pg from "pg";
import { postSportCenterBookingPayment } from "../../artifacts/api-server/src/lib/accounting";
import { processCentralFinance } from "../../artifacts/api-server/src/lib/centralFinance";

type ReadyCase = "qris_full" | "qris_dp" | "qris_pelunasan" | "group_payment";
type CaseResult = {
  case: ReadyCase;
  paymentIds: number[];
  financeEvents: number;
  centralProcessing: number;
  accountingEffects: number;
  publicMutations: number;
  sportCenterMutations: number;
  settlementBatches: number;
  canonicalSettlementLinks: number;
  legacySettlementLinks: number;
  grossSettlement: number | null;
  netSettlement: number | null;
  taxLedgers: number;
  balanced: boolean;
  retryAlreadyPosted: boolean;
  config: Record<string, unknown>;
};

const MARKER = `CF_SC_7D_${Date.now()}`;
const COMPANY_ID = 1;
const BANK_ACCOUNT_ID = "1640006707220";
const PROVIDER = "mandiri_direct";
const PAYMENT_METHOD = "QRIS";
const AMOUNTS = {
  qris_full: 110000,
  qris_dp: 50000,
  qris_pelunasan: 60000,
  group_payment: 125000,
} as const;

function assertDevelopmentOnly(): void {
  if (process.env.APP_ENV !== "development") throw new Error("CF-SC-7D_FAIL_CLOSED: APP_ENV must be exactly development.");
  if (process.env.NODE_ENV === "production") throw new Error("CF-SC-7D_FAIL_CLOSED: NODE_ENV=production is forbidden.");
  if (process.env.SPORT_CENTER_FINANCE_MODE !== "central") throw new Error("CF-SC-7D_FAIL_CLOSED: SPORT_CENTER_FINANCE_MODE=central is required.");
  if (!process.env.SUPABASE_DATABASE_URL_DEV) throw new Error("CF-SC-7D_FAIL_CLOSED: SUPABASE_DATABASE_URL_DEV is required.");
  for (const key of ["SUPABASE_DATABASE_URL_PROD", "SUPABASE_PG_URL_PROD", "DATABASE_URL_PROD"]) {
    if (process.env[key]) throw new Error(`CF-SC-7D_FAIL_CLOSED: production variable ${key} is present.`);
  }
}

async function main(): Promise<void> {
  assertDevelopmentOnly();
  const pool = new pg.Pool({
    connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  const client = await pool.connect();
  const results: CaseResult[] = [];

  try {
    const identity = await client.query(`
      SELECT current_database() AS database_name, inet_server_port() AS server_port,
             EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sport_center') AS has_sport_center
    `);
    if (identity.rows[0]?.server_port !== 5432 || !identity.rows[0]?.has_sport_center) {
      throw new Error("CF-SC-7D_FAIL_CLOSED: DEV Supabase database fingerprint was not verified.");
    }

    await client.query("BEGIN");
    const config = await client.query(`
      SELECT psc.company_id, psc.provider_code, psc.bank_account_id,
             psc.settlement_delay_business_days, psc.effective_from::text,
             psc.effective_until::text, ts.tax_code, ts.tax_rate
        FROM sport_center.payment_settlement_configs psc
        JOIN sport_center.tax_settings ts
          ON ts.is_active = true AND ts.applies_to = 'sport_booking'
       WHERE psc.company_id = $1
         AND psc.provider_code = $2
         AND psc.is_active = true
       LIMIT 2
    `, [COMPANY_ID, PROVIDER]);
    if (config.rows.length !== 1 || Number(config.rows[0].tax_rate) !== 11) {
      throw new Error("CF-SC-7D_BLOCKED_CONFIG: canonical Mandiri settlement or PPN_OUT_11 config is missing/ambiguous.");
    }
    const facility = await client.query(
      `SELECT id, name FROM sport_center.facilities WHERE is_active = true ORDER BY id LIMIT 1`,
    );
    if (!facility.rows[0]) throw new Error("CF-SC-7D_BLOCKED_CONFIG: no active facility is available.");

    async function createBooking(key: string, amount: number, groupRef: string | null = null): Promise<{ id: number; orderNumber: string }> {
      const orderNumber = `${MARKER}_${key}`;
      const booking = await client.query(
        `INSERT INTO sport_center.sport_bookings
          (order_number, customer_name, customer_email, customer_phone, facility_id,
           booking_date, start_time, end_time, duration_hours, total_price, discount_amount,
           status, notes, source, ppn_rate, ppn_amount, grand_total, payment_required_now, group_ref)
         VALUES ($1,'CF-SC-7D Customer',$2,'0000000000',$3,CURRENT_DATE,'09:00','10:00',1,
                 $4,0,'pending_payment',$5,'cf_sc_7d',11,$6,$4,true,$7)
         RETURNING id`,
        [orderNumber, `${orderNumber.toLowerCase()}@invalid.example`, facility.rows[0].id, amount, MARKER, Math.round(amount * 11 / 111), groupRef],
      );
      const bookingId = Number(booking.rows[0].id);
      await client.query(
        `INSERT INTO public.sport_bookings
          (company_id, booking_number, customer_name, customer_phone, facility_id, facility_name,
           booking_date, start_time, end_time, total_amount, tax_rate, tax_amount, payment_status, sc_booking_id)
         VALUES ($1,$2,'CF-SC-7D Customer','0000000000',$3,$4,CURRENT_DATE,'09:00','10:00',
                 $5,11,$6,'unpaid',$7)`,
        [COMPANY_ID, orderNumber, facility.rows[0].id, facility.rows[0].name ?? "Sport Center", amount, Math.round(amount * 11 / 111), bookingId],
      );
      return { id: bookingId, orderNumber };
    }

    async function createPayment(booking: { id: number; orderNumber: string }, paymentType: "full_payment" | "dp" | "pelunasan", amount: number): Promise<number> {
      const reference = `${MARKER}_${paymentType}_${booking.id}_${amount}`;
      const payment = await client.query(
        `INSERT INTO sport_center.sport_payments
          (booking_id, amount, payment_method, payment_provider, provider_name, provider_id,
           provider_reference, provider_order_id, merchant_trade_no, payment_type, status,
           paid_at, confirmed_at, notes, company_id, bank_account_id, expected_settlement_date,
           provider_trade_no, uat_marker)
         VALUES ($1,$2,'QRIS','mandiri_direct','mandiri_direct','cf-sc-7d',$3,$3,$4,$5,'confirmed',
                 NOW(),NOW(),$6,$7,$8,CURRENT_DATE + 1,$3,$9)
         RETURNING id`,
        [booking.id, amount, reference, reference, paymentType, MARKER, COMPANY_ID, BANK_ACCOUNT_ID, MARKER],
      );
      return Number(payment.rows[0].id);
    }

    async function processCase(key: ReadyCase, paymentIds: number[], booking: { id: number; orderNumber: string }, paymentTypes: string[]): Promise<CaseResult> {
      const finance = await processCentralFinance(client);
      const entries = await client.query(
        `SELECT ae.id, ae.total_debit, ae.total_credit
           FROM public.accounting_entries ae
          WHERE ae.correlation_id = ANY($1::text[]) AND ae.status = 'posted'`,
        [paymentIds.map((id) => `sc_payment_${id}`)],
      );
      const mutations = await client.query(
        `SELECT id FROM public.bank_mutations WHERE canonical_key = ANY($1::text[])`,
        [paymentIds.map((id) => `sport_center:payment:${id}`)],
      );
      const outbox = await client.query(
        `SELECT id FROM sport_center.payment_accounting_outbox WHERE payment_id = ANY($1::int[])`,
        [paymentIds],
      );
      const processing = await client.query(
        `SELECT id FROM sport_center.central_finance_processing WHERE source_payment_id = ANY($1::int[])`,
        [paymentIds],
      );
      const tax = await client.query(
        `SELECT id FROM sport_center.tax_transactions WHERE reference_type = 'sport_center_payment' AND reference_id = ANY($1::int[])`,
        [paymentIds],
      );
      const legacy = await client.query(
        `SELECT id FROM sport_center.bank_mutations WHERE mutation_key = ANY($1::text[])`,
        [paymentIds.map((id) => `SC-PAY-${id}`)],
      );
      const settlements = await client.query(
        `SELECT id, canonical_bank_mutation_id, bank_mutation_id,
                gross_amount, net_amount
           FROM sport_center.payment_settlement_batches
          WHERE EXISTS (
              SELECT 1
                FROM sport_center.payment_settlement_items i
               WHERE i.settlement_id = payment_settlement_batches.id
                 AND i.payment_id = ANY($1::int[])
                 AND i.item_status = 'active'
            )`,
        [paymentIds],
      );
      const retry = await postSportCenterBookingPayment({
        paymentNumber: `SCPAY-SC-${paymentIds[0]}`,
        sourcePaymentId: paymentIds[0],
        bookingId: booking.id,
        orderNumber: booking.orderNumber,
        amount: AMOUNTS[key === "qris_full" ? "qris_full" : key],
        paymentMethod: PAYMENT_METHOD,
        paymentType: paymentTypes[0],
        paymentProvider: PROVIDER,
        companyId: COMPANY_ID,
        bankAccountId: BANK_ACCOUNT_ID,
      }, client);
      const balanced = entries.rows.every((row) => Math.abs(Number(row.total_debit) - Number(row.total_credit)) <= 0.005);
      return {
        case: key,
        paymentIds,
        financeEvents: outbox.rowCount ?? 0,
        centralProcessing: processing.rowCount ?? 0,
        accountingEffects: entries.rowCount ?? 0,
        publicMutations: mutations.rowCount ?? 0,
        sportCenterMutations: legacy.rowCount ?? 0,
        settlementBatches: settlements.rowCount ?? 0,
        canonicalSettlementLinks: settlements.rows.filter((row) => row.canonical_bank_mutation_id != null).length,
        legacySettlementLinks: settlements.rows.filter((row) => row.bank_mutation_id != null).length,
        grossSettlement: settlements.rows[0] ? Number(settlements.rows[0].gross_amount) : null,
        netSettlement: settlements.rows[0] ? Number(settlements.rows[0].net_amount) : null,
        taxLedgers: tax.rowCount ?? 0,
        balanced,
        retryAlreadyPosted: retry.alreadyPosted,
        config: {
          classification: "CANONICAL_CONFIG",
          companyId: config.rows[0].company_id,
          paymentMethod: PAYMENT_METHOD,
          provider: PROVIDER,
          bankAccount: "canonical receiving account (redacted)",
          taxCode: config.rows[0].tax_code,
          taxRate: config.rows[0].tax_rate,
          settlementDelayBusinessDays: config.rows[0].settlement_delay_business_days,
          effectiveFrom: config.rows[0].effective_from,
        },
      };
    }

    const fullBooking = await createBooking("QRIS_FULL", AMOUNTS.qris_full);
    const fullPayment = await createPayment(fullBooking, "full_payment", AMOUNTS.qris_full);
    results.push(await processCase("qris_full", [fullPayment], fullBooking, ["full_payment"]));

    const dpBooking = await createBooking("QRIS_DP_COMBINED", AMOUNTS.qris_dp + AMOUNTS.qris_pelunasan);
    const dpPayment = await createPayment(dpBooking, "dp", AMOUNTS.qris_dp);
    const pelunasanPayment = await createPayment(dpBooking, "pelunasan", AMOUNTS.qris_pelunasan);
    results.push(await processCase("qris_dp", [dpPayment], dpBooking, ["dp"]));
    results.push(await processCase("qris_pelunasan", [pelunasanPayment], dpBooking, ["pelunasan"]));

    const groupRef = `${MARKER}_GROUP`;
    await client.query(
      `INSERT INTO sport_center.booking_groups (group_ref, customer_phone, customer_name, total_payment, status, notes)
       VALUES ($1,'0000000000','CF-SC-7D Group',$2,'pending',$3)`,
      [groupRef, AMOUNTS.group_payment, MARKER],
    );
    const groupBooking = await createBooking("GROUP_PAYMENT", AMOUNTS.group_payment, groupRef);
    const groupPayment = await createPayment(groupBooking, "full_payment", AMOUNTS.group_payment);
    results.push(await processCase("group_payment", [groupPayment], groupBooking, ["full_payment"]));

    const settlementBatches = await client.query(
      `SELECT count(DISTINCT b.id)::int AS count
         FROM sport_center.payment_settlement_batches b
         JOIN sport_center.payment_settlement_items i
           ON i.settlement_id = b.id
          AND i.item_status = 'active'
        JOIN sport_center.sport_payments p
           ON p.id = i.payment_id
        WHERE p.uat_marker = $1`,
      [MARKER],
    );
    const bookingEntries = await client.query(
      `SELECT count(*)::int AS count
         FROM public.accounting_entries
        WHERE source = 'sport_center_booking' AND ref LIKE $1`,
      [`${MARKER}%`],
    );
    const committedRows = await client.query(
      `SELECT
        (SELECT count(*) FROM sport_center.sport_payments WHERE uat_marker = $1) AS sport_payments,
        (SELECT count(*) FROM sport_center.payment_accounting_outbox o JOIN sport_center.sport_payments p ON p.id=o.payment_id WHERE p.uat_marker=$1) AS outbox,
        (SELECT count(*) FROM sport_center.central_finance_processing c JOIN sport_center.sport_payments p ON p.id=c.source_payment_id WHERE p.uat_marker=$1) AS central_processing,
        (SELECT count(*) FROM public.sport_payments WHERE source_payment_id = ANY($2::int[])) AS public_sport_payments,
        (SELECT count(*) FROM public.accounting_entries WHERE source_payment_id = ANY($2::int[])) AS accounting_entries,
         (SELECT count(*) FROM public.bank_mutations WHERE source_id = ANY($2::int[])) AS bank_mutations,
         (SELECT count(DISTINCT b.id)
            FROM sport_center.payment_settlement_batches b
            JOIN sport_center.payment_settlement_items i
              ON i.settlement_id = b.id AND i.item_status = 'active'
           WHERE i.payment_id = ANY($2::int[])) AS settlement_batches,
         (SELECT count(*) FROM sport_center.accounting_journals WHERE payment_id = ANY($2::int[])) AS internal_payment_journals,
         (SELECT count(*) FROM sport_center.bank_mutations WHERE mutation_key = ANY($3::text[])) AS legacy_bank_mutations,
         (SELECT count(*) FROM sport_center.bank_reconciliation_matches WHERE mutation_id IN (
            SELECT id FROM sport_center.bank_mutations WHERE mutation_key = ANY($3::text[])
         )) AS legacy_reconciliation_matches`,
       [MARKER, results.flatMap((result) => result.paymentIds), results.flatMap((result) => result.paymentIds).map((id) => `SC-PAY-${id}`)],
    );

    console.log(JSON.stringify({
      environment: { appEnv: process.env.APP_ENV, nodeEnv: process.env.NODE_ENV, financeMode: process.env.SPORT_CENTER_FINANCE_MODE, database: identity.rows[0].database_name },
      cases: results,
      combinedDpPelunasan: {
        paymentIdsDistinct: dpPayment !== pelunasanPayment,
        paymentCount: 2,
        totalConfirmedAmount: AMOUNTS.qris_dp + AMOUNTS.qris_pelunasan,
      },
      bookingLevelAccountingCreated: Number(bookingEntries.rows[0].count),
       settlementBatches: Number(settlementBatches.rows[0].count),
      concurrency: "database advisory-lock/idempotency path exercised by retry; concurrent external clients require committed fixtures and are not run in this rollback transaction",
      rollbackProof: "all fixture rows are in one transaction and rolled back below",
      blockedConfigShapes: ["Transfer Bank", "Paylabs", "unknown provider", "historical recovery"],
      readyForProdShadowMode: false,
      committedFixtureRowsBeforeRollback: committedRows.rows[0],
      prodWrites: 0,
      prodCutover: "NO",
    }, null, 2));
    await client.query("ROLLBACK");
    console.log("CF-SC-7D_ROLLBACK_CONFIRMED");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();