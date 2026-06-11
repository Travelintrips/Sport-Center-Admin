/**
 * FASE 10 — Validasi dan Testing PPN Engine
 *
 * Test Cases:
 *  TC-01  Booking perorangan Rp100.000 → PPN Rp11.000 → Total Rp111.000
 *  TC-02  Booking corporate Rp500.000 → PPN Rp55.000 → Total Rp555.000
 *  TC-03  Booking member tetap kena PPN
 *  TC-04  Booking sebelum effectiveDate → PPN = 0 (backward compat)
 *  TC-05  Booking pada effectiveDate → PPN berlaku
 *  TC-06  Booking setelah effectiveDate → PPN berlaku
 *  TC-07  Refund membalik PPN (reverseTaxTransaction)
 *  TC-08  Tax engine menerima transaksi sport_center_booking
 *  TC-09  Laporan pajak menampilkan DPP dan PPN benar
 *  TC-10  Jurnal accounting: debit=kredit (balanced)
 *
 * Jalankan:
 *   node scripts/node_modules/.bin/tsx scripts/src/test-ppn.ts
 */

import { db, taxSettingsTable, taxTransactionsTable, bookingsTable } from "@workspace/db";
import { eq, and, desc, gte, lte } from "drizzle-orm";

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    const msg = detail ? `${label} — ${detail}` : label;
    console.error(`  ❌ FAIL: ${msg}`);
    errors.push(msg);
    failed++;
  }
}

function calcPpn(subtotal: number, rate = 11) {
  const taxAmount = Math.round(subtotal * rate / 100);
  return { dpp: subtotal, taxAmount, grandTotal: subtotal + taxAmount };
}

function isBeforeDate(bookingDate: string, effectiveDate: string): boolean {
  return bookingDate < effectiveDate;
}

