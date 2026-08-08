import pg from "pg";

const { Client } = pg;
const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL;
const apply = process.argv.includes("--apply");

if (!rawUrl) {
  console.error("SUPABASE_DATABASE_URL_DEV atau SUPABASE_DATABASE_URL wajib diisi.");
  process.exit(1);
}

const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

type PaymentRow = {
  id: number;
  booking_id: number;
  proof_url: string | null;
  payment_provider: string | null;
  merchant_trade_no: string | null;
  provider_trade_no: string | null;
  provider_reference: string | null;
  paid_at: Date | null;
  confirmed_at: Date | null;
};

type PaylabsRow = {
  booking_id: number | null;
  merchant_trade_no: string;
  paylabs_trade_no: string | null;
  updated_at: Date;
  raw_notification: Record<string, unknown> | null;
};

function providerReference(row: PaylabsRow): string | null {
  const payload = row.raw_notification ?? {};
  for (const key of [
    "providerReference", "provider_reference", "reference", "referenceId",
    "reference_id", "transactionId", "transaction_id", "platformTradeNo",
    "paylabsTradeNo", "tradeNo",
  ]) {
    const value = payload[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return row.paylabs_trade_no?.trim() || null;
}

async function main() {
  await client.connect();
  try {
    const { rows: payments } = await client.query<PaymentRow>(`
      SELECT id, booking_id, proof_url, payment_provider, merchant_trade_no,
             provider_trade_no, provider_reference, paid_at, confirmed_at
      FROM sport_center.sport_payments
      WHERE UPPER(payment_method) = 'QRIS'
    `);
    const { rows: paylabs } = await client.query<PaylabsRow>(`
      SELECT booking_id, merchant_trade_no, paylabs_trade_no, updated_at, raw_notification
      FROM sport_center.paylabs_transactions
      WHERE UPPER(status) = 'SUCCESS'
    `);

    let paylabsSuccessfullyBackfilled = 0;
    let mandiriDirectConfidentlyIdentified = 0;
    let qrisUnknown = 0;
    let ambiguousRows = 0;

    for (const payment of payments) {
      if (payment.payment_provider) {
        if (payment.payment_provider === "paylabs") paylabsSuccessfullyBackfilled++;
        else if (payment.payment_provider === "mandiri_direct") mandiriDirectConfidentlyIdentified++;
        else qrisUnknown++;
        continue;
      }

      const proofTradeNo = payment.proof_url?.startsWith("paylabs:")
        ? payment.proof_url.slice("paylabs:".length).trim()
        : "";
      const candidates = paylabs.filter((transaction) =>
        transaction.booking_id === payment.booking_id &&
        (
          (proofTradeNo && transaction.paylabs_trade_no === proofTradeNo) ||
          (payment.merchant_trade_no && transaction.merchant_trade_no === payment.merchant_trade_no)
        )
      );

      if (candidates.length !== 1) {
        if (candidates.length > 1) ambiguousRows++;
        else qrisUnknown++;
        continue;
      }

      const transaction = candidates[0]!;
      const reference = providerReference(transaction);
      if (apply) {
        await client.query(
          `UPDATE sport_center.sport_payments
              SET payment_provider = 'paylabs',
                  provider_reference = $2,
                  merchant_trade_no = $3,
                  provider_trade_no = $4,
                  paid_at = COALESCE(paid_at, confirmed_at, $5),
                  updated_at = NOW()
            WHERE id = $1`,
          [
            payment.id,
            reference,
            transaction.merchant_trade_no,
            transaction.paylabs_trade_no,
            transaction.updated_at,
          ],
        );
      }
      paylabsSuccessfullyBackfilled++;
    }

    console.log(JSON.stringify({
      apply,
      paylabsSuccessfullyBackfilled,
      mandiriDirectConfidentlyIdentified,
      qrisUnknown,
      ambiguousRows,
      note: "QRIS historical tanpa bukti deterministik tidak dipaksa menjadi mandiri_direct.",
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});