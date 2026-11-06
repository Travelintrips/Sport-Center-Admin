-- DEV ONLY / READ ONLY. Static QRIS has no per-booking identifier.
-- Do NOT set status=confirmed, reserve VIS, or grant X904 access from this report.
-- Exact reference+amount is a CANDIDATE, not independent bank settlement attestation.
WITH tx AS (
 SELECT id,upper(btrim(coalesce(provider_reference,''))) AS ref,total,transaction_at
 FROM sport_center.qris_email_transactions_dev WHERE parse_status='parsed'
), checks AS (
 SELECT q.id,
  (SELECT count(*) FROM sport_center.sport_payments p
   WHERE q.ref<>'' AND (upper(btrim(coalesce(p.provider_reference,'')))=q.ref
   OR upper(btrim(coalesce(p.provider_trade_no,'')))=q.ref
   OR upper(btrim(coalesce(p.merchant_trade_no,'')))=q.ref
   OR upper(btrim(coalesce(p.reference_number,'')))=q.ref)) AS reference_count,
  (SELECT count(*) FROM sport_center.sport_payments p
   WHERE q.ref<>'' AND p.amount=q.total AND
   (upper(btrim(coalesce(p.provider_reference,'')))=q.ref
   OR upper(btrim(coalesce(p.provider_trade_no,'')))=q.ref
   OR upper(btrim(coalesce(p.merchant_trade_no,'')))=q.ref
   OR upper(btrim(coalesce(p.reference_number,'')))=q.ref)) AS exact_count,
  (SELECT count(*) FROM sport_center.sport_payments p
   WHERE p.amount=q.total AND p.created_at BETWEEN q.transaction_at-interval '1 day' AND q.transaction_at+interval '1 day') AS amount_near_count
 FROM tx q
)
SELECT CASE
 WHEN exact_count=1 AND reference_count=1 THEN 'reference_and_amount_unique__review_only'
 WHEN exact_count>1 OR reference_count>1 THEN 'ambiguous_reference'
 WHEN reference_count>0 THEN 'reference_amount_conflict'
 WHEN amount_near_count>1 THEN 'ambiguous_amount_only'
 WHEN amount_near_count=1 THEN 'single_amount_only_unverified'
 ELSE 'no_candidate'
 END AS classification, count(*) AS records
FROM checks GROUP BY 1 ORDER BY 1;