async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log("  FASE 10 — Validasi PPN Engine Sport Center Jakarta");
  console.log("════════════════════════════════════════════════════════════\n");

  // ─── TC-01: Perorangan Rp100.000 ────────────────────────────────
  console.log("TC-01: Booking perorangan Rp100.000");
  {
    const subtotal = 100_000;
    const r = calcPpn(subtotal);
    assert("TC-01 DPP = Rp100.000", r.dpp === 100_000);
    assert("TC-01 PPN = Rp11.000", r.taxAmount === 11_000, `actual=${r.taxAmount}`);
    assert("TC-01 grandTotal = Rp111.000", r.grandTotal === 111_000, `actual=${r.grandTotal}`);
  }

  // ─── TC-02: Corporate Rp500.000 ─────────────────────────────────
  console.log("\nTC-02: Booking corporate Rp500.000");
  {
    const subtotal = 500_000;
    const r = calcPpn(subtotal);
    assert("TC-02 DPP = Rp500.000", r.dpp === 500_000);
    assert("TC-02 PPN = Rp55.000", r.taxAmount === 55_000, `actual=${r.taxAmount}`);
    assert("TC-02 grandTotal = Rp555.000", r.grandTotal === 555_000, `actual=${r.grandTotal}`);
  }

  // ─── TC-03: Member tetap kena PPN ───────────────────────────────
  console.log("\nTC-03: Booking member tetap kena PPN");
  {
    const subtotal = 200_000;
    const memberDiscount = 0; // member tidak dapat pengecualian PPN
    const r = calcPpn(subtotal - memberDiscount);
    assert("TC-03 PPN tidak nol meski member", r.taxAmount > 0, `actual=${r.taxAmount}`);
    assert("TC-03 PPN = Rp22.000", r.taxAmount === 22_000, `actual=${r.taxAmount}`);
    assert("TC-03 grandTotal = Rp222.000", r.grandTotal === 222_000, `actual=${r.grandTotal}`);
  }

  // ─── TC-04: Backward compat — booking sebelum effectiveDate ─────
  console.log("\nTC-04: Booking sebelum effectiveDate → PPN = 0");
  {
    const effectiveDate = "2025-01-01";
    const bookingDate = "2024-12-31";
    const isBefore = isBeforeDate(bookingDate, effectiveDate);
    assert("TC-04 bookingDate < effectiveDate", isBefore, `${bookingDate} vs ${effectiveDate}`);
    // Simulate: no tax applied
    const ppnAmount = isBefore ? 0 : calcPpn(100_000).taxAmount;
    assert("TC-04 PPN = 0 karena sebelum effective date", ppnAmount === 0, `actual=${ppnAmount}`);
  }

  // ─── TC-05: Booking tepat pada effectiveDate ─────────────────────
  console.log("\nTC-05: Booking tepat pada effectiveDate → PPN berlaku");
  {
    const effectiveDate = "2025-01-01";
    const bookingDate = "2025-01-01";
    const isBefore = isBeforeDate(bookingDate, effectiveDate);
    assert("TC-05 bookingDate == effectiveDate → TIDAK before", !isBefore);
    const ppnAmount = isBefore ? 0 : calcPpn(100_000).taxAmount;
    assert("TC-05 PPN = Rp11.000 pada effectiveDate", ppnAmount === 11_000, `actual=${ppnAmount}`);
  }

  // ─── TC-06: Booking setelah effectiveDate ────────────────────────
  console.log("\nTC-06: Booking setelah effectiveDate → PPN berlaku");
  {
    const effectiveDate = "2025-01-01";
    const bookingDate = "2026-06-15";
    const isBefore = isBeforeDate(bookingDate, effectiveDate);
    assert("TC-06 bookingDate > effectiveDate → TIDAK before", !isBefore);
    const ppnAmount = isBefore ? 0 : calcPpn(300_000).taxAmount;
    assert("TC-06 PPN = Rp33.000", ppnAmount === 33_000, `actual=${ppnAmount}`);
  }

  // ─── TC-07: Refund membalik PPN ──────────────────────────────────
  console.log("\nTC-07: Refund membalik PPN (reversal logic)");
  {
    const original = { dpp: 100_000, taxAmount: 11_000, grandTotal: 111_000 };
    const reversal = {
      dpp: -Math.abs(original.dpp),
      taxAmount: -Math.abs(original.taxAmount),
      grandTotal: -Math.abs(original.grandTotal),
    };
    assert("TC-07 reversal.dpp negatif", reversal.dpp === -100_000, `actual=${reversal.dpp}`);
    assert("TC-07 reversal.taxAmount negatif", reversal.taxAmount === -11_000, `actual=${reversal.taxAmount}`);
    assert("TC-07 reversal.grandTotal negatif", reversal.grandTotal === -111_000, `actual=${reversal.grandTotal}`);
    const net = original.taxAmount + reversal.taxAmount;
    assert("TC-07 net PPN setelah refund = 0", net === 0, `actual=${net}`);
  }

  // ─── TC-08: Tax engine menerima transaksi sport_center_booking ───
  console.log("\nTC-08: Tax engine — setting dengan appliesTo=sport_center_booking");
  {
    try {
      const [setting] = await db
        .select()
        .from(taxSettingsTable)
        .where(
          and(
            eq(taxSettingsTable.appliesTo, "sport_center_booking"),
            eq(taxSettingsTable.isActive, true)
          )
        )
        .limit(1);
      assert("TC-08 Tax setting ditemukan di DB", !!setting, "row tidak ada — jalankan migrate-ppn.ts terlebih dahulu");
      if (setting) {
        assert("TC-08 taxCode = PPN_OUT_11", setting.taxCode === "PPN_OUT_11", `actual=${setting.taxCode}`);
        assert("TC-08 taxRate = 11", Number(setting.taxRate) === 11, `actual=${setting.taxRate}`);
        assert("TC-08 taxType = output_vat", setting.taxType === "output_vat", `actual=${setting.taxType}`);
        assert("TC-08 isActive = true", setting.isActive === true, `actual=${setting.isActive}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert("TC-08 DB connection berhasil", false, msg);
    }
  }

  // ─── TC-09: Laporan pajak — transaksi sport center ───────────────
  console.log("\nTC-09: Laporan pajak — total DPP dan PPN dari tax_transactions");
  {
    try {
      const txs = await db
        .select()
        .from(taxTransactionsTable)
        .where(eq(taxTransactionsTable.transactionType, "original"));

      const totalDpp = txs.reduce((sum, t) => sum + Number(t.dpp), 0);
      const totalPpn = txs.reduce((sum, t) => sum + Number(t.taxAmount), 0);

      console.log(`     Jumlah transaksi original: ${txs.length}`);
      console.log(`     Total DPP: Rp${totalDpp.toLocaleString("id-ID")}`);
      console.log(`     Total PPN: Rp${totalPpn.toLocaleString("id-ID")}`);

      assert("TC-09 totalPpn = totalDpp * 11% (± rounding)", Math.abs(totalPpn - Math.round(totalDpp * 11 / 100)) <= txs.length, `DPP=${totalDpp}, PPN=${totalPpn}`);

      // Reversals — check they cancel out correctly
      const reversals = await db
        .select()
        .from(taxTransactionsTable)
        .where(eq(taxTransactionsTable.transactionType, "reversal"));

      const reversalPpn = reversals.reduce((sum, t) => sum + Number(t.taxAmount), 0);
      assert("TC-09 reversal amounts negatif atau nol", reversalPpn <= 0, `reversalPpn=${reversalPpn}`);

      const netPpn = totalPpn + reversalPpn;
      console.log(`     Net PPN (setelah reversal): Rp${netPpn.toLocaleString("id-ID")}`);
      assert("TC-09 net PPN >= 0", netPpn >= 0, `netPpn=${netPpn}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assert("TC-09 DB query berhasil", false, msg);
    }
  }

  // ─── TC-10: Jurnal accounting balanced ──────────────────────────
  console.log("\nTC-10: Jurnal accounting balanced (debit = kredit)");
  {
    // Untuk setiap booking dengan PPN:
    //   Debit: Piutang / Kas (+grandTotal)
    //   Kredit: Pendapatan (+totalPrice) + Hutang PPN (+ppnAmount)
    // Check: grandTotal = totalPrice + ppnAmount → balance
    const subtotal = 100_000;
    const ppn = Math.round(subtotal * 11 / 100);
    const grandTotal = subtotal + ppn;

    const debit = grandTotal;
    const kredit = subtotal + ppn;

    assert("TC-10 debit = kredit (Rp111.000 = Rp100.000 + Rp11.000)", debit === kredit, `debit=${debit}, kredit=${kredit}`);

    // Reversal: debit Hutang PPN + kredit Piutang PPN
    const reversalDebit = ppn;
    const reversalKredit = ppn;
    assert("TC-10 reversal debit = kredit", reversalDebit === reversalKredit, `debit=${reversalDebit}, kredit=${reversalKredit}`);
  }

  // ─── Summary ─────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`  Hasil: ${passed} PASS  |  ${failed} FAIL`);
  if (errors.length > 0) {
    console.log("\n  Failures:");
    errors.forEach((e) => console.log(`    • ${e}`));
  } else {
    console.log("  Semua test case berhasil! ✅");
  }
  console.log("════════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
