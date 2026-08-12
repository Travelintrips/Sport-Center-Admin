import pg from "pg";

const { Client } = pg;

const COMPANY_ID = 1;
const CANONICAL_BANK_ACCOUNT_ID = 2;
const SOURCE_SYSTEM = "sport_center";
const SOURCE_ACCOUNT_REF = "1640006707220";
const PROVIDER = "mandiri_direct";
const EFFECTIVE_FROM = "2026-08-09";
const APPROVAL_SOURCE = "manual_business_approval";
const APPROVAL_REFERENCE =
  "Business owner approved Sport Center account 1640006707220 → CST canonical bank account ID 2";
const TARGETS = [
  {
    paymentId: 13,
    mirrorId: 8,
    paymentNumber: "SCPAY-SC-13",
    entryId: 9,
    correlationId: "sc_payment_13",
    expectedAmount: 100000,
    expectedTax: 9910,
  },
  {
    paymentId: 14,
    mirrorId: 9,
    paymentNumber: "SCPAY-SC-14",
    entryId: 10,
    correlationId: "sc_payment_14",
    expectedAmount: 50000,
    expectedTax: 4955,
  },
] as const;

type Target = (typeof TARGETS)[number];

function assertDevelopmentOnly(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("ENVIRONMENT_OR_OWNERSHIP_PRECONDITION_FAILED: NODE_ENV=production");
  }
  if (process.env.ALLOW_DEV_ON_PROD_DB === "true") {
    throw new Error(
      "ENVIRONMENT_OR_OWNERSHIP_PRECONDITION_FAILED: ALLOW_DEV_ON_PROD_DB=true",
    );
  }
  const raw = process.env.SUPABASE_DATABASE_URL_DEV;
  if (!raw) {
    throw new Error(
      "ENVIRONMENT_OR_OWNERSHIP_PRECONDITION_FAILED: SUPABASE_DATABASE_URL_DEV is required",
    );
  }
  const parsed = new URL(raw);
  if (!parsed.hostname.endsWith(".supabase.com")) {
    throw new Error(
      `ENVIRONMENT_OR_OWNERSHIP_PRECONDITION_FAILED: unexpected development host ${parsed.hostname}`,
    );
  }
  return raw.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
}

function numberOf(value: unknown): number {
  return Number(value ?? 0);
}

function sameNumber(a: unknown, b: number): boolean {
  return Math.abs(numberOf(a) - b) <= 0.005;
}

