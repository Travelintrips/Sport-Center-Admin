import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const COMPANY_ID = 1;
const CASH_JOURNAL_ID = 389;
const CASH_ACCOUNT_ID = 17;
const MEMBERSHIP_INCOME_ACCOUNT_ID = 1314;
const BOOKING_INCOME_ACCOUNT_ID = 1315;

async function getNextEntryNumber(prefix: string, year: number): Promise<string> {
  await db.execute(sql`
    INSERT INTO public.journal_sequences (journal_prefix, company_id, year, next_seq)
    VALUES (${prefix}, ${COMPANY_ID}, ${year}, 1)
    ON CONFLICT (journal_prefix, company_id, year) DO NOTHING
  `);
  const result = await db.execute(sql`
    UPDATE public.journal_sequences
    SET next_seq = next_seq + 1
    WHERE journal_prefix = ${prefix}
      AND company_id = ${COMPANY_ID}
      AND year = ${year}
    RETURNING (next_seq - 1) AS seq
  `);
  const seq = Number((result as any).rows?.[0]?.seq ?? 1);
  return `${prefix}/${year}/${String(seq).padStart(6, "0")}`;
}

export async function postMembershipAccountingEntry(
  membershipId: number,
  memberName: string,
  totalPrice: number,
  paymentDate: string,
): Promise<string | null> {
  try {
    const year = new Date(paymentDate).getFullYear();
    const entryNumber = await getNextEntryNumber("SC-MBR", year);
    const description = `Pembayaran Membership Gym: ${memberName}`;

    const entryResult = await db.execute(sql`
      INSERT INTO public.accounting_entries (
        company_id, entry_number, journal_id, date, ref, description,
        status, source, source_id, total_debit, total_credit,
        entry_status, is_locked, system_override, governance_flags,
        source_schema, source_module, source_table, created_at
      ) VALUES (
        ${COMPANY_ID},
        ${entryNumber},
        ${CASH_JOURNAL_ID},
        ${paymentDate}::date,
        ${"MBR-" + membershipId},
        ${description},
        'posted',
        'sport_center_membership',
        ${membershipId},
        ${totalPrice},
        ${totalPrice},
        'POSTED',
        false,
        false,
        '{}',
        'sport_center',
        'membership',
        'sport_memberships',
        NOW()
      ) RETURNING id
    `);

    const entryId = Number((entryResult as any).rows?.[0]?.id);
    if (!entryId) return null;

    await db.execute(sql`
      INSERT INTO public.accounting_entry_lines
        (entry_id, account_id, description, debit, credit, company_id, source_module, source_table, source_id)
      VALUES
        (${entryId}, ${CASH_ACCOUNT_ID},            ${"Kas masuk: " + description}, ${totalPrice}, 0,            ${COMPANY_ID}, 'membership', 'sport_memberships', ${membershipId}),
        (${entryId}, ${MEMBERSHIP_INCOME_ACCOUNT_ID},${"Pendapatan: " + description}, 0,           ${totalPrice}, ${COMPANY_ID}, 'membership', 'sport_memberships', ${membershipId})
    `);

    return entryNumber;
  } catch (err) {
    console.error("[publicAccounting] postMembershipAccountingEntry error:", err);
    return null;
  }
}

export async function reverseMembershipAccountingEntry(
  membershipId: number,
  memberName: string,
  totalPrice: number,
  reason: string,
  reverseDate: string,
): Promise<string | null> {
  try {
    const year = new Date(reverseDate).getFullYear();
    const entryNumber = await getNextEntryNumber("SC-MBR", year);
    const description = `REVERSAL — Membership Gym: ${memberName} — ${reason}`;

    const original = await db.execute(sql`
      SELECT id FROM public.accounting_entries
      WHERE source = 'sport_center_membership' AND source_id = ${membershipId}
        AND entry_status = 'POSTED'
      ORDER BY id DESC LIMIT 1
    `);
    const sourceId = Number((original as any).rows?.[0]?.id ?? membershipId);

    const entryResult = await db.execute(sql`
      INSERT INTO public.accounting_entries (
        company_id, entry_number, journal_id, date, ref, description,
        status, source, source_id, total_debit, total_credit,
        entry_status, is_locked, system_override, governance_flags,
        source_schema, source_module, source_table, created_at
      ) VALUES (
        ${COMPANY_ID},
        ${entryNumber},
        ${CASH_JOURNAL_ID},
        ${reverseDate}::date,
        ${"VOID-MBR-" + membershipId},
        ${description},
        'posted',
        'reversal',
        ${sourceId},
        ${totalPrice},
        ${totalPrice},
        'POSTED',
        false,
        false,
        '{}',
        'sport_center',
        'membership',
        'sport_memberships',
        NOW()
      ) RETURNING id
    `);

    const entryId = Number((entryResult as any).rows?.[0]?.id);
    if (!entryId) return null;

    await db.execute(sql`
      INSERT INTO public.accounting_entry_lines
        (entry_id, account_id, description, debit, credit, company_id, source_module, source_table, source_id)
      VALUES
        (${entryId}, ${MEMBERSHIP_INCOME_ACCOUNT_ID}, ${"Reversal: " + description}, ${totalPrice}, 0,            ${COMPANY_ID}, 'membership', 'sport_memberships', ${membershipId}),
        (${entryId}, ${CASH_ACCOUNT_ID},              ${"Reversal: " + description}, 0,             ${totalPrice}, ${COMPANY_ID}, 'membership', 'sport_memberships', ${membershipId})
    `);

    return entryNumber;
  } catch (err) {
    console.error("[publicAccounting] reverseMembershipAccountingEntry error:", err);
    return null;
  }
}
