import { jest } from "@jest/globals";

type Mirror = {
  id: number;
  paymentNumber: string;
  amount: number;
  postingStatus: "unposted" | "failed" | "posted";
  entryId: number | null;
  sourcePaymentId: number | null;
  postingError: string | null;
};

type Entry = {
  id: number;
  correlationId: string;
  status: "draft" | "posted";
  totalDebit: number;
  totalCredit: number;
  description: string;
};

type Line = {
  entryId: number;
  accountId: number;
  debit: number;
  credit: number;
};

type FakeState = {
  mirrors: Mirror[];
  entries: Entry[];
  lines: Line[];
  taxRows: Array<{ referenceId: number; taxAmount: number; grandTotal: number }>;
  glTaxRows: Array<{ entryId: number; baseAmount: number; taxAmount: number }>;
  nextEntryId: number;
  nextMirrorId: number;
  nextEntrySequence: number;
  confirmedSourcePaymentIds: number[];
};

const state: FakeState = {
  mirrors: [],
  entries: [],
  lines: [],
  taxRows: [],
  glTaxRows: [],
  nextEntryId: 1,
  nextMirrorId: 1,
  nextEntrySequence: 1,
  confirmedSourcePaymentIds: [],
};

function resetState(): void {
  state.mirrors = [];
  state.entries = [];
  state.lines = [];
  state.taxRows = [];
  state.glTaxRows = [];
  state.nextEntryId = 1;
  state.nextMirrorId = 1;
  state.nextEntrySequence = 1;
  state.confirmedSourcePaymentIds = [];
}

function scalar(value: unknown): number {
  return Number(value ?? 0);
}

