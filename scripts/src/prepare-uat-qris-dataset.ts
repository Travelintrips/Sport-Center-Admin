import pg from "pg";

const { Client } = pg;

const MARKER = "UAT_QRIS_202608";
const ENVIRONMENT = "development";
const DATE_FROM = "2026-08-03";
const DATE_TO = "2026-08-11";
const UAT_COMPANY_EMAIL = "uat-qris-202608@invalid.example";
const MANDIRI_ACCOUNT_ID = "UAT_QRIS_202608_MANDIRI";
const ALT_ACCOUNT_ID = "UAT_QRIS_202608_ALT";
const FACILITY_ID = 6;

type Provider = "mandiri_direct" | "paylabs" | "unknown";

type PaymentSpec = {
  key: string;
  provider: Provider;
  amount: number;
  paidAt: string;
  expectedSettlementDate: string;
  bankAccountId: string;
  scenario: string;
  ruleVersion: string;
};

type MutationSpec = {
  key: string;
  paymentKeys: string[];
  provider: Provider;
  transactionDate: string;
  amount: number;
  bankAccountId: string;
  description: string;
  scenario: string;
};

function assertDevelopmentOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to prepare UAT data while NODE_ENV=production.");
  }
  if (process.env.ALLOW_DEV_ON_PROD_DB === "true") {
    throw new Error("Refusing to prepare UAT data while ALLOW_DEV_ON_PROD_DB=true.");
  }
  if (!process.env.SUPABASE_DATABASE_URL_DEV) {
    throw new Error("SUPABASE_DATABASE_URL_DEV is required; production URLs are not accepted.");
  }
}

