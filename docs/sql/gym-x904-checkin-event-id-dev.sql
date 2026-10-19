-- DEV ONLY (Supabase CST-DEV: xssrfshdrtdfupgqwfdw).
-- Applied in DEV on 2026-10-19. Never automatically replay historical events.
-- Production already has this column and partial unique index.
ALTER TABLE sport_center.gym_checkins
  ADD COLUMN IF NOT EXISTS x904_event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS gym_checkins_x904_event_unique
  ON sport_center.gym_checkins (x904_event_id)
  WHERE x904_event_id IS NOT NULL;
