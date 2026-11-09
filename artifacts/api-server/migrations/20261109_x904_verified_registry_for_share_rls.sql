-- Repair the anonymous Gym registered-PIN checkout under RLS.
-- SELECT ... FOR SHARE is subject to UPDATE row policies in PostgreSQL.
-- The application must see registry rows for shared locking, but must never
-- gain the right to change registered identity data.
-- Prerequisite: existing SELECT policy "gym_nonmember_registry_backend_read".
CREATE POLICY gym_nonmember_registry_backend_share_lock
  ON sport_center.x904_verified_nonmember_identities
  FOR UPDATE TO sport_center_app
  USING (true)
  WITH CHECK (false);
-- With CHECK (false) blocks actual UPDATEs by sport_center_app,
-- while USING (true) permits row locking of visible registry identities.
-- Registry mutation remains operator-controlled; anon/authenticated stay revoked.
