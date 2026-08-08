---
name: PPN 11% Tax Engine
description: How PPN tax is calculated, stored, and reported for all sport facility bookings.
---

## Rule
Harga lapangan adalah **inklusif PPN** (tax-inclusive). Grand Total = harga yang diinput. DPP diekstrak dari harga inklusif.

## How it works
- `calculateTax(subtotal)` — subtotal = harga inklusif PPN. Returns: `dpp = round(subtotal/1.11)`, `taxAmount = subtotal - dpp`, `grandTotal = subtotal` (tidak ditambah lagi).
- `totalPrice` di DB = harga inklusif (= grandTotal). `ppnAmount` = PPN yang diekstrak. `grandTotal` = harga inklusif.
- Frontend DPP display = `grandTotal - ppnAmount` (bukan `totalPrice` karena keduanya sama sekarang).
- `recordTaxTransaction(...)` inserts to tax_transactions table (non-blocking, fire-and-forget).
- Company invoices: PPN is summed from `booking.ppnAmount` (already stored), NOT recalculated.

## DB tables
- `sport_center.tax_settings` — seeded with `PPN_OUT_11` at 11%.
- `sport_center.tax_transactions` — tax ledger per booking/invoice.
- `sport_center.bookings.ppn_rate/ppn_amount/grand_total` — nullable columns.

## Frontend
- `Booking.tsx`: grand = harga-diskon, dpp = round(grand/1.11), ppn = grand - dpp. Label "Harga/jam (incl. PPN)".
- `BookingDetail.tsx`, `wa/ProofUpload.tsx`, `wa/BookingStatus.tsx`, `wa/BookingForm.tsx`: DPP = `grandTotal - ppnAmount`.
- Payment amount = `booking.grandTotal ?? booking.totalPrice`.

## Build
- `xlsx` harus ada di externals list di `build.mjs` — tidak bisa dibundle oleh esbuild.

**Why:**
Pengguna ingin harga yang tertera (mis. 50rb) sudah termasuk PPN, bukan ditambah PPN di atas harga. Consistent dengan praktik umum usaha ritel Indonesia.

**How to apply:**
Jika tax rate perlu diubah, update baris di `tax_settings` DB saja. Kalkulasi inklusif: dpp = harga / (1 + rate/100).