async function fakeQuery(text: string, values: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
  const sql = text.replace(/\s+/g, " ").trim();

  if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
    return { rows: [], rowCount: 0 };
  }
  if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
    return { rows: [], rowCount: 1 };
  }

  if (sql.includes("SELECT COUNT(*) AS pending")) {
    const pending = state.confirmedSourcePaymentIds.filter((sourcePaymentId) => {
      const mirror = state.mirrors.find((row) => row.sourcePaymentId === sourcePaymentId);
      if (!mirror) return true;
      const entry = mirror.entryId ? state.entries.find((row) => row.id === mirror.entryId) : undefined;
      return mirror.postingStatus !== "posted" || !mirror.entryId || entry?.status !== "posted";
    }).length;
    return { rows: [{ pending }], rowCount: 1 };
  }

  if (sql.includes("SELECT 1 FROM public.sport_payments WHERE payment_number = $1 OR source_payment_id = $2")) {
    const mirror = state.mirrors.find((row) =>
      row.paymentNumber === values[0] || row.sourcePaymentId === scalar(values[1]),
    );
    return { rows: mirror ? [{ "?column?": 1 }] : [], rowCount: mirror ? 1 : 0 };
  }

  if (sql.includes("SELECT id, entry_id, posting_status, source_payment_id, amount, method")) {
    const mirror = state.mirrors.find((row) =>
      row.paymentNumber === values[0] || row.sourcePaymentId === scalar(values[1]),
    );
    const sourcePaymentId = mirror?.sourcePaymentId ?? Number(String(mirror?.paymentNumber ?? "").replace("SCPAY-SC-", ""));
    return {
      rows: mirror ? [{
        id: mirror.id,
        entry_id: mirror.entryId,
        posting_status: mirror.postingStatus,
        source_payment_id: mirror.sourcePaymentId,
        amount: mirror.amount,
        method: sourcePaymentId === 42 || sourcePaymentId === 43 ? "QRIS" : "Transfer Bank",
        payment_type: sourcePaymentId === 43 ? "dp" : sourcePaymentId === 44 ? "pelunasan" : "full_payment",
        payment_provider: sourcePaymentId === 42 || sourcePaymentId === 43 ? "mandiri_direct" : "unknown",
        provider_code: sourcePaymentId === 42 || sourcePaymentId === 43 ? "mandiri_direct" : "unknown",
        company_id: 1,
        bank_account_id: "mandiri",
      }] : [],
      rowCount: mirror ? 1 : 0,
    };
  }

  if (sql.includes("SELECT id, booking_id, company_id, amount, payment_method, payment_type")) {
    const sourcePaymentId = scalar(values[0]);
    const sourceAmount = sourcePaymentId === 43 ? 50_000 : sourcePaymentId === 44 ? 150_000 : 100_000;
    return {
      rows: state.confirmedSourcePaymentIds.includes(sourcePaymentId) || sourcePaymentId > 0
        ? [{
          id: sourcePaymentId,
          booking_id: sourcePaymentId,
          company_id: 1,
          amount: sourceAmount,
          payment_method: sourcePaymentId === 42 || sourcePaymentId === 43 ? "QRIS" : "Transfer Bank",
          payment_type: sourcePaymentId === 43 ? "dp" : sourcePaymentId === 44 ? "pelunasan" : "full_payment",
          payment_provider: sourcePaymentId === 42 || sourcePaymentId === 43 ? "mandiri_direct" : "unknown",
          bank_account_id: "mandiri",
          provider_reference: null,
          provider_order_id: null,
          merchant_trade_no: null,
          provider_trade_no: null,
          paid_at: "2026-08-09T12:00:00.000Z",
          confirmed_at: "2026-08-09T12:00:00.000Z",
        }]
        : [],
      rowCount: 1,
    };
  }

  if (sql === "SELECT id, status FROM public.accounting_entries WHERE correlation_id = $1 LIMIT 1") {
    const entry = state.entries.find((row) => row.correlationId === values[0]);
    return { rows: entry ? [{ id: entry.id, status: entry.status }] : [], rowCount: entry ? 1 : 0 };
  }

  if (sql.includes("SELECT id, status, company_id, payment_method, payment_provider") &&
      sql.includes("FROM public.accounting_entries")) {
    const entry = state.entries.find((row) => row.correlationId === values[0]);
    return {
      rows: entry ? [{
        id: entry.id,
        status: entry.status,
        company_id: 1,
        payment_method: entry.correlationId === "sc_payment_42" || entry.correlationId === "sc_payment_43" ? "QRIS" : "Transfer Bank",
        payment_provider: entry.correlationId === "sc_payment_42" || entry.correlationId === "sc_payment_43" ? "mandiri_direct" : "unknown",
      }] : [],
      rowCount: entry ? 1 : 0,
    };
  }

  if (sql.includes("FROM public.accounting_entries") &&
      sql.includes("WHERE id = $1") &&
      sql.includes("status = 'posted'")) {
    const entry = state.entries.find((row) => row.id === scalar(values[0]) && row.status === "posted");
    return {
      rows: entry ? [{
        id: entry.id,
        company_id: 1,
        payment_method: entry.correlationId === "sc_payment_42" || entry.correlationId === "sc_payment_43" ? "QRIS" : "Transfer Bank",
        payment_provider: entry.correlationId === "sc_payment_42" || entry.correlationId === "sc_payment_43" ? "mandiri_direct" : "unknown",
        total_debit: entry.totalDebit,
        total_credit: entry.totalCredit,
      }] : [],
      rowCount: entry ? 1 : 0,
    };
  }

  if (sql.includes("SELECT COALESCE(MAX(") && sql.includes("FROM public.accounting_entries")) {
    return { rows: [{ seq: state.nextEntrySequence }], rowCount: 1 };
  }

  if (sql === "SELECT id FROM public.accounting_journals WHERE code = 'BNK-CST' LIMIT 1") {
    return { rows: [{ id: 389 }], rowCount: 1 };
  }
  if (sql.includes("SELECT id FROM public.chart_of_accounts WHERE code = '1-1020-CST'")) {
    return { rows: [{ id: 49098 }], rowCount: 1 };
  }
  if (sql.includes("SELECT id FROM public.chart_of_accounts WHERE code = '4-1017-CST'")) {
    return { rows: [{ id: 1315 }], rowCount: 1 };
  }
  if (sql.includes("SELECT id FROM public.chart_of_accounts WHERE code = '2-1020-CST'")) {
    return { rows: [{ id: 1316 }], rowCount: 1 };
  }

  if (sql.startsWith("SELECT id, code, name FROM public.chart_of_accounts")) {
    return { rows: [{ id: 49098, code: "1-1020-CST", name: "Bank Mandiri CST" }], rowCount: 1 };
  }

  if (sql.startsWith("INSERT INTO public.accounting_entries")) {
    const entry: Entry = {
      id: state.nextEntryId++,
      correlationId: String(values[8]),
      status: "draft",
      totalDebit: scalar(values[6]),
      totalCredit: scalar(values[6]),
      description: String(values[4]),
    };
    state.entries.push(entry);
    state.nextEntrySequence += 1;
    return { rows: [{ id: entry.id }], rowCount: 1 };
  }

  if (sql.startsWith("INSERT INTO public.accounting_entry_lines")) {
    const entryId = scalar(values[0]);
    if (sql.includes("($1,$2,$3,$4,0), ($1,$5,$6,0,$7), ($1,$8,$9,0,$10)")) {
      state.lines.push(
        { entryId, accountId: scalar(values[1]), debit: scalar(values[3]), credit: 0 },
        { entryId, accountId: scalar(values[4]), debit: 0, credit: scalar(values[6]) },
        { entryId, accountId: scalar(values[7]), debit: 0, credit: scalar(values[9]) },
      );
    } else {
      state.lines.push(
        { entryId, accountId: scalar(values[1]), debit: scalar(values[3]), credit: 0 },
        { entryId, accountId: scalar(values[4]), debit: 0, credit: scalar(values[3]) },
      );
    }
    return { rows: [], rowCount: 2 };
  }

  if (sql === "UPDATE public.accounting_entries SET status = 'posted' WHERE id = $1") {
    const entry = state.entries.find((row) => row.id === scalar(values[0]));
    if (entry) entry.status = "posted";
    return { rows: [], rowCount: entry ? 1 : 0 };
  }

  if (sql.includes("SELECT COUNT(*)::int AS line_count") &&
      sql.includes("FROM public.accounting_entry_lines")) {
    const entryId = scalar(values[0]);
    const lines = state.lines.filter((line) => line.entryId === entryId);
    return {
      rows: [{
        line_count: lines.length,
        debit: lines.reduce((sum, line) => sum + line.debit, 0),
        credit: lines.reduce((sum, line) => sum + line.credit, 0),
      }],
      rowCount: 1,
    };
  }

  if (sql.startsWith("INSERT INTO sport_center.tax_transactions")) {
    if (sql.includes("WHERE NOT EXISTS")) {
      const referenceId = scalar(values[0]);
      if (!state.taxRows.some((row) => row.referenceId === referenceId)) {
        state.taxRows.push({
          referenceId,
          taxAmount: scalar(values[7]),
          grandTotal: scalar(values[6]),
        });
      }
    }
    return { rows: [], rowCount: 1 };
  }

  if (sql.startsWith("INSERT INTO public.gl_tax_lines")) {
    state.glTaxRows.push({
      entryId: scalar(values[1]),
      baseAmount: scalar(values[3]),
      taxAmount: scalar(values[4]),
    });
    return { rows: [], rowCount: 1 };
  }

  if (sql.startsWith("UPDATE public.sport_payments")) {
    const mirror = state.mirrors.find((row) => row.paymentNumber === values[0] || row.id === scalar(values[0]));
    if (!mirror) return { rows: [], rowCount: 0 };
    if (sql.includes("posting_status = 'failed'")) {
      mirror.postingStatus = "failed";
      mirror.postingError = String(values[1]);
    } else {
      mirror.entryId = scalar(values[1]);
      if (values[2] != null) mirror.sourcePaymentId = scalar(values[2]);
      mirror.postingStatus = "posted";
      mirror.postingError = null;
    }
    return { rows: [], rowCount: 1 };
  }

  if (sql.startsWith("SELECT sp.entry_id, sp.posting_status")) {
    const mirror = state.mirrors.find((row) => row.id === scalar(values[0]));
    const entry = mirror?.entryId ? state.entries.find((row) => row.id === mirror.entryId) : undefined;
    return {
      rows: mirror ? [{ entry_id: mirror.entryId, posting_status: mirror.postingStatus, entry_status: entry?.status ?? null }] : [],
      rowCount: mirror ? 1 : 0,
    };
  }

  throw new Error(`Unhandled fake SQL: ${sql}`);
}

