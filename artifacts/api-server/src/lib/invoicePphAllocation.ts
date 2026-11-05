/**
 * Reconcile per-session PPh allocations to the already-computed invoice-level
 * PPh in integer rupiah. Never changes booking snapshots or gross prices.
 *
 * The final (latest) sessions absorb at most one rupiah per pass; this keeps
 * adjustments small, deterministic, and auditable. Unexpected large variance
 * fails closed instead of hiding a tax configuration mismatch.
 */
export type InvoicePphItem = {
  id: number;
  bookingDate: string | null;
  orderNumber: string | null;
  pphAmount: string | number | null;
};

export function allocateInvoicePphRounding<T extends InvoicePphItem>(
  items: readonly T[],
  invoicePphAmount: number,
): Array<{ item: T; allocatedPph: number; roundingAdjustment: number }> {
  const target = Math.round(invoicePphAmount);
  if (!Number.isSafeInteger(target) || target < 0) {
    throw new Error("INVALID_INVOICE_PPH");
  }
  if (items.length === 0) {
    if (target !== 0) throw new Error("INVOICE_PPH_WITHOUT_ITEMS");
    return [];
  }

  const sorted = [...items].sort((a, b) =>
    String(a.bookingDate ?? "").localeCompare(String(b.bookingDate ?? "")) ||
    String(a.orderNumber ?? "").localeCompare(String(b.orderNumber ?? "")) ||
    a.id - b.id,
  );
  const original = sorted.map((item) => Math.round(Number(item.pphAmount ?? 0)));
  if (original.some((v) => !Number.isSafeInteger(v) || v < 0)) {
    throw new Error("INVALID_ITEM_PPH");
  }
  const delta = target - original.reduce((sum, value) => sum + value, 0);
  if (Math.abs(delta) > sorted.length) {
    throw new Error("INVOICE_PPH_ROUNDING_EXCEEDS_ONE_RUPIAH_PER_ITEM");
  }
  const allocated = [...original];
  for (let k = 0; k < Math.abs(delta); k++) {
    const index = sorted.length - 1 - k;
    allocated[index] += Math.sign(delta);
    if (allocated[index] < 0) throw new Error("NEGATIVE_ITEM_PPH");
  }
  return sorted.map((item, i) => ({
    item,
    allocatedPph: allocated[i],
    roundingAdjustment: allocated[i] - original[i],
  }));
}

/** Disclose only Rp1-level deviations that can be explained by rounding. */
export function discloseInvoicePphRounding(
  items: readonly {
    id: number;
    orderNumber: string | null;
    totalAmount: string | number | null;
    taxAmount: string | number | null;
    pphAmount: string | number | null;
  }[],
  rate: number,
  targetPphAmount: number,
): Array<{ itemId: number; orderNumber: string | null; adjustment: number }> {
  if (!Number.isFinite(rate) || rate <= 0) return [];
  const actual = items.reduce((sum, item) => sum + Number(item.pphAmount ?? 0), 0);
  if (actual !== Math.round(targetPphAmount)) return [];
  const differences = items.map((item) => ({
    itemId: item.id,
    orderNumber: item.orderNumber,
    adjustment: Math.round(Number(item.pphAmount ?? 0)) -
      Math.round(Math.max(0, Number(item.totalAmount ?? 0) - Number(item.taxAmount ?? 0)) * rate / 100),
  }));
  if (differences.some((item) => !Number.isSafeInteger(item.adjustment) || Math.abs(item.adjustment) > 1)) {
    return [];
  }
  return differences.filter((item) => item.adjustment !== 0);
}