async function ensureMappingTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS sport_center.bank_account_source_mappings (
      id                       SERIAL PRIMARY KEY,
      company_id               INTEGER NOT NULL,
      source_system            TEXT NOT NULL,
      source_account_ref       TEXT NOT NULL,
      canonical_bank_account_id INTEGER NOT NULL
        REFERENCES public.company_bank_accounts(id) ON DELETE RESTRICT,
      provider                 TEXT,
      effective_from           DATE NOT NULL,
      effective_until          DATE,
      is_active                BOOLEAN NOT NULL DEFAULT true,
      evidence_source          TEXT NOT NULL,
      evidence_reference       TEXT NOT NULL,
      notes                    TEXT,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS bank_account_source_mappings_unique
      ON sport_center.bank_account_source_mappings
      (company_id, source_system, source_account_ref, COALESCE(provider, ''), effective_from)
  `);
}

async function verifySafetyGate(client: pg.Client): Promise<void> {
  const fingerprint = await client.query<{
    database_name: string;
    current_schema: string;
    server_port: number;
  }>(`
    SELECT current_database() AS database_name,
           current_schema() AS current_schema,
           inet_server_port() AS server_port
  `);
  const fp = fingerprint.rows[0];
  if (!fp || fp.server_port !== 5432) {
    throw new Error("ENVIRONMENT_OR_OWNERSHIP_PRECONDITION_FAILED: unexpected database");
  }

  const company = await client.query<{
    id: number;
    code: string;
    name: string;
    is_active: boolean;
  }>(
    `SELECT id, code, COALESCE(name, company_name, code) AS name, is_active
       FROM public.companies
      WHERE id = $1`,
    [COMPANY_ID],
  );
  const companyRow = company.rows[0];
  if (
    !companyRow ||
    companyRow.code !== "CST" ||
    companyRow.name !== "PT Cahaya Sejati Teknologi" ||
    !companyRow.is_active
  ) {
    throw new Error("ENVIRONMENT_OR_OWNERSHIP_PRECONDITION_FAILED: company 1 is not CST");
  }

  const bank = await client.query<{
    id: number;
    company_id: number;
    bank_name: string | null;
    name: string;
    is_active: boolean;
    coa_id: number | null;
  }>(
    `SELECT id, company_id, bank_name, name, is_active, coa_id
       FROM public.company_bank_accounts
      WHERE id = $1`,
    [CANONICAL_BANK_ACCOUNT_ID],
  );
  const bankRow = bank.rows[0];
  if (
    !bankRow ||
    bankRow.company_id !== COMPANY_ID ||
    bankRow.bank_name !== "Bank Mandiri" ||
    bankRow.name !== "Bank Mandiri CST" ||
    !bankRow.is_active ||
    bankRow.coa_id !== 49098
  ) {
    throw new Error(
      "ENVIRONMENT_OR_OWNERSHIP_PRECONDITION_FAILED: canonical bank account 2 is invalid",
    );
  }

  const mappings = await client.query<{
    facility_id: number;
    company_id: number;
    effective_from: string;
    is_active: boolean;
  }>(
    `SELECT facility_id, company_id, effective_from::text, is_active
       FROM sport_center.facility_company_mappings
      WHERE facility_id IN (1, 7)
        AND is_active = true
        AND effective_from <= $1::date
        AND (effective_until IS NULL OR effective_until >= $1::date)
      ORDER BY facility_id`,
    [EFFECTIVE_FROM],
  );
  for (const facilityId of [1, 7]) {
    const rows = mappings.rows.filter((row) => row.facility_id === facilityId);
    if (
      rows.length !== 1 ||
      rows[0].company_id !== COMPANY_ID ||
      !rows[0].is_active
    ) {
      throw new Error(
        `ENVIRONMENT_OR_OWNERSHIP_PRECONDITION_FAILED: facility ${facilityId} mapping invalid`,
      );
    }
  }

  console.log("SAFETY_GATE", {
    environment: "development",
    database: fp.database_name,
    schema: fp.current_schema,
    databasePort: fp.server_port,
    isDevUsingProdDb: false,
    allowDevOnProdDb: false,
    company: "1 / CST / PT Cahaya Sejati Teknologi",
    canonicalBankAccount: "2 / Bank Mandiri CST / COA 1-1020-CST",
    ownershipMappings: "facility 1 and 7 → company 1",
  });
}

async function ensureApprovedMapping(client: pg.Client): Promise<number> {
  const rows = await client.query<{
    id: number;
    canonical_bank_account_id: number;
    provider: string | null;
    effective_from: string;
    effective_until: string | null;
    is_active: boolean;
  }>(
    `SELECT id, canonical_bank_account_id, provider, effective_from::text,
            effective_until::text, is_active
       FROM sport_center.bank_account_source_mappings
      WHERE company_id = $1
        AND source_system = $2
        AND source_account_ref = $3
        AND COALESCE(provider, '') = $4
        AND is_active = true
        AND effective_from <= $5::date
        AND (effective_until IS NULL OR effective_until >= $5::date)
      ORDER BY id
      FOR UPDATE`,
    [COMPANY_ID, SOURCE_SYSTEM, SOURCE_ACCOUNT_REF, PROVIDER, EFFECTIVE_FROM],
  );

  if (rows.rows.length > 1) {
    throw new Error("BANK_ACCOUNT_MAPPING_CONFLICT: overlapping active mappings");
  }
  const existing = rows.rows[0];
  if (existing) {
    if (
      existing.canonical_bank_account_id !== CANONICAL_BANK_ACCOUNT_ID ||
      existing.provider !== PROVIDER
    ) {
      throw new Error("BANK_ACCOUNT_MAPPING_CONFLICT: existing mapping points elsewhere");
    }
    console.log("BANK_MAPPING", { status: "ALREADY_PRESENT", id: existing.id });
    return existing.id;
  }

  const inserted = await client.query<{ id: number }>(
    `INSERT INTO sport_center.bank_account_source_mappings
       (company_id, source_system, source_account_ref, canonical_bank_account_id,
        provider, effective_from, is_active, evidence_source, evidence_reference, notes)
     VALUES ($1,$2,$3,$4,$5,$6::date,true,$7,$8,$9)
     RETURNING id`,
    [
      COMPANY_ID,
      SOURCE_SYSTEM,
      SOURCE_ACCOUNT_REF,
      CANONICAL_BANK_ACCOUNT_ID,
      PROVIDER,
      EFFECTIVE_FROM,
      APPROVAL_SOURCE,
      APPROVAL_REFERENCE,
      "Approved source-reference to canonical public bank-account mapping for controlled repair payment 13/14.",
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("BANK_ACCOUNT_MAPPING_CONFLICT: mapping insert failed");
  console.log("BANK_MAPPING", { status: "CREATED", id });
  return id;
}

async function snapshotTarget(client: pg.Client, target: Target) {
  const source = await client.query(
    `SELECT id, booking_id, company_id, amount, payment_type,
            payment_method, payment_provider::text AS payment_provider,
            bank_account_id, provider_reference, provider_order_id,
            merchant_trade_no, provider_trade_no,
            COALESCE(paid_at, confirmed_at, created_at) AS paid_at,
            expected_settlement_date, status
       FROM sport_center.sport_payments
      WHERE id = $1`,
    [target.paymentId],
  );
  const mirror = await client.query(
    `SELECT id, payment_number, booking_id, source_payment_id, company_id,
            amount, method, payment_type, payment_provider, provider_code,
            provider_reference, provider_order_id, merchant_trade_no,
            provider_trade_no, bank_account_id, paid_at,
            expected_settlement_date, entry_id, posting_status, posting_error
       FROM public.sport_payments
      WHERE id = $1 AND payment_number = $2`,
    [target.mirrorId, target.paymentNumber],
  );
  const entry = await client.query(
    `SELECT id, correlation_id, source::text AS source, source_id,
            source_payment_id, company_id, payment_method, payment_provider,
            payment_type, bank_account_id, provider_reference,
            provider_order_id, merchant_trade_no, provider_trade_no,
            status::text AS status, total_debit, total_credit
       FROM public.accounting_entries
      WHERE id = $1 AND correlation_id = $2`,
    [target.entryId, target.correlationId],
  );
  const gl = await client.query(
    `SELECT id, account_id, debit, credit
       FROM public.accounting_entry_lines
      WHERE entry_id = $1
      ORDER BY id`,
    [target.entryId],
  );
  const taxInternal = await client.query(
    `SELECT id, tax_rate, dpp, tax_amount, transaction_date::text AS period,
            status, transaction_type
       FROM sport_center.tax_transactions
      WHERE reference_type = 'sport_center_payment'
        AND reference_id = $1
        AND transaction_type = 'original'
        AND status = 'posted'
      ORDER BY id`,
    [target.paymentId],
  );
  const taxPublic = await client.query(
    `SELECT id, company_id, accounting_entry_id, tax_type, rate,
            base_amount, tax_amount, direction, period, entity_type, entity_id
       FROM public.gl_tax_lines
      WHERE accounting_entry_id = $1
        AND tax_type = 'PPN_OUT'
        AND entity_type = 'sport_center_payment'
        AND entity_id = $2
      ORDER BY id`,
    [target.entryId, String(target.paymentId)],
  );
  const journal = await client.query(
    `SELECT id, payment_id, debit_amount, credit_revenue_amount,
            credit_ppn_amount
       FROM sport_center.accounting_journals
      WHERE payment_id = $1
      ORDER BY id`,
    [target.paymentId],
  );
  const glIds = gl.rows.map((row) => Number(row.id));
  const accountIds = gl.rows.map((row) => Number(row.account_id));
  return {
    source: source.rows[0] ?? null,
    mirror: mirror.rows[0] ?? null,
    entry: entry.rows[0] ?? null,
    gl: {
      lineIds: glIds,
      lineCount: gl.rows.length,
      debit: gl.rows.reduce((sum, row) => sum + numberOf(row.debit), 0),
      credit: gl.rows.reduce((sum, row) => sum + numberOf(row.credit), 0),
      accountIds,
    },
    taxInternal: taxInternal.rows,
    taxPublic: taxPublic.rows,
    journal: journal.rows,
  };
}

function assertInitialSnapshot(snapshot: Awaited<ReturnType<typeof snapshotTarget>>, target: Target) {
  if (!snapshot.source) throw new Error(`SOURCE_PAYMENT_NOT_FOUND:${target.paymentId}`);
  if (snapshot.source.company_id != null && Number(snapshot.source.company_id) !== COMPANY_ID) {
    throw new Error(`SOURCE_COMPANY_CONFLICT:${target.paymentId}`);
  }
  if (!snapshot.mirror) throw new Error(`MIRROR_TARGET_NOT_FOUND:${target.mirrorId}`);
  if (!snapshot.entry) throw new Error(`ACCOUNTING_ENTRY_TARGET_NOT_FOUND:${target.entryId}`);
  if (snapshot.entry.status !== "posted") {
    throw new Error(`ACCOUNTING_ENTRY_NOT_POSTED:${target.entryId}`);
  }
  if (
    snapshot.gl.lineCount < 2 ||
    !sameNumber(snapshot.gl.debit, target.expectedAmount) ||
    !sameNumber(snapshot.gl.credit, target.expectedAmount) ||
    snapshot.gl.lineIds.length !== snapshot.gl.lineCount
  ) {
    throw new Error(`GL_INITIAL_INVARIANT_FAILED:${target.paymentId}`);
  }
  if (
    snapshot.taxInternal.length !== 1 ||
    !sameNumber(snapshot.taxInternal[0]?.tax_amount, target.expectedTax)
  ) {
    throw new Error(`INTERNAL_TAX_INVARIANT_FAILED:${target.paymentId}`);
  }
  if (snapshot.journal.length !== 1) {
    throw new Error(`INTERNAL_JOURNAL_INVARIANT_FAILED:${target.paymentId}`);
  }
}

async function repairPayment(
  client: pg.Client,
  target: Target,
  mappingId: number,
): Promise<void> {
  await client.query("BEGIN");
  try {
    const before = await snapshotTarget(client, target);
    assertInitialSnapshot(before, target);
    const source = before.source!;
    if (
      source.payment_method !== "QRIS" ||
      String(source.payment_provider ?? "").trim().toLowerCase() !== PROVIDER
    ) {
      throw new Error(`SOURCE_PROVIDER_METHOD_INVARIANT_FAILED:${target.paymentId}`);
    }

    const mapping = await client.query<{
      id: number;
      canonical_bank_account_id: number;
    }>(
      `SELECT id, canonical_bank_account_id
         FROM sport_center.bank_account_source_mappings
        WHERE id = $1
          AND company_id = $2
          AND source_system = $3
          AND source_account_ref = $4
          AND provider = $5
          AND is_active = true
          AND effective_from <= $6::date
          AND (effective_until IS NULL OR effective_until >= $6::date)`,
      [
        mappingId,
        COMPANY_ID,
        SOURCE_SYSTEM,
        SOURCE_ACCOUNT_REF,
        PROVIDER,
        EFFECTIVE_FROM,
      ],
    );
    if (
      mapping.rows.length !== 1 ||
      mapping.rows[0].canonical_bank_account_id !== CANONICAL_BANK_ACCOUNT_ID
    ) {
      throw new Error(`BANK_ACCOUNT_RESOLUTION_FAILED:${target.paymentId}`);
    }

    await client.query(
      `UPDATE sport_center.sport_payments
          SET company_id = $2
        WHERE id = $1
          AND (company_id IS NULL OR company_id = $2)`,
      [target.paymentId, COMPANY_ID],
    );

    const providerReference = source.provider_reference;
    const providerOrderId = source.provider_order_id;
    const merchantTradeNo = source.merchant_trade_no;
    const providerTradeNo = source.provider_trade_no;
    await client.query(
      `UPDATE public.sport_payments
          SET source_payment_id = $2,
              company_id = $3,
              bank_account_id = $4,
              method = COALESCE($5, method),
              payment_type = COALESCE($6, payment_type),
              payment_provider = COALESCE($7, payment_provider),
              provider_code = COALESCE($7, provider_code),
              provider_reference = COALESCE($8, provider_reference),
              provider_order_id = COALESCE($9, provider_order_id),
              merchant_trade_no = COALESCE($10, merchant_trade_no),
              provider_trade_no = COALESCE($11, provider_trade_no),
              paid_at = COALESCE($12, paid_at),
              expected_settlement_date = COALESCE($13, expected_settlement_date),
              entry_id = $14,
              posting_status = 'failed',
              posting_error = 'Controlled repair validation in progress',
              updated_at = NOW()
        WHERE id = $1
          AND payment_number = $15`,
      [
        target.mirrorId,
        target.paymentId,
        COMPANY_ID,
        CANONICAL_BANK_ACCOUNT_ID,
        source.payment_method,
        source.payment_type,
        source.payment_provider,
        providerReference,
        providerOrderId,
        merchantTradeNo,
        providerTradeNo,
        source.paid_at,
        source.expected_settlement_date,
        target.entryId,
        target.paymentNumber,
      ],
    );

    await client.query(
      `UPDATE public.accounting_entries
          SET source_payment_id = $2,
              company_id = $3,
              payment_method = $4,
              payment_provider = $5,
              payment_type = $6,
              bank_account_id = $7,
              provider_reference = COALESCE($8, provider_reference),
              provider_order_id = COALESCE($9, provider_order_id),
              merchant_trade_no = COALESCE($10, merchant_trade_no),
              provider_trade_no = COALESCE($11, provider_trade_no)
        WHERE id = $1
          AND correlation_id = $12
          AND status = 'posted'`,
      [
        target.entryId,
        target.paymentId,
        COMPANY_ID,
        source.payment_method,
        source.payment_provider,
        source.payment_type,
        CANONICAL_BANK_ACCOUNT_ID,
        providerReference,
        providerOrderId,
        merchantTradeNo,
        providerTradeNo,
        target.correlationId,
      ],
    );

    const tax = before.taxInternal[0];
    const existingTax = await client.query(
      `SELECT id, company_id, accounting_entry_id, rate, base_amount,
              tax_amount, direction, period, entity_type, entity_id
         FROM public.gl_tax_lines
        WHERE accounting_entry_id = $1
          AND tax_type = 'PPN_OUT'
          AND entity_type = 'sport_center_payment'
          AND entity_id = $2
        ORDER BY id
        FOR UPDATE`,
      [target.entryId, String(target.paymentId)],
    );
    if (existingTax.rows.length > 1) {
      throw new Error(`PUBLIC_TAX_DUPLICATE:${target.paymentId}`);
    }
    const dpp = numberOf(tax.dpp);
    const taxAmount = numberOf(tax.tax_amount);
    const rate = numberOf(tax.tax_rate);
    const period = String(tax.period).slice(0, 7);
    if (!sameNumber(taxAmount, target.expectedTax)) {
      throw new Error(`PUBLIC_TAX_AMOUNT_INVARIANT_FAILED:${target.paymentId}`);
    }
    if (existingTax.rows.length === 0) {
      await client.query(
        `INSERT INTO public.gl_tax_lines
           (company_id, accounting_entry_id, tax_type, rate, base_amount,
            tax_amount, direction, period, entity_type, entity_id,
            is_reported, created_at)
         VALUES ($1,$2,'PPN_OUT',$3,$4,$5,'out',$6,
                 'sport_center_payment',$7,false,NOW())`,
        [
          COMPANY_ID,
          target.entryId,
          rate,
          dpp,
          taxAmount,
          period,
          String(target.paymentId),
        ],
      );
    } else {
      const existing = existingTax.rows[0];
      if (
        Number(existing.company_id) !== COMPANY_ID ||
        Number(existing.accounting_entry_id) !== target.entryId ||
        !sameNumber(existing.rate, rate) ||
        !sameNumber(existing.base_amount, dpp) ||
        !sameNumber(existing.tax_amount, taxAmount) ||
        existing.direction !== "out"
      ) {
        throw new Error(`PUBLIC_TAX_CONFLICT:${target.paymentId}`);
      }
    }

    const after = await snapshotTarget(client, target);
    if (
      !after.source ||
      Number(after.source.company_id) !== COMPANY_ID ||
      after.source.bank_account_id !== SOURCE_ACCOUNT_REF ||
      !after.mirror ||
      Number(after.mirror.source_payment_id) !== target.paymentId ||
      Number(after.mirror.company_id) !== COMPANY_ID ||
      Number(after.mirror.bank_account_id) !== CANONICAL_BANK_ACCOUNT_ID ||
      after.mirror.method !== "QRIS" ||
      after.mirror.payment_type !== "full_payment" ||
      String(after.mirror.payment_provider).toLowerCase() !== PROVIDER ||
      Number(after.mirror.entry_id) !== target.entryId ||
      !after.entry ||
      after.entry.source !== before.entry?.source ||
      Number(after.entry.source_id) !== Number(before.entry?.source_id) ||
      Number(after.entry.source_payment_id) !== target.paymentId ||
      Number(after.entry.company_id) !== COMPANY_ID ||
      after.entry.payment_method !== "QRIS" ||
      String(after.entry.payment_provider).toLowerCase() !== PROVIDER ||
      after.entry.payment_type !== "full_payment" ||
      Number(after.entry.bank_account_id) !== CANONICAL_BANK_ACCOUNT_ID ||
      after.entry.status !== "posted" ||
      after.gl.lineCount !== before.gl.lineCount ||
      !sameNumber(after.gl.debit, before.gl.debit) ||
      !sameNumber(after.gl.credit, before.gl.credit) ||
      JSON.stringify(after.gl.lineIds) !== JSON.stringify(before.gl.lineIds) ||
      JSON.stringify(after.gl.accountIds) !== JSON.stringify(before.gl.accountIds) ||
      after.taxPublic.length !== 1 ||
      !sameNumber(after.taxPublic[0]?.tax_amount, target.expectedTax)
    ) {
      throw new Error(`CONTROLLED_REPAIR_INVARIANT_FAILED:${target.paymentId}`);
    }

    await client.query(
      `UPDATE public.sport_payments
          SET posting_status = 'posted',
              posting_error = NULL,
              updated_at = NOW()
        WHERE id = $1 AND payment_number = $2`,
      [target.mirrorId, target.paymentNumber],
    );
    await client.query("COMMIT");
    console.log("REPAIR", { paymentId: target.paymentId, status: "COMMITTED" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function auditDuplicates(client: pg.Client, target: Target): Promise<void> {
  const mirror = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM public.sport_payments
      WHERE payment_number = $1`,
    [target.paymentNumber],
  );
  const entry = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM public.accounting_entries
      WHERE correlation_id = $1`,
    [target.correlationId],
  );
  const tax = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM public.gl_tax_lines
      WHERE accounting_entry_id = $1
        AND tax_type = 'PPN_OUT'
        AND entity_type = 'sport_center_payment'
        AND entity_id = $2`,
    [target.entryId, String(target.paymentId)],
  );
  if (
    numberOf(mirror.rows[0]?.count) !== 1 ||
    numberOf(entry.rows[0]?.count) !== 1 ||
    numberOf(tax.rows[0]?.count) !== 1
  ) {
    throw new Error(`DUPLICATE_CHECK_FAILED:${target.paymentId}`);
  }
}

