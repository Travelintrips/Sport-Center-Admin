import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
  parseTestInput,testNo,testSheetRow,testRowIndexes,testSummary
} from "../../lib/scFinanceTestValidation";

const source=readFileSync(resolve(process.cwd(),"src/lib/scFinanceTestSheet.ts"),"utf8");
const route=readFileSync(resolve(process.cwd(),"src/routes/scFinanceTest.ts"),"utf8");
const ui=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/Expenses.tsx"),"utf8");
const migration=readFileSync(resolve(process.cwd(),"../../migrations/20261110_sc_finance_test_ledger.sql"),"utf8");

const sample=(direction:"IN"|"OUT",amount:number,id:number)=>({
  id,direction,transaction_date:"2026-11-10",source_name:"Felicia Justiani",amount,
  notes:"Tes internal",sender_bank:"Mandiri",receiving_account:"Kas Besar SC",
  method:"Simulasi",bank_reference:"TEST-123"
});
describe("SC test-only ledger never creates bank movements or journals",()=>{
  it("places money in column C, money out in D, leaves balance and BizPortal columns untouched",()=>{
    const income=testSheetRow(sample("IN",10000,1));
    const expense=testSheetRow(sample("OUT",3000,2));
    expect(income).toEqual([
      "10/11/2026","Dana Masuk dari FELICIA JUSTIANI | Mandiri - Kas Besar SC | TEST-123 | SC-IN-000001",
      10000,"","","Pemasukan","","SC_TEST_ONLY","","","","",""
    ]);
    expect(expense[2]).toBe("");
    expect(expense[3]).toBe(3000);
    expect(expense[4]).toBe("");
    expect(expense[5]).toBe("Pengeluaran");
    expect(expense[6]).toBe("");
    expect(expense[7]).toBe("SC_TEST_ONLY");
    expect(expense).toHaveLength(13);
  });
  it("calculates balances only for synced test records, not unpaid or pending entries",()=>{
    expect(testSummary([
      {direction:"IN",amount:"10000",sheet_sync_state:"synced"},
      {direction:"OUT",amount:"3000",sheet_sync_state:"synced"},
      {direction:"IN",amount:"10000",sheet_sync_state:"removed"},
      {direction:"OUT",amount:"5000",sheet_sync_state:"mismatch"},
      {direction:"OUT",amount:"15000",sheet_sync_state:"pending"},
    ])).toEqual({income:10000,expense:3000,balance:7000,pending:1,count:5});
  });
  it("finds exactly one row for each stable ID on retry",()=>{
    expect(testNo(1,"IN")).toBe("SC-IN-000001");
    expect(testRowIndexes([["Header"],["A | SC-IN-000001"],["B | SC-TEST-OUT-000002"]],
      "SC-IN-000001")).toEqual([2]);
  });
  it("rejects invalid dates and amounts",()=>{
    const ok={entryKey:"9472f5ac-089f-41f2-b557-c6a67a49939d",
      transactionDate:"2026-11-10",sourceName:"Test",direction:"IN",amount:10000};
    expect(parseTestInput(ok).amount).toBe(10000);
    expect(()=>parseTestInput({...ok,transactionDate:"2026-02-30"})).toThrow("INVALID_DATE");
    expect(()=>parseTestInput({...ok,amount:1000001})).toThrow("TEST_AMOUNT_MUST_BE_1_TO_1000000");
  });
  it("requires the verified remote BizPortal runtime guard before any Google append",()=>{
    expect(source).toContain("SC_FINANCE_TEST_SHEETS_ENABLED");
    expect(source).toContain('SC_FINANCE_TEST_SHEETS_ENABLED!=="false"');
    expect(source).toContain('Number(rows[0].bank_account_id)!==1');
    expect(source).toContain('process.env.NODE_ENV==="production"');
    expect(source).toContain("/api/healthz");
    expect(source).toContain("assertBizPortalTestGuard();");
    expect(source).toContain('assertHeaders(');
    expect(source).toContain('SC_TEST_SHEET_READBACK_MISMATCH');
    expect(source).toContain("testRowIndexes");
    expect(source).toContain("startScFinanceTestRetryWorker");
    expect(source).not.toContain("INSERT INTO public.bank_mutations");
  });
  it("read-back reconciliation excludes manually deleted rows and never re-appends them",()=>{
    expect(source).toContain("reconcileScFinanceTestSheets");
    expect(source).toContain("startScFinanceTestSheetReconciliationWorker");
    expect(source).toContain("sheet_sync_state='removed'");
    expect(source).toContain("sheet_sync_state='mismatch'");
    expect(source).toContain('sheet_row=NULL');
    expect(source).toContain('testRowIndexes(rows.map');
    expect(source).toContain("SC_TEST_SHEET_CONTENT_MISMATCH");
    expect(source).toContain("sheet_verified_at=now()");
    expect(route).toContain('sheet_verified_at AS "sheetVerifiedAt"');
    expect(ui).toContain("Diperiksa ");
    expect(source).toContain("sheet_sync_state IN ('pending','failed')");
    expect(route).toContain('router.post("/admin/finance-test/reconcile"');
    expect(ui).toContain("Periksa Ulang Sheets");
    expect(ui).toContain("Dihapus dari Sheets");
    expect(ui).toContain('["pending","failed"].includes(x.sheetSyncState)');
  });
  it("maintains separate test table and Super Admin authorization",()=>{
    expect(migration).toContain("sc_finance_test_entries");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(route).toContain("superAdminMiddleware");
    expect(route).toContain("SC_FINANCE_TEST_CREATED");
    expect(route).not.toContain("INSERT INTO public.accounting");
    expect(route).not.toContain("INSERT INTO public.bank_mutations");
    expect(ui).toContain("Mode Uji Kas Besar SC");
    expect(ui).toContain("Selisih Bersih Uji");
  });
});

