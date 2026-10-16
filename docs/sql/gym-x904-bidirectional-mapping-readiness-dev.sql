-- DEV-only read-only preview. Do not grant client-side access or send commands to X904.
CREATE OR REPLACE VIEW sport_center.gym_x904_mapping_readiness AS
SELECT u.device_serial, u.user_pin, u.device_uid,
       m.membership_id, COALESCE(m.status,'missing') AS mapping_status,
       CASE
         WHEN m.user_pin IS NULL THEN 'MAPPING_NOT_FOUND'
         WHEN m.status <> 'verified' THEN 'MAPPING_NOT_VERIFIED'
         WHEN sm.id IS NULL THEN 'MEMBERSHIP_NOT_FOUND'
         WHEN sm.status <> 'active'
           OR to_char(CURRENT_DATE,'YYYY-MM-DD') < sm.start_date
           OR to_char(CURRENT_DATE,'YYYY-MM-DD') > sm.end_date
           THEN 'MEMBERSHIP_INACTIVE'
         ELSE 'READY_FOR_REVIEW_ONLY'
       END AS readiness
FROM sport_center.gym_x904_lan_users u
LEFT JOIN sport_center.gym_x904_member_mapping m
  ON m.device_serial=u.device_serial AND m.user_pin=u.user_pin
LEFT JOIN sport_center.sport_memberships sm ON sm.id=m.membership_id;
REVOKE ALL ON sport_center.gym_x904_mapping_readiness FROM PUBLIC, anon, authenticated;
