import pg from "pg";

const { Client } = pg;
const EFFECTIVE_FROM = "2026-08-09";
const COMPANY_ID = 1;
const FACILITY_IDS = [1, 7] as const;
const APPROVAL_SOURCE = "manual_business_approval";
const APPROVAL_NOTES =
  "Business owner confirmed Facility 1 and Facility 7 belong to CST / public.companies.id=1";

function assertDevelopmentOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("COMPANY_MODEL_MIGRATION_BLOCKED: NODE_ENV=production");
  }
  if (process.env.ALLOW_DEV_ON_PROD_DB === "true") {
    throw new Error("COMPANY_MODEL_MIGRATION_BLOCKED: ALLOW_DEV_ON_PROD_DB=true");
  }
  if (!process.env.SUPABASE_DATABASE_URL_DEV) {
    throw new Error("COMPANY_MODEL_MIGRATION_BLOCKED: SUPABASE_DATABASE_URL_DEV is required");
  }
}

function developmentUrl() {
  const raw = process.env.SUPABASE_DATABASE_URL_DEV!;
  const parsed = new URL(raw);
  if (!parsed.hostname.endsWith(".supabase.com")) {
    throw new Error(`COMPANY_MODEL_MIGRATION_BLOCKED: unexpected development host ${parsed.hostname}`);
  }
  return raw.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
}

