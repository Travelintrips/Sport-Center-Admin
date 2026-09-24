import pg from "pg";
import { loadSecretsFromGSM } from "../../artifacts/api-server/src/lib/secretLoader.js";

const { Client } = pg;
const APPLY = process.argv.includes("--apply");
const GROUP_REF = "CART-MUCRMY0O-R29H";
const EXPECTED_CHILDREN = 19;
const EXPECTED_CHILD_TOTAL = 6_800_000;
const EXPECTED_CHILD_GROSS = 7_548_000;
const INVOICE_GROSS = 7_500_000;
const INVOICE_DPP = 6_756_757;
const INVOICE_PPN = 743_243;
const PPH_RATE = 10;
const INVOICE_PPH = 675_676;
const INVOICE_NET = 6_824_324;

async function main() {
  const runtimeEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (runtimeEnv !== "production" && runtimeEnv !== "prod") {
    throw new Error("Refusing to run: APP_ENV/NODE_ENV must select production.");
  }
  if (!APPLY) {
    throw new Error("Refusing to modify production without --apply.");
  }

  if (!process.env.SUPABASE_DATABASE_URL) {
    const loaded = await loadSecretsFromGSM();
    if (loaded.fatal.length > 0) {
      throw new Error(`Production secrets could not be loaded: ${loaded.fatal.join("; ")}`);
    }
  }
  const rawUrl = process.env.SUPABASE_DATABASE_URL;
  if (!rawUrl) throw new Error("SUPABASE_DATABASE_URL was not loaded.");

  const connectionString = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    query_timeout: 60_000,
  });

  await client.connect();
  try {
    const identity = await client.query(
      "SELECT current_database() AS database_name, current_user AS database_user, inet_server_port() AS server_port",
    );
    console.log(JSON.stringify({ mode: "APPLY", target: GROUP_REF, identity: identity.rows[0] }));

    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        "sport-center-avia-group-invoice-correction",
      ]);

      await client.query(`
        ALTER TABLE sport_center.booking_groups
          ADD COLUMN IF NOT EXISTS total_payment_override NUMERIC(12,2),
          ADD COLUMN IF NOT EXISTS ppn_rate NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS dpp NUMERIC(14,2),
          ADD COLUMN IF NOT EXISTS ppn_amount NUMERIC(12,2),
          ADD COLUMN IF NOT EXISTS ppn_treatment TEXT,
          ADD COLUMN IF NOT EXISTS pph_rate NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS pph_amount NUMERIC(14,2),
          ADD COLUMN IF NOT EXISTS net_payment NUMERIC(14,2)
      `);

      const lockedGroup = await client.query(
        "SELECT id FROM sport_center.booking_groups WHERE group_ref = $1 FOR UPDATE",
        [GROUP_REF],
      );
      if (lockedGroup.rowCount !== 1) {
        const diagnostic = await client.query(`
          SELECT
            (SELECT COUNT(*)::text FROM sport_center.booking_groups) AS group_count,
            (SELECT COUNT(*)::text FROM sport_center.sport_bookings) AS booking_count,
            (SELECT COUNT(*)::text FROM sport_center.sport_payments) AS payment_count
        `);
        const recent = await client.query(`
          SELECT group_ref, total_payment::text
          FROM sport_center.booking_groups
          ORDER BY updated_at DESC NULLS LAST
          LIMIT 5
        `);
        throw new Error(
          `Expected exactly one group row for ${GROUP_REF}, got ${lockedGroup.rowCount ?? 0}. ` +
          `Database snapshot: ${JSON.stringify(diagnostic.rows[0])}; ` +
          `recent groups: ${JSON.stringify(recent.rows)}`,
        );
      }

      const before = await client.query<{
        id: number;
        total_payment: string;
        total_payment_override: string | null;
        dpp: string | null;
        ppn_amount: string | null;
        pph_amount: string | null;
        net_payment: string | null;
        child_count: string;
        child_total: string;
        child_gross: string;
        payment_count: string;
      }>(
        `
          SELECT
            g.id,
            g.total_payment::text,
            g.total_payment_override::text,
            g.dpp::text,
            g.ppn_amount::text,
            g.pph_amount::text,
            g.net_payment::text,
            COUNT(b.id)::text AS child_count,
            COALESCE(SUM(b.total_price), 0)::text AS child_total,
            COALESCE(SUM(COALESCE(b.grand_total, b.total_price)), 0)::text AS child_gross,
            (
              SELECT COUNT(*)::text
              FROM sport_center.sport_payments p
              JOIN sport_center.sport_bookings pb ON pb.id = p.booking_id
              WHERE pb.group_ref = g.group_ref
            ) AS payment_count
          FROM sport_center.booking_groups g
          LEFT JOIN sport_center.sport_bookings b ON b.group_ref = g.group_ref
          WHERE g.group_ref = $1
          GROUP BY g.id
        `,
        [GROUP_REF],
      );

      const row = before.rows[0];
      if (!row) throw new Error(`Group ${GROUP_REF} not found.`);
      const assertEqual = (label: string, actual: number, expected: number) => {
        if (actual !== expected) {
          throw new Error(`${label} mismatch: expected ${expected}, got ${actual}.`);
        }
      };
      assertEqual("child count", Number(row.child_count), EXPECTED_CHILDREN);
      assertEqual("child total_price sum", Number(row.child_total), EXPECTED_CHILD_TOTAL);
      assertEqual("child gross sum", Number(row.child_gross), EXPECTED_CHILD_GROSS);
      assertEqual("payment count", Number(row.payment_count), 0);
      assertEqual("current group total", Number(row.total_payment), EXPECTED_CHILD_GROSS);

      await client.query(
        `
          UPDATE sport_center.booking_groups
          SET
            total_payment = $2,
            total_payment_override = $2,
            ppn_rate = $3,
            dpp = $4,
            ppn_amount = $5,
            ppn_treatment = 'inclusive',
            pph_rate = $6,
            pph_amount = $7,
            net_payment = $8,
            notes = CASE
              WHEN notes IS NULL OR notes = '' THEN $9
              ELSE notes || E'\\n' || $9
            END,
            updated_at = NOW()
          WHERE group_ref = $1
        `,
        [
          GROUP_REF,
          INVOICE_GROSS,
          11,
          INVOICE_DPP,
          INVOICE_PPN,
          PPH_RATE,
          INVOICE_PPH,
          INVOICE_NET,
          "Koreksi invoice AVIA: bruto Rp7.500.000, PPN inklusif, PPh 10% Rp675.676, net Rp6.824.324.",
        ],
      );

      const after = await client.query<{
        total_payment: string;
        total_payment_override: string | null;
        dpp: string | null;
        ppn_amount: string | null;
        pph_rate: string | null;
        pph_amount: string | null;
        net_payment: string | null;
      }>(
        `
          SELECT total_payment::text, total_payment_override::text, dpp::text,
                 ppn_amount::text, pph_rate::text, pph_amount::text, net_payment::text
          FROM sport_center.booking_groups
          WHERE group_ref = $1
        `,
        [GROUP_REF],
      );
      const updated = after.rows[0];
      if (!updated) throw new Error("Corrected group disappeared before commit.");
      assertEqual("corrected total_payment", Number(updated.total_payment), INVOICE_GROSS);
      assertEqual("corrected total_payment_override", Number(updated.total_payment_override), INVOICE_GROSS);
      assertEqual("corrected DPP", Number(updated.dpp), INVOICE_DPP);
      assertEqual("corrected PPN", Number(updated.ppn_amount), INVOICE_PPN);
      assertEqual("corrected PPh rate", Number(updated.pph_rate), PPH_RATE);
      assertEqual("corrected PPh", Number(updated.pph_amount), INVOICE_PPH);
      assertEqual("corrected net", Number(updated.net_payment), INVOICE_NET);

      await client.query("COMMIT");
      console.log(JSON.stringify({
        groupRef: GROUP_REF,
        childRowsUnchanged: true,
        gross: INVOICE_GROSS,
        dpp: INVOICE_DPP,
        ppn: INVOICE_PPN,
        pph: INVOICE_PPH,
        net: INVOICE_NET,
      }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});