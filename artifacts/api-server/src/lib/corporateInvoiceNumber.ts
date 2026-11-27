/**
 * Canonical, immutable corporate invoice numbering across group, single-booking,
 * and monthly corporate documents. Each logical document receives one number.
 *
 * The database identity sequence is GLOBAL to all companies and document types.
 * Numbers intentionally need not be gapless (rollback/concurrent first requests).
 */
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

type SqlExecutor = (statement: SQL) => Promise<{ rows: any[] }>;
const defaultExecutor: SqlExecutor = statement => db.execute(statement);

export type CorporateInvoiceDocumentType = "group" | "booking" | "monthly";
export type CorporateInvoiceAllocation = { invoiceNumber: string; issuedOn: string; serialNo: number };

const ROMAN_MONTHS = [
  "I", "II", "III", "IV", "V", "VI",
  "VII", "VIII", "IX", "X", "XI", "XII",
] as const;

export function formatCorporateInvoiceNumber(serialNo: number, issuedOn: string): string {
  if (!Number.isSafeInteger(serialNo) || serialNo < 1) throw Error("CORPORATE_INVOICE_SERIAL_INVALID");
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(issuedOn)) {
    throw Error("CORPORATE_INVOICE_DATE_INVALID");
  }
  const month = Number(issuedOn.slice(5, 7));
  return `${String(serialNo).padStart(3, "0")}/INVOICE-CST/${ROMAN_MONTHS[month - 1]}/${issuedOn.slice(0, 4)}`;
}

function allocationFromRow(row: { serial_no: string | number; issued_on: string }): CorporateInvoiceAllocation {
  const serialNo = Number(row.serial_no);
  const issuedOn = String(row.issued_on).slice(0, 10);
  return { serialNo, issuedOn, invoiceNumber: formatCorporateInvoiceNumber(serialNo, issuedOn) };
}

/** Read-only check for an already issued number. Never creates a new allocation. */
export async function findCorporateInvoiceNumber(
  documentType: CorporateInvoiceDocumentType,
  documentKey: string,
  execute: SqlExecutor = defaultExecutor,
): Promise<CorporateInvoiceAllocation | null> {
  const result = await execute(sql`
    SELECT serial_no, issued_on::text
      FROM sport_center.corporate_invoice_number_registry
     WHERE document_type = ${documentType} AND document_key = ${documentKey}
     LIMIT 1
  `);
  return result.rows[0] ? allocationFromRow(result.rows[0] as any) : null;
}

/** Atomically reserve a unique serial; subsequent reads reuse the existing serial and month. */
export async function allocateCorporateInvoiceNumber(
  documentType: CorporateInvoiceDocumentType,
  documentKey: string,
  execute: SqlExecutor = defaultExecutor,
): Promise<CorporateInvoiceAllocation> {
  if (!documentKey.trim()) throw Error("CORPORATE_INVOICE_DOCUMENT_KEY_REQUIRED");
  // Avoid burning the global sequence on every PDF preview/read.
  const alreadyIssued = await findCorporateInvoiceNumber(documentType, documentKey, execute);
  if (alreadyIssued) return alreadyIssued;
  await execute(sql`
    INSERT INTO sport_center.corporate_invoice_number_registry
      (document_type, document_key, issued_on)
    VALUES (${documentType}, ${documentKey}, (NOW() AT TIME ZONE 'Asia/Jakarta')::date)
    ON CONFLICT (document_type, document_key) DO NOTHING
  `);
  const existing = await findCorporateInvoiceNumber(documentType, documentKey, execute);
  if (!existing) throw Error("CORPORATE_INVOICE_ALLOCATION_NOT_FOUND");
  return existing;
}