async function main() {
  assertDevelopmentOnly();
  const client = new Client({
    connectionString: developmentUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const fingerprint = await client.query<{
      database_name: string;
      current_schema: string;
    }>(`SELECT current_database() AS database_name, current_schema() AS current_schema`);
    console.log("ENVIRONMENT", {
      nodeEnv: process.env.NODE_ENV ?? "unset",
      appEnv: process.env.APP_ENV ?? "unset",
      database: fingerprint.rows[0]?.database_name,
      schema: fingerprint.rows[0]?.current_schema,
      target: "development",
    });

    const required = await client.query<{
      company_id: number;
      company_code: string;
      company_name: string;
      company_active: boolean;
      admin_id: number;
      admin_role: string;
      admin_account_type: string;
      mapping_count: string;
    }>(`
      SELECT c.id AS company_id,
             c.code AS company_code,
             COALESCE(c.name, c.company_name, c.code) AS company_name,
             c.is_active AS company_active,
             u.id AS admin_id,
             u.role AS admin_role,
             u.account_type AS admin_account_type,
             (SELECT COUNT(*)::text
                FROM sport_center.facility_company_mappings) AS mapping_count
        FROM public.companies c
        JOIN sport_center.users u ON u.id = 1
       WHERE c.id = 1
    `);
    const invariant = required.rows[0];
    if (!invariant) {
      throw new Error("COMPANY_MODEL_MIGRATION_BLOCKED: required CST company or Admin user is missing");
    }
    if (
      invariant.company_code !== "CST" ||
      invariant.company_name !== "PT Cahaya Sejati Teknologi" ||
      invariant.company_active !== true
    ) {
      throw new Error("COMPANY_MODEL_MIGRATION_BLOCKED: public.companies.id=1 invariant failed");
    }
    if (
      invariant.admin_id !== 1 ||
      invariant.admin_role !== "admin" ||
      invariant.admin_account_type !== "personal"
    ) {
      throw new Error("COMPANY_MODEL_MIGRATION_BLOCKED: sport_center.users.id=1 auth invariant failed");
    }
    console.log("INVARIANTS", {
      company: "1 / CST / PT Cahaya Sejati Teknologi / active",
      admin: "1 / admin / personal",
      existingMappings: Number(invariant.mapping_count),
    });

    await client.query("BEGIN");
    await client.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

    const fk = await client.query<{
      conname: string;
      schema_name: string;
      table_name: string;
    }>(`
      SELECT con.conname,
             ns.nspname AS schema_name,
             target.relname AS table_name
        FROM pg_constraint con
        JOIN pg_class local_table ON local_table.oid = con.conrelid
        JOIN pg_namespace local_ns ON local_ns.oid = local_table.relnamespace
        JOIN pg_class target ON target.oid = con.confrelid
        JOIN pg_namespace ns ON ns.oid = target.relnamespace
       WHERE con.conname = 'facility_company_mappings_company_id_fkey'
         AND local_ns.nspname = 'sport_center'
         AND local_table.relname = 'facility_company_mappings'
    `);
    const currentFk = fk.rows[0];
    const mappingCount = Number(invariant.mapping_count);
    if (mappingCount > 0 && currentFk?.schema_name === "sport_center" && currentFk.table_name === "users") {
      throw new Error("COMPANY_MODEL_MIGRATION_BLOCKED: legacy mapping rows require manual translation");
    }

    if (currentFk?.schema_name === "sport_center" && currentFk.table_name === "users") {
      await client.query(`
        ALTER TABLE sport_center.facility_company_mappings
          DROP CONSTRAINT facility_company_mappings_company_id_fkey
      `);
      await client.query(`
        ALTER TABLE sport_center.facility_company_mappings
          ADD CONSTRAINT facility_company_mappings_company_id_fkey
          FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT
      `);
      console.log("OWNERSHIP_SCHEMA", "repointed company_id FK to public.companies.id");
    } else if (currentFk?.schema_name === "public" && currentFk.table_name === "companies") {
      console.log("OWNERSHIP_SCHEMA", "already canonical");
    } else {
      throw new Error("COMPANY_MODEL_MIGRATION_BLOCKED: unexpected company_id FK target");
    }

    await client.query(`
      CREATE OR REPLACE FUNCTION sport_center.validate_facility_company_mapping_company()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM public.companies
           WHERE id = NEW.company_id
             AND is_active = true
        ) THEN
          RAISE EXCEPTION 'FACILITY_COMPANY_MAPPING_COMPANY_INVALID:%', NEW.company_id;
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS trg_validate_facility_company_mapping_company
        ON sport_center.facility_company_mappings
    `);
    await client.query(`
      CREATE TRIGGER trg_validate_facility_company_mapping_company
      BEFORE INSERT OR UPDATE OF company_id
        ON sport_center.facility_company_mappings
      FOR EACH ROW
      EXECUTE FUNCTION sport_center.validate_facility_company_mapping_company()
    `);

    for (const facilityId of FACILITY_IDS) {
      const facility = await client.query<{ name: string }>(
        `SELECT name FROM sport_center.sport_facilities WHERE id = $1`,
        [facilityId],
      );
      if (!facility.rows[0]) {
        throw new Error(`COMPANY_MODEL_MIGRATION_BLOCKED: facility ${facilityId} is missing`);
      }

      const existing = await client.query<{
        id: number;
        company_id: number;
        effective_from: string;
        effective_until: string | null;
        is_active: boolean;
      }>(
        `SELECT id, company_id, effective_from::text, effective_until::text, is_active
           FROM sport_center.facility_company_mappings
          WHERE facility_id = $1
            AND is_active = true
            AND effective_from <= $2::date
            AND (effective_until IS NULL OR effective_until >= $2::date)
          ORDER BY id`,
        [facilityId, EFFECTIVE_FROM],
      );
      if (existing.rows.length > 0) {
        const same = existing.rows.length === 1 && existing.rows[0]!.company_id === COMPANY_ID;
        if (!same) {
          throw new Error(`OWNERSHIP_CONFLICT: facility ${facilityId} has an overlapping active mapping`);
        }
        console.log("MAPPING", { facilityId, status: "ALREADY_PRESENT", mappingId: existing.rows[0]!.id });
        continue;
      }

      const inserted = await client.query<{ id: number }>(
        `INSERT INTO sport_center.facility_company_mappings
           (facility_id, company_id, effective_from, effective_until, is_active, source, notes)
         VALUES ($1, $2, $3::date, NULL, true, $4, $5)
         RETURNING id`,
        [facilityId, COMPANY_ID, EFFECTIVE_FROM, APPROVAL_SOURCE, APPROVAL_NOTES],
      );
      console.log("MAPPING", {
        facilityId,
        facilityName: facility.rows[0].name,
        companyId: COMPANY_ID,
        status: "CREATED",
        mappingId: inserted.rows[0]?.id,
      });
    }

    await client.query("COMMIT");
    console.log("PHASE_A_OWNERSHIP_MIGRATION", "COMPLETE");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});