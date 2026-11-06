/** Monthly salary remaining after each employee kasbon transaction. Pure/read-only calculation. */
export type SalaryKasbon = { id: number; kasbonDate: string; amount: string };
const moneyCents = (value: string): number | null => {
  // PostgreSQL numeric(15,2) is returned as a decimal string.
  if (!/^(0|[1-9]\d{0,12})(?:\.(\d{1,2}))?$/.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
};

/**
 * Balances are calculated within each calendar month, oldest to newest
 * (stable transaction ID breaks ties). A salary of NULL is unknown, not zero.
 * Negative balances are allowed as an informational result, never a payment.
 */
export function calculateSisaGaji(
  salary: string | null | undefined,
  records: SalaryKasbon[]
): Map<number, number | null> {
  const salaryCents = salary == null ? null : moneyCents(salary);
  const spentByMonth = new Map<string, number>();
  const remaining = new Map<number, number | null>();
  const sorted = [...records].sort((a, b) =>
    a.kasbonDate.localeCompare(b.kasbonDate) || a.id - b.id
  );
  for (const record of sorted) {
    const month = record.kasbonDate.slice(0, 7);
    const cents = moneyCents(record.amount);
    if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(record.kasbonDate) || cents == null || !Number.isSafeInteger(record.id)) {
      remaining.set(record.id, null);
      continue;
    }
    const total = (spentByMonth.get(month) ?? 0) + cents;
    spentByMonth.set(month, total);
    remaining.set(record.id, salaryCents == null ? null : (salaryCents - total) / 100);
  }
  return remaining;
}
