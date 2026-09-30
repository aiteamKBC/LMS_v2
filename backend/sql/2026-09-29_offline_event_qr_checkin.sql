BEGIN;

ALTER TABLE "Engagement".events
  ADD COLUMN IF NOT EXISTS event_date date NULL,
  ADD COLUMN IF NOT EXISTS start_time time NULL,
  ADD COLUMN IF NOT EXISTS end_time time NULL,
  ADD COLUMN IF NOT EXISTS check_in_token uuid NULL;

-- Remove the legacy workshop/social/etc. check before converting existing
-- rows. PostgreSQL enforces it during UPDATE, so doing this later would make
-- the whole transaction fail on the first row changed to offline.
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'Engagement' AND t.relname = 'events'
      AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE "Engagement".events DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

UPDATE "Engagement".events
SET type = 'offline'
WHERE type IS DISTINCT FROM 'offline' AND type IS DISTINCT FROM 'online';

UPDATE "Engagement".events
SET event_date = to_date(date, 'DD Mon YYYY')
WHERE event_date IS NULL AND date ~ '^\d{1,2} [A-Za-z]{3} \d{4}$';

UPDATE "Engagement".events
SET start_time = split_part(time, ' - ', 1)::time,
    end_time = split_part(time, ' - ', 2)::time
WHERE (start_time IS NULL OR end_time IS NULL)
  AND time ~ '^\d{2}:\d{2} - \d{2}:\d{2}$';

UPDATE "Engagement".events
SET check_in_token = (
  substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 8) || '-' ||
  substr(md5(random()::text || id::text), 1, 4) || '-4' ||
  substr(md5(random()::text || id::text), 1, 3) || '-a' ||
  substr(md5(random()::text || id::text), 1, 3) || '-' ||
  substr(md5(random()::text || clock_timestamp()::text), 1, 12)
)::uuid
WHERE check_in_token IS NULL;

ALTER TABLE "Engagement".events ALTER COLUMN check_in_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS engagement_events_check_in_token_unique
  ON "Engagement".events (check_in_token);

ALTER TABLE "Engagement".events
  ADD CONSTRAINT engagement_event_type_check CHECK (type IN ('offline', 'online'));

ALTER TABLE "Engagement".event_attendance
  ADD COLUMN IF NOT EXISTS attendee_email varchar(320) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS attendee_type varchar(20) NOT NULL DEFAULT 'learner',
  ADD COLUMN IF NOT EXISTS attendance_source varchar(30) NOT NULL DEFAULT 'manual';

ALTER TABLE "Engagement".event_attendance
  DROP CONSTRAINT IF EXISTS engagement_event_attendee_type_check;
ALTER TABLE "Engagement".event_attendance
  ADD CONSTRAINT engagement_event_attendee_type_check
  CHECK (attendee_type IN ('learner', 'guest'));

CREATE UNIQUE INDEX IF NOT EXISTS engagement_event_attendance_email_unique
  ON "Engagement".event_attendance (event_id, lower(attendee_email))
  WHERE attendee_email <> '';

COMMIT;
