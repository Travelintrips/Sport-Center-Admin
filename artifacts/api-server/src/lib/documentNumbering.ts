import { db } from "@workspace/db";
import { documentNumberSequencesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

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
}): Promise<string> {
  const year = new Date().getFullYear();
  const { prefix, companyId, companyCode, documentType } = params;
  const code = companyCode || "SC";

  const existing = await db
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
  if (existing.length > 0) {
    const newSeq = (existing[0].currentSeq ?? 0) + 1;
    await db
      .update(documentNumberSequencesTable)
      .set({ currentSeq: newSeq })
      .where(eq(documentNumberSequencesTable.id, existing[0].id));
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
  return `${prefix}-${code}-${year}-${seqStr}`;
}

export { deriveCompanyCode };
