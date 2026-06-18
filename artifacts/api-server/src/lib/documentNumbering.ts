import { db } from "@workspace/db";
import { documentNumberSequencesTable } from "@workspace/db";
import { and, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import { pgSchema, pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

const scSchema = pgSchema("sport_center");

const documentIssuedNumbersTable = scSchema.table("document_issued_numbers", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  documentType: text("document_type").notNull(),
  companyId: integer("company_id"),
  documentNumber: text("document_number").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow(),
});

function deriveCompanyCode(companyName: string | null | undefined): string {
  if (!companyName) return "SC";
  const words = companyName.trim().toUpperCase().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 5);
  return words.map((w) => w[0]).join("").slice(0, 6);
}

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

  // Idempotent: check if a number was already issued for this entity
  try {
    const existingIssued = await db
      .select()
      .from(documentIssuedNumbersTable)
      .where(
        and(
          eq(documentIssuedNumbersTable.entityType, entityType),
          eq(documentIssuedNumbersTable.entityId, entityId),
          eq(documentIssuedNumbersTable.documentType, documentType),
          companyId != null
            ? eq(documentIssuedNumbersTable.companyId, companyId)
            : isNull(documentIssuedNumbersTable.companyId)
        )
      )
      .limit(1);

    if (existingIssued.length > 0) {
      return existingIssued[0].documentNumber;
    }
  } catch {
    // Table may not exist yet (before migration) — fall through to generate
  }

  // Get or increment sequence
  const existingSeq = await db
    .select()
    .from(documentNumberSequencesTable)
    .where(
      and(
        companyId != null
          ? eq(documentNumberSequencesTable.companyId, companyId)
          : isNull(documentNumberSequencesTable.companyId),
        eq(documentNumberSequencesTable.documentType, documentType),
        eq(documentNumberSequencesTable.year, year)
      )
    )
    .limit(1);

  let seq: number;
  if (existingSeq.length > 0) {
    const newSeq = (existingSeq[0].currentSeq ?? 0) + 1;
    await db
      .update(documentNumberSequencesTable)
      .set({ currentSeq: newSeq })
      .where(eq(documentNumberSequencesTable.id, existingSeq[0].id));
    seq = newSeq;
  } else {
    const [inserted] = await db
      .insert(documentNumberSequencesTable)
      .values({
        companyId: companyId ?? null,
        documentType,
        year,
        currentSeq: 1,
      })
      .returning();
    seq = inserted.currentSeq;
  }

  const seqStr = String(seq).padStart(4, "0");
  const docNumber = `${prefix}-${code}-${year}-${seqStr}`;

  // Store the assignment for idempotency (best-effort)
  try {
    await db.execute(drizzleSql`
      INSERT INTO sport_center.document_issued_numbers
        (entity_type, entity_id, document_type, company_id, document_number)
      VALUES
        (${entityType}, ${entityId}, ${documentType}, ${companyId ?? null}, ${docNumber})
      ON CONFLICT (entity_type, entity_id, document_type, company_id) DO NOTHING
    `);
  } catch {
    // Non-fatal: table may not exist yet before migration
  }

  return docNumber;
}

export { deriveCompanyCode };