describe("Main Keuangan SC forms stay test-only until explicitly cut over", () => {
  it("keeps both income and expense submissions routed to the isolated ledger during TEST",()=>{
    expect(ui).toContain("const FINANCE_SC_TEST_ONLY = true");
    expect(ui).toContain('if(FINANCE_SC_TEST_ONLY){');
    expect(ui).toContain('} else if(FINANCE_SC_TEST_ONLY){');
    expect(ui).toContain('fetch(`${API}/admin/finance-test`');
    expect(ui).toContain('direction:"IN"');
    expect(ui).toContain('direction:"OUT"');
    expect(ui).toContain('entryKey:incomeEntryKey,direction:"IN"');
    expect(ui).toContain('entryKey:expenseTestEntryKey,direction:"OUT"');
    expect(ui).toContain('amount:gross');
    expect(ui).toContain("Input Uang Masuk (TEST)");
    expect(ui).toContain("Tambah Pengeluaran (TEST)");
    expect(ui).toContain("MODE TEST AKTIF");
  });
  it("does not create journals or direct BizPortal mutations from the test entry endpoint",()=>{
    expect(route).toContain('router.post("/admin/finance-test",superAdminMiddleware');
    expect(route).not.toContain("INSERT INTO public.bank_mutations");
    expect(route).not.toContain("INSERT INTO public.accounting_entries");
    expect(route).toContain("receipt_urls");
    expect(route).toContain("description_version");
    expect(source).toContain("expense_kind,destination_bank,base_amount,admin_fee,ppn_amount,description_version");
    expect(ui).toContain("receiptUrls:form.receiptUrls");
    expect(ui).toContain("Pratinjau Keterangan Kolom B (TEST)");
  });
});

describe("main finance history reads the same isolated TEST ledger as the input forms",()=>{
  it("reads test ledger across all four tabs, not only when the Test tab is selected",()=>{
    expect(ui).toContain('enabled:FINANCE_SC_TEST_ONLY || financeSection==="test"');
    expect(ui).toContain('const activeTestIncome =');
    expect(ui).toContain('const activeTestExpense =');
    expect(ui).toContain("Histori Uang Masuk (TEST)");
    expect(ui).toContain("Histori Pengeluaran (TEST)");
    expect(ui).toContain("FINANCE_SC_TEST_ONLY\n    ?");
    expect(ui).toContain("financeTestData?.entries ?? []");
    expect(ui).toContain("financeTestData.summary.income");
    expect(ui).toContain("financeTestData.summary.expense");
    expect(ui).toContain("financeTestData.summary.balance");
    expect(ui).toContain("Tidak ada transaksi yang sesuai filter.");
  });
  it("labels removed entries explicitly, retains histories, and does not count them in active totals",()=>{
    expect(ui).toContain('x.sheetSyncState==="removed"?"Dihapus dari Sheets"');
    expect(ui).toContain('"TEST — Dihapus dari Sheets"');
    expect(ui).toContain('Hanya transaksi TEST yang masih ada di Sheets');
    expect(ui).toContain('financeTestReadError ?');
    expect(ui).toContain('Ledger TEST gagal dibaca');
  });
});

