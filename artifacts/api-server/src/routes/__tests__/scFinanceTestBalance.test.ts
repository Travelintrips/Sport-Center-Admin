import {calculateTestBalanceUpdates} from "../../lib/scFinanceTestBalance";

const historical = [
  ["Tanggal","Keterangan COA","Debit","Kredit","Saldo","PP","mutation_key","status_recon"],
  ["29/10/2026","Pengeluaran lama","",200000,4092.5,"Pengeluaran","","approved"],
];
const income=(id:string,amount:number,balance:unknown="")=>
  ["11/11/2026",`Dana Masuk dari FELICIA | BCA - kas kecil | blu by BCA Digital | ${id}`,
  amount,"",balance,"Pemasukan","","SC_TEST_ONLY"];
const expense=(id:string,amount:number,balance:unknown="")=>
  ["11/11/2026",`SC-TEST-OUT: Pengeluaran ke DEDE | ${id}`,
  "",amount,balance,"Pengeluaran","","SC_TEST_ONLY"];

describe("SC TEST-only Sheet column E balance",()=>{
  it("continues from historic E using C-D for income and expense",()=>{
    const rows=[...historical,income("SC-IN-000013",1000),expense("SC-TEST-OUT-000014",500)];
    expect(calculateTestBalanceUpdates(rows,new Set(["SC-IN-000013","SC-TEST-OUT-000014"])))
      .toEqual([{row:3,value:5092.5},{row:4,value:4592.5}]);
  });
  it("rebuilds balances after an earlier test row is cleared or removed",()=>{
    const rows=[...historical,income("SC-IN-000013",1000,5092.5),expense("SC-TEST-OUT-000014",500,4592.5)];
    expect(calculateTestBalanceUpdates(rows,new Set(["SC-IN-000013","SC-TEST-OUT-000014"]))).toEqual([]);
    // User deletes the income row: the expense must now subtract from the historic E.
    const deleted=[...historical,expense("SC-TEST-OUT-000014",500,4592.5)];
    expect(calculateTestBalanceUpdates(deleted,new Set(["SC-TEST-OUT-000014"])))
      .toEqual([{row:3,value:3592.5}]);
  });
  it("does not update historical or non-eligible rows",()=>{
    const rows=[...historical,income("SC-IN-000013",1000),expense("SC-TEST-OUT-000014",500)];
    expect(calculateTestBalanceUpdates(rows,new Set(["SC-TEST-OUT-000014"])))
      .toEqual([{row:4,value:4592.5}]);
  });
  it("includes intervening unsigned non-test transactions without changing historical E",()=>{
    const rows=[...historical,
      ["11/11/2026","Normal other income",2000,"","","Pemasukan","",""],
      income("SC-IN-000013",1000)];
    expect(calculateTestBalanceUpdates(rows,new Set(["SC-IN-000013"])))
      .toEqual([{row:4,value:7092.5}]);
  });
  it("fails closed without prior real balance and on invalid TEST marker/amount",()=>{
    expect(()=>calculateTestBalanceUpdates([historical[0],income("SC-IN-000013",1000)],
      new Set(["SC-IN-000013"]))).toThrow("SC_TEST_BALANCE_NO_HISTORICAL_ANCHOR");
    const corrupt=income("SC-IN-000013",1000);corrupt[6]="mutation-key";
    expect(()=>calculateTestBalanceUpdates([...historical,corrupt],new Set(["SC-IN-000013"])))
      .toThrow("SC_TEST_BALANCE_MUTATION_KEY_PRESENT");
    const nonNumeric=income("SC-IN-000013",1000,"untrusted");
    expect(()=>calculateTestBalanceUpdates([...historical,nonNumeric],new Set(["SC-IN-000013"])))
      .toThrow("SC_TEST_BALANCE_EXISTING_NON_NUMERIC");
  });
  it("rejects duplicate test identifiers rather than writing an ambiguous balance",()=>{
    expect(()=>calculateTestBalanceUpdates([
      ...historical,income("SC-IN-000013",1000),income("SC-IN-000013",2000)
    ],new Set(["SC-IN-000013"]))).toThrow("SC_TEST_BALANCE_DUPLICATE_ID");
  });
  it("cannot affect non-TEST row E and ignores blank rows",()=>{
    const rows=[...historical,[],income("SC-IN-000013",1000)];
    expect(calculateTestBalanceUpdates(rows,new Set(["SC-IN-000013"])))
      .toEqual([{row:4,value:5092.5}]);
  });
});
