-- Owner-run SQL only. No migrations and no application-side provisioning.
-- Replace __PASSWORD_HASH__ with a Django hash before running.
-- A ready-to-run private copy is prepared at .cache/record-monitor-provision.sql.
BEGIN;

ALTER TABLE enrolment."Staff_users"
  DROP CONSTRAINT IF EXISTS staff_users_access_check;
ALTER TABLE enrolment."Staff_users"
  ADD CONSTRAINT staff_users_access_check CHECK (
    "Access" IS NULL OR lower(btrim("Access")) IN
      ('enrolment', 'curriculum', 'coach', 'tutor', 'super-admin', 'record-monitor')
  );

DO $monitor_account$
DECLARE
  monitor_email text := 'monitor@kentbusiinesscollege.com';
  monitor_hash text := '__PASSWORD_HASH__';
  monitor_staff_id integer;
BEGIN
  IF monitor_hash = '__PASSWORD_' || 'HASH__' OR length(monitor_hash) < 40 THEN
    RAISE EXCEPTION 'Use the generated SQL containing the Django password hash.';
  END IF;

  -- Re-running this exact setup never changes an existing password or access.
  IF EXISTS (SELECT 1 FROM login."Login_accounts" a
      JOIN enrolment."Staff_users" s ON a."Subject_type"='staff' AND a."Subject_id"=s.id
      WHERE a."Email"=monitor_email AND lower(btrim(s."Email"))=monitor_email
        AND s."Access"='record-monitor' AND a."Role"='staff') THEN
    RAISE NOTICE 'The monitoring account already exists; no account changes made.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM login."Login_accounts" WHERE lower(btrim("Email"))=monitor_email)
    OR EXISTS (SELECT 1 FROM enrolment."Staff_users" WHERE lower(btrim("Email"))=monitor_email) THEN
    RAISE EXCEPTION 'This email is already in use. No existing account was modified.';
  END IF;

  INSERT INTO enrolment."Staff_users"
    ("Username", "Email", "Type", " Status", "Position", "Access", "Invite_to_platform")
  VALUES ('KBC Record Monitor', monitor_email, 'Staff', 'Active', 'Admin', 'record-monitor', false)
  RETURNING id INTO monitor_staff_id;

  INSERT INTO login."Login_accounts"
    ("Subject_type", "Subject_id", "Email", "Display_name", "Role",
     "Password_hash", "Password_set_at", "Is_active", "Failed_attempts")
  VALUES ('staff', monitor_staff_id, monitor_email, 'KBC Record Monitor', 'staff',
          monitor_hash, now(), true, 0);
END;
$monitor_account$;

COMMIT;

SELECT a."Email", a."Role", s."Access", a."Is_active"
FROM login."Login_accounts" a JOIN enrolment."Staff_users" s
  ON a."Subject_type"='staff' AND a."Subject_id"=s.id
WHERE a."Email"='monitor@kentbusiinesscollege.com';