async function dryRunAlreadyComplete(client: pg.Client): Promise<void> {
  const mapping = await client.query<{
    id: number;
    canonical_bank_account_id: number;
    provider: string | null;
    effective_from: string;
  }>(
    `SELECT id, canonical_bank_account_id, provider, effective_from::text
       FROM sport_center.bank_account_source_mappings
      WHERE company_id = $1
        AND source_system = $2
        AND source_account_ref = $3
        AND provider = $4
        AND is_active = true
        AND effective_from <= $5::date
        AND (effective_until IS NULL OR effective_until >= $5::date)
      ORDER BY id`,
    [COMPANY_ID, SOURCE_SYSTEM, SOURCE_ACCOUNT_REF, PROVIDER, EFFECTIVE_FROM],
  );
  if (
    mapping.rows.length !== 1 ||
    mapping.rows[0].canonical_bank_account_id !== CANONICAL_BANK_ACCOUNT_ID
  ) {
    throw new Error("BANK_ACCOUNT_MAPPING_CONFLICT: dry-run mapping is not deterministic");
  }

  for (const target of TARGETS) {
    const snapshot = await snapshotTarget(client, target);
    if (
      !snapshot.source ||
      Number(snapshot.source.company_id) !== COMPANY_ID ||
      snapshot.source.bank_account_id !== SOURCE_ACCOUNT_REF ||
      !snapshot.mirror ||
      Number(snapshot.mirror.source_payment_id) !== target.paymentId ||
      Number(snapshot.mirror.company_id) !== COMPANY_ID ||
      Number(snapshot.mirror.bank_account_id) !== CANONICAL_BANK_ACCOUNT_ID ||
      snapshot.mirror.method !== "QRIS" ||
      snapshot.mirror.payment_type !== "full_payment" ||
      String(snapshot.mirror.payment_provider).toLowerCase() !== PROVIDER ||
      Number(snapshot.mirror.entry_id) !== target.entryId ||
      snapshot.mirror.posting_status !== "posted" ||
      snapshot.mirror.posting_error != null ||
      !snapshot.entry ||
      Number(snapshot.entry.source_payment_id) !== target.paymentId ||
      Number(snapshot.entry.company_id) !== COMPANY_ID ||
      snapshot.entry.payment_method !== "QRIS" ||
      String(snapshot.entry.payment_provider).toLowerCase() !== PROVIDER ||
      snapshot.entry.payment_type !== "full_payment" ||
      Number(snapshot.entry.bank_account_id) !== CANONICAL_BANK_ACCOUNT_ID ||
      snapshot.entry.status !== "posted" ||
      snapshot.gl.lineCount < 2 ||
      !sameNumber(snapshot.gl.debit, target.expectedAmount) ||
      !sameNumber(snapshot.gl.credit, target.expectedAmount) ||
      snapshot.taxPublic.length !== 1 ||
      !sameNumber(snapshot.taxPublic[0]?.tax_amount, target.expectedTax)
    ) {
      throw new Error(`NOT_COMPLETE:${target.paymentId}`);
    }
    await auditDuplicates(client, target);
    console.log("DRY_RUN", {
      paymentId: target.paymentId,
      status: "ALREADY_COMPLETE",
      sourcePaymentUpdateNeeded: 0,
      mirrorRepairNeeded: 0,
      accountingMetadataRepairNeeded: 0,
      newAccountingEntry: 0,
      newGlLines: 0,
      newPublicTaxLine: 0,
    });
  }
  console.log("DRY_RUN_MAPPING", { status: "ALREADY_PRESENT", id: mapping.rows[0].id });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString = assertDevelopmentOnly();
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    options: "-c search_path=sport_center,public",
  });
  await client.connect();
  try {
    await verifySafetyGate(client);
    if (dryRun) {
      await dryRunAlreadyComplete(client);
      return;
    }
    await ensureMappingTable(client);

    const mappingId = await ensureApprovedMapping(client);
    const before = new Map<number, Awaited<ReturnType<typeof snapshotTarget>>>();
    for (const target of TARGETS) {
      const snapshot = await snapshotTarget(client, target);
      assertInitialSnapshot(snapshot, target);
      before.set(target.paymentId, snapshot);
      console.log("PRE_REPAIR_SNAPSHOT", JSON.stringify({ target, snapshot }));
    }

    for (const target of TARGETS) {
      await repairPayment(client, target, mappingId);
      await auditDuplicates(client, target);
    }

    const mapping = await client.query(
      `SELECT id, company_id, source_system, source_account_ref,
              canonical_bank_account_id, provider, effective_from::text,
              effective_until::text, is_active, evidence_source
         FROM sport_center.bank_account_source_mappings
        WHERE id = $1`,
      [mappingId],
    );
    console.log("POST_REPAIR_MAPPING", JSON.stringify(mapping.rows[0]));
    for (const target of TARGETS) {
      const snapshot = await snapshotTarget(client, target);
      console.log("POST_REPAIR_AUDIT", JSON.stringify({ target, snapshot }));
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});