describe("master financial table pagination and numeric running balance",()=>{
  it("uses page sizes 20/50/100 and preserves exact/single/range date filter",()=>{
    expect(ui).toContain('useState<20|50|100>(20)');
    expect(ui).toContain('<SelectItem value="20">20</SelectItem>');
    expect(ui).toContain('<SelectItem value="50">50</SelectItem>');
    expect(ui).toContain('<SelectItem value="100">100</SelectItem>');
    expect(ui).toContain('masterPageCount=Math.max(1,Math.ceil(visibleTransactions.length/masterPageSize))');
    expect(ui).toContain('paginatedTransactions=visibleTransactions.slice(');
    expect(ui).toContain("Sebelumnya");
    expect(ui).toContain("Berikutnya");
    expect(ui).toContain("Tanggal tunggal");
    expect(ui).toContain("Rentang tanggal");
    expect(ui).not.toContain('id="finance-sort"');
    expect(ui).not.toContain('id="finance-status"');
  });
  it("shows numeric Masuk, Keluar and Saldo columns, using full chronological ledger for balance",()=>{
    expect(ui).toContain('tx.status==="TEST — Tersinkron"');
    expect(ui).toContain('tx.sheetBalance.toLocaleString("id-ID"');
    expect(ui).not.toContain("runningTestBalance+=");
    expect(ui).toContain('<th className="p-3 text-right">Masuk</th>');
    expect(ui).toContain('<th className="p-3 text-right">Keluar</th>');
    expect(ui).toContain('<th className="p-3 text-right">Saldo</th>');
    expect(ui).toContain('a.id.match(');
    expect(ui).toContain('colSpan={5}');
    expect(ui).toContain('setExpandedTransactionIds(paginatedTransactions.map(tx => tx.key))');
  });
});

describe("optional Kas selector for normal incoming form",()=>{
  it("matches the requested bank - kas | receiving account format",()=>{
    const income={...sample("IN",10000,11),transaction_date:"2026-11-11",
      sender_bank:"Mandiri",cash_type:"kas kecil",receiving_account:"blu by BCA Digital",
      bank_reference:null};
    const row=testSheetRow(income);
    expect(row[1]).toBe("Dana Masuk dari FELICIA JUSTIANI | Mandiri - kas kecil | blu by BCA Digital | SC-IN-000011");
    expect(row[2]).toBe(10000);
    expect(row[7]).toBe("SC_TEST_ONLY");
    expect(testSheetRow({...income,cash_type:"kas besar"})[1])
      .toContain("Mandiri - kas besar | blu by BCA Digital | SC-IN-000011");
    expect(testSheetRow({...income,cash_type:""})[1])
      .toContain("Mandiri - blu by BCA Digital | SC-IN-000011");
  });
  it("rejects unknown categories and does not alter expense formatting",()=>{
    const valid={entryKey:"9472f5ac-089f-41f2-b557-c6a67a49939d",
      transactionDate:"2026-11-11",sourceName:"Felicia Justiani",direction:"IN",
      amount:10000,cashType:"kas kecil"};
    expect(parseTestInput(valid).cashType).toBe("kas kecil");
    expect(parseTestInput({...valid,cashType:""}).cashType).toBe("");
    expect(()=>parseTestInput({...valid,cashType:"rekening pribadi"})).toThrow("INVALID_CASH_TYPE");
    expect(testSheetRow({...sample("OUT",5000,12),cash_type:""})[1])
      .toContain("SC-TEST-OUT: Pengeluaran ke FELICIA JUSTIANI");
    expect(testSheetRow({...sample("OUT",5000,12),description_version:2,expense_kind:"Transfer Bank",destination_bank:"BCA"})[1])
      .toBe("Transfer ke FELICIA JUSTIANI | BCA - Tes internal | TEST-123 | SC-TEST-OUT-000012");
    const expenseActual={...sample("OUT",1000,17),source_name:"DEDE SAEFULLAH",
      receiving_account:"DEDE SAEFULLAH",sender_bank:"blu by BCA Digital",
      notes:"Reimbush charger ev",bank_reference:"1793262302800488",
      description_version:2,expense_kind:"Transfer Bank",destination_bank:"BCA"};
    expect(testSheetRow(expenseActual)[1]).toBe(
      "Transfer ke DEDE SAEFULLAH | BCA - Reimbush charger ev | 1793262302800488 | SC-TEST-OUT-000017"
    );
    expect(()=>parseTestInput({...valid,direction:"OUT",expenseKind:"tidak-ada"})).toThrow("INVALID_EXPENSE_KIND");
    expect(()=>parseTestInput({...valid,receiptUrls:["http://unsafe"]})).toThrow("INVALID_TEST_PROOF_URLS");
    expect(ui).toContain('id="income-cash-type"');
    expect(ui).toContain('value="kas kecil"');
    expect(ui).toContain('value="kas besar"');
    expect(ui).toContain('cashType:incomeForm.cashType');
  });
});


