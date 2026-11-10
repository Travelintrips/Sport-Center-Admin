-- Allow only evidence-backed automatic creation of review_required nonmember candidates.
-- This does not verify a user and does not grant door access.
DROP POLICY IF EXISTS gym_nonmember_registry_new_user_candidate_insert ON sport_center.x904_verified_nonmember_identities;
CREATE POLICY gym_nonmember_registry_new_user_candidate_insert
ON sport_center.x904_verified_nonmember_identities
FOR INSERT TO sport_center_app
WITH CHECK (
  device_serial='TDBD234200545'
  AND user_pin ~ '^[0-9]{1,8}$'
  AND device_uid > 0
  AND length(trim(display_name)) >= 2
  AND verification_state='review_required'
  AND verified_by IS NULL AND verified_at IS NULL AND revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM sport_center.gym_x904_lan_users u
    WHERE u.device_serial=x904_verified_nonmember_identities.device_serial
      AND u.user_pin=x904_verified_nonmember_identities.user_pin
      AND u.device_uid=x904_verified_nonmember_identities.device_uid
      AND u.display_name=x904_verified_nonmember_identities.display_name
      AND u.device_role=0
  )
  AND NOT EXISTS (
    SELECT 1 FROM sport_center.gym_x904_member_mapping m
    WHERE m.device_serial=x904_verified_nonmember_identities.device_serial
      AND m.user_pin=x904_verified_nonmember_identities.user_pin
  )
  AND NOT EXISTS (
    SELECT 1 FROM sport_center.x904_nonmember_daily_access a
    WHERE a.device_serial=x904_verified_nonmember_identities.device_serial
      AND a.user_pin=x904_verified_nonmember_identities.user_pin
      AND (a.access_state IN ('pending','active') OR a.activated_at IS NOT NULL)
  )
  AND EXISTS (
    SELECT 1
    FROM sport_center.x904_user_commands c
    CROSS JOIN LATERAL (
      SELECT s.observed_at,s.user_count,s.users
      FROM sport_center.gym_x904_access_snapshots s
      WHERE s.device_serial=x904_verified_nonmember_identities.device_serial
      ORDER BY s.snapshot_id DESC LIMIT 1
    ) latest
    WHERE c.device_serial=x904_verified_nonmember_identities.device_serial
      AND c.user_pin=x904_verified_nonmember_identities.user_pin
      AND c.command_type='SUSPEND_USER' AND c.state='completed'
      AND c.payload->>'source'='AUTO_NEW_ORDINARY_USER_DEFAULT_SUSPEND'
      AND c.payload->>'expectedUid'=x904_verified_nonmember_identities.device_uid::text
      AND c.payload->>'expectedName'=x904_verified_nonmember_identities.display_name
      AND c.result->>'readBackConfirmed'='true'
      AND c.result->>'deviceUid'=x904_verified_nonmember_identities.device_uid::text
      AND c.result->>'afterGroup'='2'
      AND c.completed_at IS NOT NULL AND latest.observed_at > c.completed_at
      AND jsonb_array_length(latest.users)=latest.user_count
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(latest.users) x(v)
        WHERE x.v->>'pin'=x904_verified_nonmember_identities.user_pin
          AND x.v->>'name'=x904_verified_nonmember_identities.display_name
          AND x.v->>'role'='0' AND x.v->>'group'='2' AND x.v->>'enabled'='true')
  )
);
