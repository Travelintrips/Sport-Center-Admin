/**
 * Calculate the visible running balance for SC_TEST_ONLY rows in column E.
 * The last numeric balance on a historical row is the opening balance.
 * Only explicitly verified TEST IDs are eligible for a write; historical
 * rows are read-only. All data comes from an UNFORMATTED_VALUE Sheet read.
 */
export type TestBalanceCell = { row: number; value: number };

function numericCell(value: unknown, name: string): number {
  if (value == null || value === "") return 0;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw Error(`SC_TEST_BALANCE_INVALID_${name}`);
  return value;
}
function rounded(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1e15)
    throw Error("SC_TEST_BALANCE_OVERFLOW");
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function rowTestId(description: unknown): string | null {
  const match = String(description ?? "").trim().match(/(?:^| \| )(SC-IN-\d{6}|SC-TEST-(?:IN|OUT)-\d{6})$/);
  return match?.[1] ?? null;
}
export function calculateTestBalanceUpdates(
  rows: unknown[][],
  verifiedTestIds: ReadonlySet<string>,
): TestBalanceCell[] {
  let balance: number | null = null;
  const result: TestBalanceCell[] = [];
  const seenTestIds = new Set<string>();
  // Row 1 contains the header. All indices below are 0-based.
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index] ?? [];
    const incoming = numericCell(row[2], "DEBIT");
    const outgoing = numericCell(row[3], "KREDIT");
    const existingBalance = row[4];
    const isTest = String(row[7] ?? "").trim() === "SC_TEST_ONLY";
    if (!isTest) {
      // An existing numeric historical balance is authoritative. We never write it.
      if (typeof existingBalance === "number" && Number.isFinite(existingBalance)) {
        balance = rounded(existingBalance);
      } else if ((incoming !== 0 || outgoing !== 0) && balance !== null) {
        // An intervening non-test row may not have its own balance yet.
        balance = rounded(balance + incoming - outgoing);
      }
      continue;
    }
    if (String(row[6] ?? "").trim() !== "") throw Error("SC_TEST_BALANCE_MUTATION_KEY_PRESENT");
    const id = rowTestId(row[1]);
    if (!id) throw Error("SC_TEST_BALANCE_UNKNOWN_TEST_MARKER");
    if (seenTestIds.has(id)) throw Error("SC_TEST_BALANCE_DUPLICATE_ID");
    seenTestIds.add(id);
    if (incoming < 0 || outgoing < 0 || Number(incoming > 0) + Number(outgoing > 0) !== 1)
      throw Error("SC_TEST_BALANCE_INVALID_DIRECTION");
    if (balance === null) throw Error("SC_TEST_BALANCE_NO_HISTORICAL_ANCHOR");
    balance = rounded(balance + incoming - outgoing);
    if (!verifiedTestIds.has(id)) continue;
    if (existingBalance !== "" && existingBalance != null &&
      (typeof existingBalance !== "number" || !Number.isFinite(existingBalance)))
      throw Error("SC_TEST_BALANCE_EXISTING_NON_NUMERIC");
    if (existingBalance === "" || existingBalance == null ||
      Math.abs(existingBalance - balance) > 0.001)
      result.push({row:index + 1,value:balance});
  }
  return result;
}
