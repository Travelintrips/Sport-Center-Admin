import pg from "pg";

if (process.env.NODE_ENV === "production" || process.argv.includes("--prod")) {
  throw new Error("CF-SC-5 is development-only; refusing to run in production.");
}

const connectionString = process.env.SUPABASE_DATABASE_URL_DEV;
if (!connectionString) {
  throw new Error("SUPABASE_DATABASE_URL_DEV is required.");
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE sport_center.payment_settlement_batches
        ADD COLUMN IF NOT EXISTS canonical_bank_mutation_id integer
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'payment_settlement_batches_canonical_bank_mutation_fk'
             AND conrelid = 'sport_center.payment_settlement_batches'::regclass
        ) THEN
          ALTER TABLE sport_center.payment_settlement_batches
            ADD CONSTRAINT payment_settlement_batches_canonical_bank_mutation_fk
            FOREIGN KEY (canonical_bank_mutation_id)
            REFERENCES public.bank_mutations(id);
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS payment_settlement_batches_canonical_mutation_idx
        ON sport_center.payment_settlement_batches(canonical_bank_mutation_id)
        WHERE canonical_bank_mutation_id IS NOT NULL
    `);

    // Narrowly preserve all legacy projection behavior while excluding the
    // central-owned mutation identity.
    await client.query(`
      CREATE OR REPLACE FUNCTION sport_center.project_public_bank_mutation_to_canonical_trigger()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO 'pg_catalog', 'sport_center', 'public'
      AS $function$
      BEGIN
        IF COALESCE(NEW.source_app, '') = 'sport_center'
           AND COALESCE(NEW.source_module, '') = 'central_finance' THEN
          RETURN NEW;
        END IF;
        PERFORM sport_center.project_public_bank_mutation_to_canonical(NEW.id);
        RETURN NEW;
      END;
      $function$
    `);

    // The canonical batch function remains additive and keeps the legacy FK
    // untouched. For a single-payment central batch, link the public mutation
    // by canonical identity; grouped batches remain legacy-compatible.
    const functionResult = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'sport_center'
         AND p.proname = 'create_payment_settlement_batch'
         AND pg_get_function_identity_arguments(p.oid) =
             'p_settlement_reference text, p_company_id integer, p_provider_code text, p_bank_account_id text, p_settlement_date date, p_payment_ids integer[], p_actor text'
       LIMIT 1
    `);
    const currentDefinition = String(functionResult.rows[0]?.definition ?? "");
    if (!currentDefinition) {
      throw new Error("CF-SC-5 function sport_center.create_payment_settlement_batch not found.");
    }
    if (!currentDefinition.includes("canonical_bank_mutation_id")) {
      const withVariable = currentDefinition.replace(
        /(\n\s+v_item_count integer;\n)/,
        "$1      v_canonical_bank_mutation_id integer;\n",
      );
      const marker = "      SELECT sport_center.create_payment_settlement_batch_legacy(";
      const markerIndex = withVariable.indexOf(marker);
      if (markerIndex < 0) {
        throw new Error("CF-SC-5 could not locate canonical batch delegation.");
      }
      const intoMarker = "        INTO v_result;";
      const intoIndex = withVariable.indexOf(intoMarker, markerIndex);
      if (intoIndex < 0) {
        throw new Error("CF-SC-5 could not locate canonical batch result.");
      }
      const insertAt = intoIndex + intoMarker.length;
      const bridge = `

      IF cardinality(p_payment_ids) = 1 THEN
        SELECT id
          INTO v_canonical_bank_mutation_id
          FROM public.bank_mutations
         WHERE canonical_key = 'sport_center:payment:' || p_payment_ids[1]
         FOR SHARE;

        IF v_canonical_bank_mutation_id IS NULL THEN
          RAISE EXCEPTION
            'CANONICAL_BANK_MUTATION_REQUIRED: payment=%',
            p_payment_ids[1];
        END IF;

        UPDATE sport_center.payment_settlement_batches
           SET canonical_bank_mutation_id = v_canonical_bank_mutation_id,
               updated_at = now()
         WHERE id = v_result;
      END IF;`;
      await client.query(withVariable.slice(0, insertAt) + bridge + withVariable.slice(insertAt));
    }

    await client.query("COMMIT");
    console.log("CF-SC-5 development additive rewire applied.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

try {
  await main();
} finally {
  await pool.end();
}