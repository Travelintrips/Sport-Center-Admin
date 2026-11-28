/**
 * Corporate receipt numbers are a separate, global CST series.
 * The booked GRP/CART/SC reference is never overwritten.
 * Reuse existing sport_center.document_* tables instead of building a new system.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type CorporateReceiptIdentity = {
  receiptNumber: string;
  issuedAt: string;
  bookingReference: string;
};

/** For calendar month of original issuance (Jakarta), NEVER today's month on reprint. */
export function formatCorporateReceiptNumber(serial: number, issuedDateWib: string): string {
  const month = Number(issuedDateWib.slice(5,7));
  const year = Number(issuedDateWib.slice(0,4));
  if (!Number.isSafeInteger(serial) || serial < 1 ||
      !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(issuedDateWib) ||
      !Number.isInteger(month) || !Number.isInteger(year)) {
    throw Error("CORPORATE_RECEIPT_FORMAT_INVALID");
  }
  const romans = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
  return `${String(serial).padStart(3,"0")}/KWITANSI-CST/${romans[month-1]}/${year}`;
}

/**
 * Atomic idempotent assignment for one Corporate booking/group. Global
 * sequence year=0 and company_id=0: it never resets for another company.
 * Requires the documented one-time seed migration before release.
 */
export async function issueCorporateReceiptNumber(
  entityType: "booking_group" | "booking",
  entityId: number,
  bookingReference: string,
): Promise<CorporateReceiptIdentity> {
  if (!Number.isSafeInteger(entityId) || entityId <= 0 || !bookingReference.trim()) {
    throw Error("CORPORATE_RECEIPT_IDENTITY_INVALID");
  }
  return db.transaction(async tx => {
    // Exactly one allocator at a time, INCLUDING reprints and first issuance.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('CST_CORPORATE_RECEIPT_GLOBAL'))`);
    const existing = await tx.execute(sql`
      SELECT document_number,issued_at
      FROM sport_center.document_issued_numbers
      WHERE entity_type=${entityType} AND entity_id=${entityId}
        AND document_type='kwitansi_corporate' AND company_id=0 LIMIT 1
    `);
    if (existing.rows.length) {
      const row = existing.rows[0] as {document_number:string;issued_at:Date|string};
      return {receiptNumber:row.document_number,issuedAt:new Date(row.issued_at).toISOString(),bookingReference};
    }
    const issued = await tx.execute(sql`
      SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS day
    `);
    const issuedDateWib = String((issued.rows[0] as any).day);
    const sequence = await tx.execute(sql`
      UPDATE sport_center.document_number_sequences
      SET current_seq=current_seq+1
      WHERE company_id=0 AND document_type='kwitansi_corporate' AND year=0
      RETURNING current_seq
    `);
    if (sequence.rows.length !== 1) throw Error("CORPORATE_RECEIPT_SEQUENCE_NOT_INITIALIZED");
    const serial=Number((sequence.rows[0] as any).current_seq);
    const receiptNumber=formatCorporateReceiptNumber(serial,issuedDateWib);
    const result=await tx.execute(sql`
      INSERT INTO sport_center.document_issued_numbers
        (entity_type,entity_id,document_type,company_id,document_number)
      VALUES (${entityType},${entityId},'kwitansi_corporate',0,${receiptNumber})
      RETURNING issued_at
    `);
    return {
      receiptNumber,issuedAt:new Date((result.rows[0] as any).issued_at).toISOString(),
      bookingReference,
    };
  });
}