class FakeClient {
  query(text: string, values: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
    return fakeQuery(text, values);
  }
  release(): void {}
}

class FakePool {
  async connect(): Promise<FakeClient> {
    return new FakeClient();
  }
  query(text: string, values: unknown[] = []): Promise<{ rows: any[]; rowCount: number }> {
    return fakeQuery(text, values);
  }
}

jest.unstable_mockModule("pg", () => ({ default: { Pool: FakePool } }));
jest.unstable_mockModule("@workspace/db", () => ({
  db: {},
  accountingJournalsTable: {},
  accountingJournalLinesTable: {},
  taxTransactionsTable: {},
  paymentsTable: {},
}));

process.env.SUPABASE_DATABASE_URL_DEV = "postgres://integration-test";

const { postSportCenterBookingPayment, getSportCenterPaymentCorrelationId } =
  await import("./accounting.js");
const { countPendingPaymentMirrors } = await import("./bizportalSync.js");

function addMirror(
  paymentNumber: string,
  amount: number,
  postingStatus: Mirror["postingStatus"] = "unposted",
): Mirror {
  const mirror: Mirror = {
    id: state.nextMirrorId++,
    paymentNumber,
    amount,
    postingStatus,
    entryId: null,
    sourcePaymentId: null,
    postingError: postingStatus === "failed" ? "previous posting failed" : null,
  };
  state.mirrors.push(mirror);
  return mirror;
}

function expectBalancedEntry(entryId: number, expectedGross: number, expectedPpn: number): void {
  const entry = state.entries.find((row) => row.id === entryId);
  expect(entry).toMatchObject({ status: "posted", totalDebit: expectedGross, totalCredit: expectedGross });

  const lines = state.lines.filter((line) => line.entryId === entryId);
  expect(lines.reduce((sum, line) => sum + line.debit, 0)).toBe(expectedGross);
  expect(lines.reduce((sum, line) => sum + line.credit, 0)).toBe(expectedGross);
  expect(state.taxRows.filter((row) => row.referenceId > 0 && expectedPpn > 0)).toHaveLength(expectedPpn > 0 ? 1 : 0);
}

