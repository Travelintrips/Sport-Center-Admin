-- CST Corporate kwitansi numbering. Reuse existing issued-number ledger;
-- no change to booking_groups.group_ref or sport_bookings.order_number.
-- company_id=0 and year=0 deliberately give one global, never-reset sequence.
-- Seed GM CGK's known November 2026 group at 014 only if it exists.
-- Subsequent corporate numbers begin 015 across ALL companies in PROD.
CREATE UNIQUE INDEX IF NOT EXISTS corporate_kwitansi_number_unique
ON sport_center.document_issued_numbers (document_number)
WHERE document_type='kwitansi_corporate';

INSERT INTO sport_center.document_number_sequences
  (company_id, document_type, year, current_seq)
SELECT 0, 'kwitansi_corporate', 0,
  CASE WHEN EXISTS (
    SELECT 1 FROM sport_center.booking_groups g
      JOIN sport_center.sport_bookings b ON b.group_ref=g.group_ref
      JOIN sport_center.users u ON u.id=b.company_customer_id
    WHERE g.group_ref='GRP-1794579653965-75664'
      AND u.account_type::text='company' AND u.company_name='GM CGK'
  ) THEN 14 ELSE 13 END
ON CONFLICT (company_id,document_type,year) DO NOTHING;

INSERT INTO sport_center.document_issued_numbers
  (entity_type,entity_id,document_type,company_id,document_number,issued_at)
SELECT 'booking_group',g.id,'kwitansi_corporate',0,
       '014/KWITANSI-CST/XI/2026',TIMESTAMPTZ '2026-11-28 00:00:00+07'
FROM sport_center.booking_groups g
WHERE g.group_ref='GRP-1794579653965-75664'
  AND EXISTS (
    SELECT 1 FROM sport_center.sport_bookings b
    JOIN sport_center.users u ON u.id=b.company_customer_id
    WHERE b.group_ref=g.group_ref
      AND u.company_name='GM CGK' AND u.account_type::text='company'
  )
ON CONFLICT (entity_type,entity_id,document_type,company_id) DO NOTHING;
