import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./diagnose-qris-static-bank-match-dev.sql",import.meta.url),"utf8");

test("static Mandiri QRIS diagnostics never confirm payments or allocate X904 access",()=>{
 assert.match(sql,/WITH tx AS/i);
 assert.match(sql,/FROM sport_center\.qris_email_transactions_dev/);
 assert.match(sql,/sport_center\.sport_payments/);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT|CALL)\s+(?:INTO|FROM|TABLE|sport_center\.)/i);
 assert.match(sql,/reference_and_amount_unique__review_only/);
 assert.match(sql,/ambiguous_amount_only/);
 assert.match(sql,/no_candidate/);
 assert.match(sql,/created_at BETWEEN q\.transaction_at-interval '1 day'/);
});

test("bank reference is required in addition to equal total for a candidate",()=>{
 assert.match(sql,/exact_count=1 AND reference_count=1/);
 assert.match(sql,/p\.amount=q\.total/);
 assert.match(sql,/p\.reference_number/);
 assert.match(sql,/p\.provider_reference/);
 assert.match(sql,/p\.provider_trade_no/);
 assert.match(sql,/p\.merchant_trade_no/);
});
