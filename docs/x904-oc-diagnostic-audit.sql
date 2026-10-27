CREATE TABLE IF NOT EXISTS sport_center.x904_diagnostic_audit (
 request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 nonce_hash text NOT NULL UNIQUE,
 command_id uuid NOT NULL,
 action text NOT NULL CHECK(action='command_status'),
 result text NOT NULL CHECK(result='accepted'),
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON sport_center.x904_diagnostic_audit FROM PUBLIC, anon, authenticated;
GRANT INSERT,SELECT ON sport_center.x904_diagnostic_audit TO sport_center_app;
ALTER TABLE sport_center.x904_diagnostic_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY x904_diagnostic_audit_insert ON sport_center.x904_diagnostic_audit FOR INSERT TO sport_center_app WITH CHECK(action='command_status' AND result='accepted');
CREATE POLICY x904_diagnostic_audit_read ON sport_center.x904_diagnostic_audit FOR SELECT TO sport_center_app USING(true);
