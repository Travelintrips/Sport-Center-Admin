import { db, bookingGroupsTable, bookingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Keep a group's effective gross total in sync with its sessions unless the
 * group has an explicit invoice total override. The override is intentionally
 * stored separately from totalPayment so later session edits cannot erase an
 * agreed invoice amount.
 */
export async function syncBookingGroupTotal(groupRef: string): Promise<number | null> {
  const [group] = await db
    .select({
      totalPaymentOverride: bookingGroupsTable.totalPaymentOverride,
    })
    .from(bookingGroupsTable)
    .where(eq(bookingGroupsTable.groupRef, groupRef))
    .limit(1);

  if (!group) return null;

  const rows = await db
    .select({
      totalPrice: bookingsTable.totalPrice,
      grandTotal: bookingsTable.grandTotal,
      ppnRate: bookingsTable.ppnRate,
      ppnAmount: bookingsTable.ppnAmount,
      ppnTreatment: bookingsTable.ppnTreatment,
      pphRate: bookingsTable.pphRate,
      pphAmount: bookingsTable.pphAmount,
    })
    .from(bookingsTable)
    .where(eq(bookingsTable.groupRef, groupRef));

  const total = Math.max(
    0,
    Math.round(
      group.totalPaymentOverride != null
        ? Number(group.totalPaymentOverride)
        : rows.reduce(
            // totalPrice is the canonical PPN-inclusive selling price. Some
            // legacy rows still have grandTotal = totalPrice + ppnAmount.
            (sum, row) => sum + Number(row.totalPrice ?? row.grandTotal ?? 0),
            0,
          ),
    ),
  );

  const hasPpn = rows.some(
    (row) =>
      Number(row.ppnAmount ?? 0) > 0 ||
      Number(row.ppnRate ?? 0) > 0 ||
      row.ppnTreatment === "inclusive",
  );
  const ppnRates = [...new Set(
    rows.map((row) => Math.max(0, Number(row.ppnRate ?? 0))).filter((rate) => rate > 0),
  )];
  const ppnRate = hasPpn ? (ppnRates.length === 1 ? ppnRates[0] : 11) : 0;
  const dpp = hasPpn ? Math.round(total / 1.11) : total;
  const ppnAmount = hasPpn ? Math.max(0, total - dpp) : 0;

  const pphRates = [...new Set(
    rows.map((row) => Math.max(0, Number(row.pphRate ?? 0))).filter((rate) => rate > 0),
  )];
  const hasStoredPph = rows.some((row) => Number(row.pphAmount ?? 0) > 0);
  const pphRate = pphRates.length === 1 ? pphRates[0] : hasStoredPph ? 10 : 0;
  const pphAmount = pphRate > 0 ? Math.round(dpp * pphRate / 100) : 0;
  const netPayment = Math.max(0, total - pphAmount);

  await db
    .update(bookingGroupsTable)
    .set({
      totalPayment: String(total),
      ppnRate: hasPpn ? String(ppnRate) : null,
      dpp: String(dpp),
      ppnAmount: String(ppnAmount),
      ppnTreatment: hasPpn ? "inclusive" : "none",
      pphRate: pphRate > 0 ? String(pphRate) : null,
      pphAmount: pphRate > 0 ? String(pphAmount) : null,
      netPayment: String(netPayment),
      updatedAt: new Date(),
    })
    .where(eq(bookingGroupsTable.groupRef, groupRef));

  return total;
}