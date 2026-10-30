-- Separate idempotent claim for the EXISTING PEMAKAIAN SPORT CENTER report.
-- The original X904 scan digest and automated check-in sender remain independent.
CREATE TABLE IF NOT EXISTS sport_center.x904_pemakaian_refresh (
 report_date date PRIMARY KEY,
 notified_version bigint NOT NULL DEFAULT 0,
 claimed_version bigint NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending',
 claimed_at timestamptz,
 last_error text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT x904_pemakaian_refresh_status CHECK (status IN ('pending','sending','sent','unknown'))
);
