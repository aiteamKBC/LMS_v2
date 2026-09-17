-- Whether a learner's first learning session has been booked, and when.
--
-- Why the columns are needed
-- --------------------------
-- The first session used to be requested by the learner from their own
-- calendar. It is now arranged for them at enrolment: the Add-user form (and
-- the bulk import) take a date and time, and the server books that session
-- with the learner's case owner before the learner has ever signed in.
--
-- Two facts have to survive that, and neither had a home on the learner row:
--
--   "Has this learner's first session been booked at all?"  -- asked when an
--   enrolment is reviewed, and by anything reporting on learners whose first
--   session was never arranged (a booking can fail if Microsoft is briefly
--   unavailable, and the record has to stay honest about that).
--
--   "When was it booked?"  -- the audit timestamp. NOT the session's own date
--   and time: those belong to the calendar event in
--   "Coach".coach_calendar_event, which owns the meeting, its Teams join link
--   and its sync state. Copying them here would create a second, silently
--   drifting answer to when the session is.
--
-- The session's date also lands in the existing "Learner_start_date" column,
-- because that is the date the learner's programme starts. That column is the
-- strict anchor for review scheduling (learner_api/calendar.py) -- it is not a
-- free text field, and writing it moves the learner's review dates. That is
-- intended here: the programme genuinely begins at the first session.
--
-- Learners imported from Aptem (non-empty aptem_id) already have a start date
-- and are skipped by the booking code, so these columns stay null for them.
--
-- Column naming follows this table's convention: initial-capital, quoted,
-- because `Created_users` was created outside Django with irregular casing.
--
-- Safe to re-run. Additive only; no existing column, row or index is touched.

-- 1. Inspect first: do the columns exist, and how many learners are there to
--    carry them?
select (
         select count(*)
           from information_schema.columns
          where table_schema = 'enrolment'
            and table_name   = 'Created_users'
            and column_name  = 'First_session_booked'
       ) as columns_exist,
       count(*) as learner_rows
  from enrolment."Created_users";

-- 2. Apply.
alter table enrolment."Created_users"
  add column if not exists "First_session_booked" boolean;

alter table enrolment."Created_users"
  add column if not exists "First_session_booked_at" timestamptz;

-- 3. Verify.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'enrolment'
   and table_name   = 'Created_users'
   and column_name in ('First_session_booked', 'First_session_booked_at')
 order by column_name;
