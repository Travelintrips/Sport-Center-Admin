-- Add privacy-safe X904 ATTLOG grammar diagnostics only.
-- No PIN, identity, payload, raw content, biometric or source network data.
ALTER TABLE sport_center.gym_x904_adms_audit
  ADD COLUMN IF NOT EXISTS attlog_parseable boolean;
ALTER TABLE sport_center.gym_x904_adms_audit
  ADD COLUMN IF NOT EXISTS attlog_min_columns integer
    CHECK (attlog_min_columns BETWEEN 0 AND 32);
COMMENT ON COLUMN sport_center.gym_x904_adms_audit.attlog_parseable
  IS 'Whether the strict ATTLOG parser recognizes the upload, without saving any row values.';
COMMENT ON COLUMN sport_center.gym_x904_adms_audit.attlog_min_columns
  IS 'Smallest observed count of tab-delimited fields per line; identity and payload are excluded.';
