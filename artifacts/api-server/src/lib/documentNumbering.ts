import { db } from "@workspace/db";
import { documentNumberSequencesTable } from "@workspace/db";
import { and, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import { pgSchema } from "drizzle-orm/pg-core";

const scSchema = pgSchema("sport_center");

export function deriveCompanyCode(companyName: string | null | undefined): string {
  if (!companyName) return "SC";
  const words = companyName.trim().toUpperCase().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 5);
  return words.map((w) => w[0]).join("").slice(0, 6);
}

/**
 * Idempotently generate and persist a document number for a given entity.
 * Uses atomic SQL (INSERT ... ON CONFLICT DO UPDATE RETURNING) so concurrent
 * calls never produce duplicate sequence values.
 */
export async function generateDocumentNumber(params: {
  prefix: string;
  companyId: number | null;
  companyCode?: string;
  documentType: string;
  entityType: string;
  entityId: number;
}): Promise<string> {
  const year = new Date().getFullYear();
  const { prefix, companyId, companyCode, documentType, entityType, entityId } = params;
  const code = companyCode || "SC";

  // Use sentinel value 0 for system-default (NULL company_id).
  // This ensures ON CONFLICT works correctly — NULL != NULL in Postgres UNIQUE constraints.
  const companyIdSentinel = companyId ?? 0;

  // Idempotent: check if a number was already issued for this entity
  try {
    const existing = await db.execute(drizzleSql`
      SELECT document_number FROM sport_center.document_issued_numbers
      WHERE entity_type = ${entityType}
        AND entity_id  = ${entityId}
        AND document_type = ${documentType}
        AND company_id = ${companyIdSentinel}
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      return (existing.rows[0] as any).document_number as string;
    }
  } catch {
    // Table may not exist yet (before migration) — fall through
  }

  // Atomic sequence increment using INSERT … ON CONFLICT … DO UPDATE RETURNING.
  // company_id uses sentinel 0 for system-default so ON CONFLICT triggers correctly.
  const seqResult = await db.execute(drizzleSql`
    INSERT INTO sport_center.document_number_sequences
      (company_id, document_type, year, current_seq)
    VALUES
      (${companyIdSentinel}, ${documentType}, ${year}, 1)
    ON CONFLICT (company_id, document_type, year)
    DO UPDATE SET current_seq = sport_center.document_number_sequences.current_seq + 1
    RETURNING current_seq
  `);

  const seq: number = (seqResult.rows[0] as any).current_seq;
  const seqStr = String(seq).padStart(4, "0");
  const docNumber = `${prefix}-${code}-${year}-${seqStr}`;

  // Persist assignment for idempotency (best-effort; non-fatal if table missing)
  try {
    await db.execute(drizzleSql`
      INSERT INTO sport_center.document_issued_numbers
        (entity_type, entity_id, document_type, company_id, document_number)
      VALUES
        (${entityType}, ${entityId}, ${documentType}, ${companyIdSentinel}, ${docNumber})
      ON CONFLICT (entity_type, entity_id, document_type, company_id) DO NOTHING
    `);
  } catch {
    // Non-fatal: table may not exist yet
  }

  return docNumber;
}