describe("column E TEST balance on existing test ledger writer",()=>{
  it("writes only verified TEST column E values and proves them before sync",()=>{
    expect(source).toContain("refreshScTestBalances");
    expect(source).toContain('!E${item.row}');
    expect(source).toContain('valueInputOption:"RAW"');
    expect(source).toContain('SC_TEST_BALANCE_NOT_VISIBLE');
    expect(source).toContain("SC_TEST_BALANCE_READBACK_MISMATCH");
    expect(source).toContain("await refreshScTestBalances(sheets);");
    expect(source).toContain("sheet_sync_state IN ('synced','syncing')");
  });
});

describe("master balance is read back from Google Sheets E",()=>{
  it("uses the verified Sheet E rather than an independent zero-based running subtotal",()=>{
    expect(route).toContain('sheet_balance::text AS "sheetBalance"');
    expect(ui).toContain('sheetBalance:entry.sheetBalance==null?null:Number(entry.sheetBalance)');
    expect(ui).toContain('tx.sheetBalance.toLocaleString("id-ID"');
    expect(source).toContain('SET sheet_balance=');
    expect(source).toContain('SC_TEST_BALANCE_LEDGER_NOT_NUMERIC');
    expect(source).toContain('SC_TEST_BALANCE_ROW_CHANGED_BEFORE_WRITE');
    expect(source).toContain('if(updates.length>0)');
  });
});

describe("Expense TEST proof categories and legacy compatibility",()=>{
  const legacy={
    direction:"OUT",transactionDate:"2026-11-12",amount:1000,
    entryKey:"c29e4cb4-57fc-4e18-a25e-2304f08b5be8",
    sourceName:"DEDE SAEFULLAH",senderBank:"blu by BCA Digital",
    receivingAccount:"DEDE SAEFULLAH",method:"BI-FAST",
    bankReference:"1793262302800488",notes:"Reimburse charger",
    expenseKind:"Reimburse Karyawan",
  };
  const payment="https://example.com/proof-payment.jpg";
  const supporting="https://example.com/struk-indomaret.jpg";
  it("records classified receipts in a single outgoing entry",()=>{
    const entry=parseTestInput({...legacy,paymentProofUrls:[payment],
      supportingReceiptUrls:[supporting],receiptUrls:[payment,supporting]});
    expect(entry.receiptUrls).toEqual([payment,supporting]);
    expect(entry.paymentProofUrls).toEqual([payment]);
    expect(entry.supportingReceiptUrls).toEqual([supporting]);
    expect(route).toContain("payment_proof_urls AS");
    expect(route).toContain("supporting_receipt_urls AS");
  });
  it("accepts legacy proofs without fabricating a type",()=>{
    const entry=parseTestInput({...legacy,receiptUrls:[payment]});
    expect(entry.receiptUrls).toEqual([payment]);
    expect(entry.paymentProofUrls).toEqual([]);
    expect(entry.supportingReceiptUrls).toEqual([]);
  });
  it("blocks invalid, overlapping and orphaned classification",()=>{
    expect(()=>parseTestInput({...legacy,paymentProofUrls:[payment,payment]}))
      .toThrow("ONLY_ONE_MAIN_PAYMENT_PROOF");
    expect(()=>parseTestInput({...legacy,paymentProofUrls:[payment],
      supportingReceiptUrls:[payment]})).toThrow("PROOF_CATEGORY_OVERLAP");
    expect(()=>parseTestInput({...legacy,paymentProofUrls:[payment],
      receiptUrls:[supporting]})).toThrow("PROOF_CATEGORY_NOT_IN_RECEIPTS");
    expect(()=>parseTestInput({...legacy,supportingReceiptUrls:["http://example.com/struk"]}))
      .toThrow("INVALID_SUPPORTING_RECEIPT_URLS");
  });
});