describe("Sport Center payment accounting integration", () => {
  beforeEach(() => resetState());

  it.each([
    ["Transfer Bank", "full_payment", 41, 100_000, 0],
    ["QRIS", "full_payment", 42, 100_000, 9_910],
    ["QRIS", "dp", 43, 50_000, 4_955],
    ["Transfer Bank", "pelunasan", 44, 150_000, 0],
  ])("posts %s %s by payment id with balanced GL", async (paymentMethod, paymentType, sourcePaymentId, amount, expectedPpn) => {
    const mirror = addMirror(`SCPAY-SC-${sourcePaymentId}`, amount);

    const result = await postSportCenterBookingPayment({
      paymentNumber: mirror.paymentNumber,
      sourcePaymentId,
      bookingId: sourcePaymentId,
      orderNumber: `SC-${sourcePaymentId}`,
      amount,
      paymentMethod,
      paymentType,
      paidAt: "2026-08-09T12:00:00.000Z",
      ppnRate: expectedPpn > 0 ? 11 : 0,
    });

    expect(result).toMatchObject({ postingStatus: "posted", alreadyPosted: false });
    expect(mirror).toMatchObject({
      postingStatus: "posted",
      entryId: result.entryId,
      sourcePaymentId,
      postingError: null,
    });
    expectBalancedEntry(result.entryId, amount, expectedPpn);
    expect(getSportCenterPaymentCorrelationId(mirror.paymentNumber, sourcePaymentId)).toBe(`sc_payment_${sourcePaymentId}`);
  });

  it("retries an existing failed mirror by reusing the already-posted payment entry", async () => {
    const sourcePaymentId = 45;
    const mirror = addMirror(`SCPAY-SC-${sourcePaymentId}`, 100_000, "failed");
    const existingEntry: Entry = {
      id: state.nextEntryId++,
      correlationId: `sc_payment_${sourcePaymentId}`,
      status: "posted",
      totalDebit: 100_000,
      totalCredit: 100_000,
      description: "existing direct confirmation",
    };
    state.entries.push(existingEntry);

    const result = await postSportCenterBookingPayment({
      paymentNumber: mirror.paymentNumber,
      sourcePaymentId,
      bookingId: sourcePaymentId,
      orderNumber: `SC-${sourcePaymentId}`,
          amount: sourcePaymentId === 43 ? 50_000 : sourcePaymentId === 44 ? 150_000 : 100_000,
      paymentMethod: "QRIS",
      paymentType: "full_payment",
      ppnRate: 11,
    });

    expect(result).toEqual({ entryId: existingEntry.id, postingStatus: "posted", alreadyPosted: true });
    expect(state.entries).toHaveLength(1);
    expect(mirror).toMatchObject({
      postingStatus: "posted",
      entryId: existingEntry.id,
      sourcePaymentId,
      postingError: null,
    });
  });

  it("is idempotent when the mirror is retried after posting", async () => {
    const sourcePaymentId = 46;
    const mirror = addMirror(`SCPAY-SC-${sourcePaymentId}`, 100_000);
    const input = {
      paymentNumber: mirror.paymentNumber,
      sourcePaymentId,
      bookingId: sourcePaymentId,
      orderNumber: `SC-${sourcePaymentId}`,
      amount: 100_000,
      paymentMethod: "Transfer Bank",
      paymentType: "pelunasan",
      ppnRate: 11,
    } as const;

    const first = await postSportCenterBookingPayment(input);
    const second = await postSportCenterBookingPayment(input);

    expect(second).toEqual({ entryId: first.entryId, postingStatus: "posted", alreadyPosted: true });
    expect(state.entries).toHaveLength(1);
    expect(state.lines).toHaveLength(3);
    expect(state.taxRows).toHaveLength(1);
  });

  it("counts missing, failed, and unposted mirrors as pending", async () => {
    state.confirmedSourcePaymentIds = [47, 48, 49];
    const failedMirror = addMirror("SCPAY-SC-47", 100_000, "failed");
    const postedMirror = addMirror("SCPAY-SC-48", 100_000, "posted");
    const postedEntry: Entry = {
      id: state.nextEntryId++,
      correlationId: "sc_payment_48",
      status: "posted",
      totalDebit: 100_000,
      totalCredit: 100_000,
      description: "posted mirror",
    };
    state.entries.push(postedEntry);
    postedMirror.entryId = postedEntry.id;
    failedMirror.sourcePaymentId = 47;
    postedMirror.sourcePaymentId = 48;

    const pending = await countPendingPaymentMirrors(new FakePool() as never);

    expect(pending).toBe(2);
  });
});