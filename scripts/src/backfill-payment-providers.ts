import pg from "pg";

const { Client } = pg;
const isProd = process.argv.includes("--prod");
const apply = process.argv.includes("--apply");
const rawUrl = isProd
  ? process.env.SUPABASE_DATABASE_URL
  : process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL;

if (!rawUrl) {
  throw new Error(`Missing ${isProd ? "SUPABASE_DATABASE_URL" : "SUPABASE_DATABASE_URL_DEV"}`);
}

const client = new Client({
  connectionString: rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432"),
  ssl: { rejectUnauthorized: false },
});

type PaymentRow = {
  id: number;
  payment_method: string | null;
  payment_provider: string | null;
  proof_url: string | null;
  merchant_trade_no: string | null;
  provider_trade_no: string | null;
  provider_reference: string | null;
};

type PaylabsRow = {
  booking_id: number;
  merchant_trade_no: string;
  paylabs_trade_no: string | null;
  paid_at: Date | null;
  status: string;
};

const report = {
  paylabsSuccessfullyBackfilled: 0,
  mandiriDirectConfidentlyIdentified: 0,
  qrisUnknown: 0,
  ambiguousRows: 0,
};

try {
  await client.connect();
  await client.query("BEGIN");

  const payments = (await client.query<PaymentRow>(`
    SELECT id, payment_method, payment_provider, proof_url, merchant_trade_no,
           provider_trade_no, provider_reference
      FROM sport_center.sport_payments
     WHERE UPPER(COALESCE(payment_method, '')) = 'QRIS'
     ORDER BY id
  `)).rows;

  const paylabs = (await client.query<PaylabsRow>(`
    SELECT booking_id, merchant_trade_no, paylabs_trade_no, paid_at, status
      FROM sport_center.paylabs_transactions
     WHERE UPPER(status) = 'SUCCESS'
  `)).rows;

  for (const payment of payments) {
    if (payment.payment_provider === "mandiri_direct") {
      report.mandiriDirectConfidentlyIdentified++;
      continue;
    }

    const candidates = paylabs.filter((tx) =>
      payment.merchant_trade_no === tx.merchant_trade_no ||
      (tx.paylabs_trade_no &&
        payment.proof_url === `paylabs:${tx.paylabs_trade_no}`),
    );

    if (candidates.length > 1) {
      report.ambiguousRows++;
      continue;
    }

    if (candidates.length === 1) {
      const tx = candidates[0];
      if (apply) {
        await client.query(`
          UPDATE sport_center.sport_payments
             SET payment_provider = 'paylabs',
                 provider_reference = COALESCE(provider_reference, $2),
                 merchant_trade_no = COALESCE(merchant_trade_no, $3),
                 provider_trade_no = COALESCE(provider_trade_no, $4),
                 paid_at = COALESCE(paid_at, $5)
           WHERE id = $1
        `, [
          payment.id,
          tx.paylabs_trade_no ?? tx.merchant_trade_no,
          tx.merchant_trade_no,
          tx.paylabs_trade_no,
          tx.paid_at,
        ]);
      }
      report.paylabsSuccessfullyBackfilled++;
      continue;
    }

    if (payment.payment_provider === "unknown" || !payment.payment_provider) {
      report.qrisUnknown++;
    }
  }

  if (apply) {
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry_run",
    environment: isProd ? "production" : "development",
    ...report,
  }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}