describe("SC TEST payment method vs expense reporting category and admin fee",()=>{
  const entryKey="c29e4cb4-57fc-4e18-a25e-2304f08b5be8";
  const base={entryKey,transactionDate:"2026-11-12",direction:"OUT",sourceName:"DEDE SAEFULLAH",
    amount:102500,method:"BI-FAST",expenseKind:"Reimburse Karyawan",notes:"Charger EV",
    baseAmount:100000,ppnAmount:0,adminFee:2500};
  it("keeps report category separate, total includes admin fee exactly once",()=>{
    const parsed=parseTestInput(base);
    expect(parsed.expenseKind).toBe("Reimburse Karyawan");
    expect(parsed.amount).toBe(102500);
    expect(parsed.baseAmount).toBe(100000);
    expect(parsed.adminFee).toBe(2500);
    expect(parsed.ppnAmount).toBe(0);
    const row=testSheetRow({...sample("OUT",parsed.amount,30),method:"BI-FAST",
      expense_kind:parsed.expenseKind,base_amount:parsed.baseAmount,admin_fee:parsed.adminFee,
      ppn_amount:parsed.ppnAmount,description_version:3,notes:"Charger EV"});
    expect(row[1]).toBe("Transfer ke FELICIA JUSTIANI | Charger EV | TEST-123 | Biaya Admin Rp2.500 | SC-TEST-OUT-000030");
    expect(row[3]).toBe(102500);
    expect(row[7]).toBe("SC_TEST_ONLY");
    expect(row[1]).not.toContain("Reimburse Karyawan");
  });
  it("payment method determines QRIS/transfer label, never reporting category",()=>{
    const qr=testSheetRow({...sample("OUT",1000,31),method:"QRIS",
      expense_kind:"Reimburse Karyawan",description_version:3});
    const bank=testSheetRow({...sample("OUT",1000,32),method:"BI-FAST",
      expense_kind:"Reimburse Karyawan",description_version:3});
    expect(qr[1]).toContain("Pembayaran QRIS");
    expect(bank[1]).toContain("Transfer ke");
  });
  it("rejects invalid breakdown and payment method before saving",()=>{
    expect(()=>parseTestInput({...base,adminFee:2501})).toThrow("TEST_AMOUNT_BREAKDOWN_MISMATCH");
    expect(()=>parseTestInput({...base,adminFee:-1})).toThrow("INVALID_EXPENSE_COMPONENT");
    expect(()=>parseTestInput({...base,method:"not-real"})).toThrow("INVALID_PAYMENT_METHOD");
    expect(()=>parseTestInput({...base,expenseKind:"QRIS"})).toThrow("INVALID_EXPENSE_KIND");
  });
  it("keeps older v1/v2 formatting and historical amounts intact",()=>{
    const old=testSheetRow({...sample("OUT",1000,20),expense_kind:"QRIS",
      method:"Transfer Bank",description_version:2});
    expect(old[1]).toContain("Pembayaran QRIS");
    expect(old[3]).toBe(1000);
  });
});