function getDevelopmentConnection() {
  const raw = process.env.SUPABASE_DATABASE_URL_DEV;
  if (!raw) throw new Error("SUPABASE_DATABASE_URL_DEV is required.");
  const parsed = new URL(raw);
  const sessionUrl = raw.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
  return {
    raw,
    sessionUrl,
    safe: {
      scheme: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      port: parsed.port || null,
      database: parsed.pathname.replace(/^\//, "") || null,
      credentialsHidden: true,
    },
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nextBusinessDay(date: string, holidays: Set<string>) {
  const cursor = new Date(`${date}T00:00:00Z`);
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const iso = cursor.toISOString().slice(0, 10);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(iso)) return iso;
  } while (true);
}

const holidays = new Set(["2026-08-10"]);

const paymentSpecs: PaymentSpec[] = [
  ...[2500000, 2500000, 2500000, 2500000].map((amount, index) => ({
    key: `MANDIRI_NORMAL_${index + 1}`,
    provider: "mandiri_direct" as const,
    amount,
    paidAt: `2026-08-03T09:0${index}:00.000Z`,
    expectedSettlementDate: "2026-08-04",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "mandiri_normal",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  })),
  ...[1250000, 1250000, 1250000, 1250000].map((amount, index) => ({
    key: `PAYLABS_NORMAL_${index + 1}`,
    provider: "paylabs" as const,
    amount,
    paidAt: `2026-08-03T10:0${index}:00.000Z`,
    expectedSettlementDate: "2026-08-04",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "paylabs_normal",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  })),
  {
    key: "WEEKEND_FRIDAY",
    provider: "mandiri_direct",
    amount: 400000,
    paidAt: "2026-08-07T11:00:00.000Z",
    expectedSettlementDate: nextBusinessDay("2026-08-07", holidays),
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "friday_weekend",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "WEEKEND_SATURDAY",
    provider: "mandiri_direct",
    amount: 400000,
    paidAt: "2026-08-08T11:00:00.000Z",
    expectedSettlementDate: nextBusinessDay("2026-08-08", holidays),
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "friday_weekend",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "WEEKEND_SUNDAY",
    provider: "mandiri_direct",
    amount: 400000,
    paidAt: "2026-08-09T11:00:00.000Z",
    expectedSettlementDate: nextBusinessDay("2026-08-09", holidays),
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "friday_weekend",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "HOLIDAY_SHIFT",
    provider: "paylabs",
    amount: 750000,
    paidAt: "2026-08-07T12:00:00.000Z",
    expectedSettlementDate: "2026-08-11",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "holiday",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "UNKNOWN_PROVIDER",
    provider: "unknown",
    amount: 600000,
    paidAt: "2026-08-03T13:00:00.000Z",
    expectedSettlementDate: "2026-08-04",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "unknown_provider_review",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "AMOUNT_ANOMALY",
    provider: "mandiri_direct",
    amount: 800000,
    paidAt: "2026-08-03T14:00:00.000Z",
    expectedSettlementDate: "2026-08-04",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "amount_anomaly",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "DIFFERENT_ACCOUNT",
    provider: "mandiri_direct",
    amount: 900000,
    paidAt: "2026-08-03T15:00:00.000Z",
    expectedSettlementDate: "2026-08-04",
    bankAccountId: ALT_ACCOUNT_ID,
    scenario: "different_bank_account",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "DETERMINISTIC_A",
    provider: "paylabs",
    amount: 350000,
    paidAt: "2026-08-04T09:00:00.000Z",
    expectedSettlementDate: "2026-08-05",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "multiple_settlement_deterministic",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "DETERMINISTIC_B",
    provider: "paylabs",
    amount: 450000,
    paidAt: "2026-08-04T09:05:00.000Z",
    expectedSettlementDate: "2026-08-05",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "multiple_settlement_deterministic",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "AMBIGUOUS_A",
    provider: "paylabs",
    amount: 200000,
    paidAt: "2026-08-04T10:00:00.000Z",
    expectedSettlementDate: "2026-08-05",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "multiple_settlement_ambiguous",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  {
    key: "AMBIGUOUS_B",
    provider: "paylabs",
    amount: 200000,
    paidAt: "2026-08-04T10:05:00.000Z",
    expectedSettlementDate: "2026-08-05",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "multiple_settlement_ambiguous",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  },
  ...[333333, 333333, 333333].map((amount, index) => ({
    key: `ROUNDING_${index + 1}`,
    provider: "mandiri_direct" as const,
    amount,
    paidAt: `2026-08-05T11:0${index}:00.000Z`,
    expectedSettlementDate: "2026-08-06",
    bankAccountId: MANDIRI_ACCOUNT_ID,
    scenario: "rounding",
    ruleVersion: "UAT-PROVISIONAL-1BD-v1",
  })),
];

const mutationSpecs: MutationSpec[] = [
  {
    key: "MANDIRI_NORMAL_SETTLEMENT",
    paymentKeys: ["MANDIRI_NORMAL_1", "MANDIRI_NORMAL_2", "MANDIRI_NORMAL_3", "MANDIRI_NORMAL_4"],
    provider: "mandiri_direct",
    transactionDate: "2026-08-04",
    amount: 9970000,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | MANDIRI_DIRECT | SETTLEMENT NORMAL | REF MD-UAT-NORMAL-001`,
    scenario: "mandiri_normal",
  },
  {
    key: "PAYLABS_NORMAL_SETTLEMENT",
    paymentKeys: ["PAYLABS_NORMAL_1", "PAYLABS_NORMAL_2", "PAYLABS_NORMAL_3", "PAYLABS_NORMAL_4"],
    provider: "paylabs",
    transactionDate: "2026-08-04",
    amount: 4965000,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | PAYLABS | SETTLEMENT NORMAL | REF PL-UAT-NORMAL-001`,
    scenario: "paylabs_normal",
  },
  ...(["WEEKEND_FRIDAY", "WEEKEND_SATURDAY", "WEEKEND_SUNDAY"] as const).map((paymentKey, index) => ({
    key: `WEEKEND_SETTLEMENT_${index + 1}`,
    paymentKeys: [paymentKey],
    provider: "mandiri_direct" as const,
      transactionDate: ["2026-08-11", "2026-08-11", "2026-08-11"][index]!,
    amount: 398800,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | MANDIRI_DIRECT | WEEKEND ${index + 1} | REF MD-UAT-WEEKEND-00${index + 1}`,
    scenario: "friday_weekend",
  })),
  {
    key: "HOLIDAY_SETTLEMENT",
    paymentKeys: ["HOLIDAY_SHIFT"],
    provider: "paylabs",
    transactionDate: "2026-08-11",
    amount: 744750,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | PAYLABS | HOLIDAY SHIFT | REF PL-UAT-HOLIDAY-001`,
    scenario: "holiday",
  },
  {
    key: "UNKNOWN_PROVIDER_SETTLEMENT",
    paymentKeys: ["UNKNOWN_PROVIDER"],
    provider: "unknown",
    transactionDate: "2026-08-04",
    amount: 600000,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | UNKNOWN PROVIDER | REVIEW REQUIRED | REF UNKNOWN-UAT-001`,
    scenario: "unknown_provider_review",
  },
  {
    key: "AMOUNT_ANOMALY_SETTLEMENT",
    paymentKeys: ["AMOUNT_ANOMALY"],
    provider: "mandiri_direct",
    transactionDate: "2026-08-04",
    amount: 802400,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | MANDIRI_DIRECT | AMOUNT ANOMALY | REF MD-UAT-ANOMALY-001`,
    scenario: "amount_anomaly",
  },
  {
    key: "DIFFERENT_ACCOUNT_SETTLEMENT",
    paymentKeys: ["DIFFERENT_ACCOUNT"],
    provider: "mandiri_direct",
    transactionDate: "2026-08-04",
    amount: 897300,
    bankAccountId: ALT_ACCOUNT_ID,
    description: `${MARKER} | MANDIRI_DIRECT | DIFFERENT ACCOUNT | REF MD-UAT-ALT-001`,
    scenario: "different_bank_account",
  },
  {
    key: "DETERMINISTIC_SETTLEMENT_A",
    paymentKeys: ["DETERMINISTIC_A"],
    provider: "paylabs",
    transactionDate: "2026-08-05",
    amount: 347550,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | PAYLABS | BATCH A | REF PL-UAT-SAME-DATE-A`,
    scenario: "multiple_settlement_deterministic",
  },
  {
    key: "DETERMINISTIC_SETTLEMENT_B",
    paymentKeys: ["DETERMINISTIC_B"],
    provider: "paylabs",
    transactionDate: "2026-08-05",
    amount: 446850,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | PAYLABS | BATCH B | REF PL-UAT-SAME-DATE-B`,
    scenario: "multiple_settlement_deterministic",
  },
  {
    key: "AMBIGUOUS_SETTLEMENT_A",
    paymentKeys: ["AMBIGUOUS_A"],
    provider: "paylabs",
    transactionDate: "2026-08-05",
    amount: 198600,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | PAYLABS | SAME DATE | NO DISCRIMINATING REFERENCE`,
    scenario: "multiple_settlement_ambiguous",
  },
  {
    key: "AMBIGUOUS_SETTLEMENT_B",
    paymentKeys: ["AMBIGUOUS_B"],
    provider: "paylabs",
    transactionDate: "2026-08-05",
    amount: 198600,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | PAYLABS | SAME DATE | NO DISCRIMINATING REFERENCE`,
    scenario: "multiple_settlement_ambiguous",
  },
  {
    key: "ROUNDING_SETTLEMENT",
    paymentKeys: ["ROUNDING_1", "ROUNDING_2", "ROUNDING_3"],
    provider: "mandiri_direct",
    transactionDate: "2026-08-06",
    amount: 996999,
    bankAccountId: MANDIRI_ACCOUNT_ID,
    description: `${MARKER} | MANDIRI_DIRECT | ROUNDING | REF MD-UAT-ROUNDING-001`,
    scenario: "rounding",
  },
];

async function main() {
  assertDevelopmentOnly();
  const connection = getDevelopmentConnection();
  const client = new Client({
    connectionString: connection.sessionUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const databaseInfo = await client.query(
      "SELECT current_database() AS database_name, current_user AS db_user, current_schema() AS current_schema",
    );
    const hasSchema = await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sport_center') AS exists",
    );
    if (!hasSchema.rows[0]?.exists) {
      throw new Error("sport_center schema is missing from the development database.");
    }

    const existing = await client.query(
      `SELECT
         (SELECT count(*) FROM sport_center.sport_bookings WHERE uat_marker = $1) AS bookings,
         (SELECT count(*) FROM sport_center.sport_payments WHERE uat_marker = $1) AS payments,
         (SELECT count(*) FROM sport_center.bank_mutations WHERE uat_marker = $1) AS mutations`,
      [MARKER],
    ).catch(() => ({ rows: [{ bookings: "schema-not-ready", payments: "schema-not-ready", mutations: "schema-not-ready" }] }));

    console.log("=== UAT QRIS SAFETY PREFLIGHT ===");
    console.log(JSON.stringify({
      environment: ENVIRONMENT,
      database: databaseInfo.rows[0],
      connection: connection.safe,
      companyTarget: { name: "UAT QRIS Reconciliation Company", email: UAT_COMPANY_EMAIL, marker: MARKER },
      bankAccountTargets: [
        { accountId: MANDIRI_ACCOUNT_ID, accountName: "UAT QRIS Settlement Account", bank: "Bank Mandiri (UAT)" },
        { accountId: ALT_ACCOUNT_ID, accountName: "UAT QRIS Alternate Settlement Account", bank: "Bank Mandiri (UAT)" },
      ],
      dateRange: { from: DATE_FROM, to: DATE_TO },
      existingMarkerRows: existing.rows[0],
      writesAllowed: true,
    }, null, 2));

    const hasAnyExisting =
      Number(existing.rows[0]?.bookings) > 0 ||
      Number(existing.rows[0]?.payments) > 0 ||
      Number(existing.rows[0]?.mutations) > 0;
    if (hasAnyExisting) {
      throw new Error(`Marker ${MARKER} already exists. Refusing to create duplicate UAT rows.`);
    }

    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS sport_center.uat_qris_bank_accounts (
        id serial PRIMARY KEY,
        marker text NOT NULL,
        account_id text NOT NULL UNIQUE,
        account_name text NOT NULL,
        bank_name text NOT NULL,
        company_id integer,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sport_center.uat_qris_provider_rules (
        id serial PRIMARY KEY,
        marker text NOT NULL,
        company_id integer NOT NULL,
        bank_account_id text NOT NULL,
        provider_code text NOT NULL,
        settlement_delay_business_days integer NOT NULL,
        match_window_business_days integer NOT NULL,
        effective_from date NOT NULL,
        effective_until date,
        active boolean NOT NULL DEFAULT true,
        rule_version text NOT NULL,
        notes text NOT NULL,
        UNIQUE (marker, provider_code, bank_account_id, rule_version)
      );
      CREATE TABLE IF NOT EXISTS sport_center.uat_qris_mdr_configs (
        id serial PRIMARY KEY,
        marker text NOT NULL,
        company_id integer NOT NULL,
        bank_account_id text NOT NULL,
        provider_code text NOT NULL,
        expected_mdr_rate numeric(12,8) NOT NULL,
        rate_tolerance numeric(12,8) NOT NULL,
        effective_from date NOT NULL,
        effective_until date,
        rule_version text NOT NULL,
        notes text NOT NULL,
        UNIQUE (marker, provider_code, bank_account_id, rule_version)
      );
      CREATE TABLE IF NOT EXISTS sport_center.uat_qris_business_calendar (
        id serial PRIMARY KEY,
        marker text NOT NULL,
        calendar_date date NOT NULL,
        day_type text NOT NULL,
        label text NOT NULL,
        source text NOT NULL,
        UNIQUE (marker, calendar_date)
      );
      CREATE TABLE IF NOT EXISTS sport_center.uat_qris_import_batches (
        id serial PRIMARY KEY,
        batch_id text NOT NULL UNIQUE,
        marker text NOT NULL,
        source_app text NOT NULL,
        source_module text NOT NULL,
        source_table text NOT NULL,
        import_method text NOT NULL,
        imported_at timestamptz NOT NULL DEFAULT now(),
        row_count integer NOT NULL,
        notes text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sport_center.uat_qris_import_rows (
        id serial PRIMARY KEY,
        batch_id text NOT NULL REFERENCES sport_center.uat_qris_import_batches(batch_id) ON DELETE CASCADE,
        line_number integer NOT NULL,
        transaction_date date NOT NULL,
        description text NOT NULL,
        credit_amount numeric(14,2) NOT NULL,
        bank_account_id text NOT NULL,
        source_classification text NOT NULL,
        provenance jsonb NOT NULL,
        raw_payload jsonb NOT NULL,
        UNIQUE (batch_id, line_number)
      );
    `);

    await client.query(`
      ALTER TABLE sport_center.sport_bookings
        ADD COLUMN IF NOT EXISTS uat_marker text;
      ALTER TABLE sport_center.sport_payments
        ADD COLUMN IF NOT EXISTS company_id integer,
        ADD COLUMN IF NOT EXISTS bank_account_id text,
        ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'unsettled',
        ADD COLUMN IF NOT EXISTS expected_settlement_date text,
        ADD COLUMN IF NOT EXISTS settlement_rule_version text,
        ADD COLUMN IF NOT EXISTS gross_tax_inclusive boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS uat_marker text;
      ALTER TABLE sport_center.bank_mutations
        ADD COLUMN IF NOT EXISTS source text,
        ADD COLUMN IF NOT EXISTS source_classification text,
        ADD COLUMN IF NOT EXISTS import_batch_id text,
        ADD COLUMN IF NOT EXISTS source_app text,
        ADD COLUMN IF NOT EXISTS source_module text,
        ADD COLUMN IF NOT EXISTS source_table text,
        ADD COLUMN IF NOT EXISTS source_id text,
        ADD COLUMN IF NOT EXISTS provenance jsonb,
        ADD COLUMN IF NOT EXISTS uat_marker text;
      DROP INDEX IF EXISTS sport_bookings_uat_marker_uidx;
      DROP INDEX IF EXISTS sport_payments_uat_marker_uidx;
      DROP INDEX IF EXISTS bank_mutations_uat_marker_uidx;
      CREATE INDEX IF NOT EXISTS sport_bookings_uat_marker_idx
        ON sport_center.sport_bookings (uat_marker) WHERE uat_marker IS NOT NULL;
      CREATE INDEX IF NOT EXISTS sport_payments_uat_marker_idx
        ON sport_center.sport_payments (uat_marker) WHERE uat_marker IS NOT NULL;
      CREATE INDEX IF NOT EXISTS bank_mutations_uat_marker_idx
        ON sport_center.bank_mutations (uat_marker) WHERE uat_marker IS NOT NULL;
    `);

    const company = await client.query(
      `INSERT INTO sport_center.users
        (name, email, role, account_type, company_name, pic_name, pic_email, account_status, registration_source)
       VALUES
        ('UAT QRIS Reconciliation Company', $1, 'customer', 'company',
         'UAT QRIS Reconciliation Company', 'UAT Finance', $1, 'active', 'uat_fixture')
       RETURNING id`,
      [UAT_COMPANY_EMAIL],
    );
    const companyId = company.rows[0].id as number;

    await client.query(
      `INSERT INTO sport_center.uat_qris_bank_accounts
        (marker, account_id, account_name, bank_name, company_id)
       VALUES
        ($1, $2, 'UAT QRIS Settlement Account', 'Bank Mandiri (UAT)', $3),
        ($1, $4, 'UAT QRIS Alternate Settlement Account', 'Bank Mandiri (UAT)', $3)`,
      [MARKER, MANDIRI_ACCOUNT_ID, companyId, ALT_ACCOUNT_ID],
    );

    for (const accountId of [MANDIRI_ACCOUNT_ID, ALT_ACCOUNT_ID]) {
      for (const [providerCode, expectedMdrRate] of [
        ["mandiri_direct", "0.003"],
        ["paylabs", "0.007"],
      ] as const) {
        await client.query(
          `INSERT INTO sport_center.uat_qris_provider_rules
            (marker, company_id, bank_account_id, provider_code, settlement_delay_business_days,
             match_window_business_days, effective_from, effective_until, rule_version, notes)
           VALUES ($1, $2, $3, $4, 1, 3, $5, $6, 'UAT-PROVISIONAL-1BD-v1',
                   'UAT / provisional only; not a production provider contract')`,
          [MARKER, companyId, accountId, providerCode, DATE_FROM, DATE_TO],
        );
        await client.query(
          `INSERT INTO sport_center.uat_qris_mdr_configs
            (marker, company_id, bank_account_id, provider_code, expected_mdr_rate,
             rate_tolerance, effective_from, effective_until, rule_version, notes)
           VALUES ($1, $2, $3, $4, $5, 0.0001, $6, $7, 'UAT_ONLY-MDR-v1',
                   'UAT_ONLY example rate for reconciliation comparison; not production')`,
          [MARKER, companyId, accountId, providerCode, expectedMdrRate, DATE_FROM, DATE_TO],
        );
      }
    }
    await client.query(
      `INSERT INTO sport_center.uat_qris_business_calendar
        (marker, calendar_date, day_type, label, source)
       VALUES
        ($1, '2026-08-10', 'holiday', 'UAT_TEST_HOLIDAY', 'UAT fixture only'),
        ($1, '2026-08-08', 'weekend', 'Saturday (non-business day)', 'ISO weekday rule'),
        ($1, '2026-08-09', 'weekend', 'Sunday (non-business day)', 'ISO weekday rule')`,
      [MARKER],
    );

    const facility = await client.query(
      "SELECT id FROM sport_center.facilities WHERE id = $1 AND is_active = true",
      [FACILITY_ID],
    );
    if (!facility.rowCount) throw new Error(`Facility ${FACILITY_ID} is not available.`);

    const paymentIds = new Map<string, number>();
    for (const [index, spec] of paymentSpecs.entries()) {
      const gross = roundMoney(spec.amount);
      const dpp = roundMoney(gross / 1.11);
      const ppn = roundMoney(gross - dpp);
      const booking = await client.query(
        `INSERT INTO sport_center.sport_bookings
          (order_number, customer_id, customer_name, customer_email, customer_phone, facility_id,
           booking_date, start_time, end_time, duration_hours, total_price, discount_amount, status,
           notes, source, ppn_rate, ppn_amount, grand_total, payment_required_now, uat_marker)
         VALUES ($1, $2, 'UAT QRIS Customer', $3, '000000000000', $4, $5, '09:00', '10:00', 1,
                 $6, 0, 'pending_payment', $7, 'uat_qris_fixture', 11, $8, $6, true, $9)
         RETURNING id`,
        [
          `${MARKER}-${spec.key}`,
          companyId,
          `uat-${spec.key.toLowerCase()}@invalid.example`,
          FACILITY_ID,
          spec.paidAt.slice(0, 10),
          gross,
           `${MARKER} | scenario=${spec.scenario}`,
          ppn,
           MARKER,
        ],
      );
      const bookingId = booking.rows[0].id as number;
      const providerReference = `${spec.provider.toUpperCase()}-${MARKER}-${spec.key}`;
      const payment = await client.query(
        `INSERT INTO sport_center.sport_payments
          (booking_id, amount, payment_method, payment_provider, provider_name, provider_id, provider_reference,
           merchant_trade_no, provider_trade_no, payment_type, status, paid_at, notes,
           company_id, bank_account_id, settlement_status, expected_settlement_date,
           settlement_rule_version, gross_tax_inclusive, uat_marker)
         VALUES ($1, $2, 'QRIS', $3, $3, $4, $5, $6, $7, 'full_payment', 'pending', $8, $9,
                 $10, $11, 'unsettled', $12, $13, true, $14)
         RETURNING id`,
        [
          bookingId,
          gross,
          spec.provider,
           providerReference,
          providerReference,
          `${MARKER}-${spec.key}`,
          `${MARKER}-TRADE-${String(index + 1).padStart(3, "0")}`,
          spec.paidAt,
          `${MARKER} | scenario=${spec.scenario} | gross tax-inclusive`,
          companyId,
          spec.bankAccountId,
          spec.expectedSettlementDate,
          spec.ruleVersion,
           MARKER,
        ],
      );
      paymentIds.set(spec.key, payment.rows[0].id as number);
    }

    const batchId = `${MARKER}_BANK_STATEMENT_IMPORT_001`;
    await client.query(
      `INSERT INTO sport_center.uat_qris_import_batches
        (batch_id, marker, source_app, source_module, source_table, import_method, row_count, notes)
       VALUES ($1, $2, 'Sport Center', 'UAT bank statement import', 'UAT CSV statement fixture',
               'staged_statement_materialization', $3,
               'Dedicated UAT import; no final reconciliation or accounting posting')`,
      [batchId, MARKER, mutationSpecs.length],
    );

    for (const [index, spec] of mutationSpecs.entries()) {
      const sourceId = `${batchId}:line-${String(index + 1).padStart(3, "0")}`;
      const provenance = {
        source_app: "Sport Center",
        source_module: "UAT bank statement import",
        source_table_import: "UAT CSV statement fixture",
        source_id: sourceId,
        import_batch_id: batchId,
        source_classification: "actual_bank_mutation",
        sanitized: true,
        marker: MARKER,
      };
      const rawPayload = {
        tanggal: spec.transactionDate,
        keterangan: spec.description,
        credit: spec.amount,
        debit: 0,
        rekening: spec.bankAccountId,
        reference: spec.key,
        provider: spec.provider,
      };
      await client.query(
        `INSERT INTO sport_center.uat_qris_import_rows
          (batch_id, line_number, transaction_date, description, credit_amount,
           bank_account_id, source_classification, provenance, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, 'actual_bank_mutation', $7, $8)`,
        [batchId, index + 1, spec.transactionDate, spec.description, spec.amount, spec.bankAccountId, provenance, rawPayload],
      );

      const paymentIdsForMutation = spec.paymentKeys.map((key) => paymentIds.get(key));
      const expectedGross = spec.paymentKeys.reduce(
        (sum, key) => sum + (paymentSpecs.find((payment) => payment.key === key)?.amount ?? 0),
        0,
      );
      const expectedMdr = spec.provider === "mandiri_direct"
        ? roundMoney(expectedGross * 0.003)
        : spec.provider === "paylabs"
          ? roundMoney(expectedGross * 0.007)
          : 0;
      await client.query(
        `INSERT INTO sport_center.bank_mutations
          (company_id, bank_account_id, transaction_date, description, credit_amount,
           debit_amount, amount, direction, mutation_key, normalized_description,
           provider_name, provider_order_id, raw_payload, status, accounting_posted,
           source, source_classification, import_batch_id, source_app, source_module,
           source_table, source_id, provenance, uat_marker)
         VALUES ($1, $2, $3, $4, $5, 0, $5, 'IN', $6, lower($4), $7, $8, $9,
                 'unmatched', false, 'UAT bank statement import', 'actual_bank_mutation',
                 $10, 'Sport Center', 'UAT bank statement import', 'UAT CSV statement fixture',
                 $11, $12, $13)`,
        [
          companyId,
          spec.bankAccountId,
          spec.transactionDate,
          spec.description,
          spec.amount,
          `${MARKER}_${spec.key}`,
          spec.provider,
          spec.key,
          { ...rawPayload, expected_gross: expectedGross, expected_mdr: expectedMdr, payment_ids: paymentIdsForMutation },
          batchId,
          sourceId,
          provenance,
           MARKER,
        ],
      );
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({
      status: "UAT_DATASET_READY",
      marker: MARKER,
      dateRange: { from: DATE_FROM, to: DATE_TO },
      companyId,
      paymentCount: paymentSpecs.length,
      mutationCount: mutationSpecs.length,
      providerRuleCount: 4,
      mdrConfigCount: 4,
      businessCalendarCount: 3,
      importBatchId: batchId,
      settlementStatus: "all payments unsettled/pending; all mutations unmatched",
      finalReconciliationRun: false,
      accountingPosted: false,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[prepare:uat-qris] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});