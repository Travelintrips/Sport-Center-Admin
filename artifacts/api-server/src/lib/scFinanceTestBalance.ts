/**
 * Calculate the visible running balance for SC_TEST_ONLY rows in column E.
 * The last numeric balance on a historical row is the opening balance.
 * Only explicitly verified TEST IDs are eligible for a write; historical
 * rows are read-only. All data comes from an UNFORMATTED_VALUE Sheet read.
 */
export type TestBalanceCell = { row: number; value: number };

/**
 * Google Sheets can return historical cash amounts as text even with
 * UNFORMATTED_VALUE, especially after a manual import or pasted rows.
 * Accept only unambiguous Indonesian/US currency patterns.
 */
export function parseSheetMoney(value:unknown,name:string):number|null{
  if(value===null||value===undefined||value==="")return null;
  if(typeof value==="number"){
    if(!Number.isFinite(value))throw Error(`SC_TEST_BALANCE_INVALID_${name}`);
    return value;
  }
  if(typeof value!=="string")throw Error(`SC_TEST_BALANCE_INVALID_${name}`);
  let text=value.trim().replace(/^Rp\s*/i,"").replace(/\s+/g,"");
  if(!text)return null;
  let negative=false;
  if(text.startsWith("(")&&text.endsWith(")")){
    negative=true;text=text.slice(1,-1);
  }
  if(text.startsWith("-")){negative=true;text=text.slice(1);}
  if(!/^[0-9.,]+$/.test(text))throw Error(`SC_TEST_BALANCE_INVALID_${name}`);
  const comma=text.lastIndexOf(",");
  const dot=text.lastIndexOf(".");
  if(comma>=0&&dot>=0){
    // Last separator determines the decimal mark.
    text=comma>dot?text.replace(/\./g,"").replace(",","."):text.replace(/,/g,"");
  }else if(comma>=0){
    text=/^\d{1,3}(,\d{3})+$/.test(text)?text.replace(/,/g,""):text.replace(",",".");
  }else if(dot>=0 && /^\d{1,3}(\.\d{3})+$/.test(text)){
    text=text.replace(/\./g,"");
  }
  if(!/^\d+(?:\.\d+)?$/.test(text))throw Error(`SC_TEST_BALANCE_INVALID_${name}`);
  const result=Number(text)*(negative?-1:1);
  if(!Number.isFinite(result))throw Error(`SC_TEST_BALANCE_INVALID_${name}`);
  return result;
}
function numericCell(value:unknown,name:string):number{
  return parseSheetMoney(value,name)??0;
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
      const historicalBalance=parseSheetMoney(existingBalance,"HISTORICAL_E");
      if (historicalBalance !== null) {
        balance = rounded(historicalBalance);
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
    const testBalance=parseSheetMoney(existingBalance,"TEST_E");
    if (testBalance === null || Math.abs(testBalance-balance)>0.001)
      result.push({row:index + 1,value:balance});
  }
  return result;
}
