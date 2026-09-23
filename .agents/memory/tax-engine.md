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
- Company/group invoices: sum the inclusive `totalPrice` values first, then extract DPP/PPN once from the aggregate; do not sum per-session rounded tax snapshots.
- Collapsed admin rows for recurring/company groups must display the group/invoice obligation, never the first session's net amount.
- Admin/customer booking detail and company invoices use `pphAmount = precise inclusive DPP × rate` and `netAmount = (DPP + PPN) − PPh` regardless of who collects the PPN; display-rounded DPP must not be used for the final PPh rounding.
- PPh eligibility is limited to company bookings whose company setting enables withholding; personal bookings must ignore any stale PPh snapshot and use the normal gross total.
- Company invoice corrections may apply the withholding snapshot back to each linked booking: keep `totalPrice`, DPP, PPN, and `grandTotal` unchanged; update only `pphRate`, `pphAmount`, and `netAmount`.
- A legacy company booking with a PPh snapshot but no reliable `pphRate` must use the 10% business default on the aggregate DPP; never infer a rate from group-summed `pphAmount`.

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
Jika tax rate perlu diubah, update baris di `tax_settings` DB saja. Kalkulasi inklusif: dpp = harga / (1 + rate/100). Untuk beberapa sesi, agregasikan harga inklusif sebelum pembulatan pajak agar net invoice dan daftar booking identik.
