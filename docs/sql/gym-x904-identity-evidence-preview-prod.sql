-- Read-only PROD candidate discovery; matching names are not identity verification.
CREATE OR REPLACE VIEW sport_center.gym_x904_identity_evidence_preview AS
WITH machine AS (
 SELECT device_serial,user_pin,display_name,lower(regexp_replace(trim(display_name),'\s+',' ','g')) nm
 FROM sport_center.gym_x904_lan_users WHERE trim(coalesce(display_name,''))<>''
), members AS (
 SELECT id AS membership_id,name AS member_name,status::text AS membership_status,
 lower(regexp_replace(trim(name),'\s+',' ','g')) nm
 FROM sport_center.sport_memberships
), pairs AS (
 SELECT machine.device_serial,machine.user_pin,machine.display_name,members.membership_id,
 members.member_name,members.membership_status FROM machine JOIN members USING(nm)
), ranked AS (
 SELECT pairs.*,count(*) OVER(PARTITION BY device_serial,user_pin) AS membership_matches,
 count(*) OVER(PARTITION BY membership_id) AS device_matches FROM pairs
)
SELECT device_serial,user_pin,display_name,membership_id,member_name,membership_status,
 membership_matches,device_matches,
 CASE WHEN membership_matches=1 AND device_matches=1
 THEN 'EXACT_NAME_CANDIDATE_NEEDS_ID_VERIFICATION'
 ELSE 'AMBIGUOUS_NAME_MANUAL_REVIEW' END AS identity_evidence
FROM ranked;
REVOKE ALL ON sport_center.gym_x904_identity_evidence_preview FROM PUBLIC,anon,authenticated;
-- No writes to member mappings or canonical bookings.
