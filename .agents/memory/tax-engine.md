---
name: PPN 11% Tax Engine
description: How PPN tax is calculated, stored, and reported for all sport facility bookings.
---

## Rule
All new bookings automatically get PPN 11% calculated and stored at booking creation time. Old bookings with null ppnRate/ppnAmount/grandTotal are backward-compatible — UI falls back to totalPrice.

## How it works
- `artifacts/api-server/src/lib/tax.ts` — `calculateTax(subtotal)` fetches active tax_settings row, returns `{dpp, taxRate, taxAmount, grandTotal, taxCode}`. Returns zero-tax if no active setting.
- `recordTaxTransaction(...)` inserts to tax_transactions table (non-blocking, fire-and-forget).
- Booking insert gets: `ppnRate`, `ppnAmount`, `grandTotal` (all nullable strings, null if no active tax setting).
- Company invoices: PPN is summed from `booking.ppnAmount` (already stored), NOT recalculated. Old unbilled bookings with null ppnAmount contribute 0 PPN.

## DB tables added
- `sport_center.tax_settings` — tax config (taxCode, taxRate, appliesTo, isActive). Seeded with `PPN_OUT_11` at 11%.
- `sport_center.tax_transactions` — tax ledger per booking/invoice.
- `sport_center.bookings.ppn_rate/ppn_amount/grand_total` — nullable numeric columns.

## Frontend
- Booking.tsx summary: shows DPP + PPN 11% + Grand Total breakdown (calculated frontend-side at 11%).
- BookingDetail.tsx: shows DPP/PPN/Grand Total if ppnAmount > 0, otherwise shows legacy "Total".
- Payment amount submitted = `booking.grandTotal ?? booking.totalPrice`.
- CompanyBilling.tsx: removed manual includePpn toggle; PPN from stored booking.ppnAmount.
- Reports.tsx: added "Laporan Pajak (PPN)" tab with summary cards, bar chart, period table, and transaction ledger.

**Why:**
Tax logic was scattered (hardcoded 0.11 in companyInvoices.ts). Centralized in tax.ts so rate changes happen in one place (update tax_settings row, no code change needed).

**Migration:**
Run `scripts/migrate-ppn.ts` via `scripts/node_modules/.bin/tsx ../scripts/migrate-ppn.ts` for any new environment.
