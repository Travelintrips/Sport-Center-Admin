import test from "node:test";
import assert from "node:assert/strict";
import { parseMandiriQrisEmail } from "./mandiri-qris-parser.mjs";
const sample = `TRASAKSI BERHASIL
Nama Toko : TRAVELIN BANDARA SOETTA
Nama Acquirer : MANDIRI
Nomor Referensi : 630891709590
Tanggal Transaksi : 2026-11-04
Waktu Transaksi : 21:31:29
Pembayaran dari : BNI
Nama Customer : HILMY KHAIRY
Issuer RRN : f8616376f59d
Nominal Transaksi : 300,000.00
TIP : 0.00
Total: 300,000.00`;
test("extracts notification without treating it as verified payment", () => {
 const x=parseMandiriQrisEmail(sample);
 assert.equal(x.valid,true); assert.equal(x.totalCents,30000000);
 assert.equal(x.reference,"630891709590");
 assert.equal(x.matchStatus,"requires_reconciliation");
 assert.equal("customerPan" in x,false);
});
test("rejects altered total",()=>assert.equal(parseMandiriQrisEmail(sample.replace("Total: 300,000.00","Total: 400,000.00")).valid,false));
test("rejects non-success email",()=>assert.equal(parseMandiriQrisEmail(sample.replace("TRASAKSI BERHASIL","TRANSAKSI GAGAL")).valid,false));
test("rejects missing reference",()=>assert.equal(parseMandiriQrisEmail(sample.replace("Nomor Referensi : 630891709590","")).valid,false));
