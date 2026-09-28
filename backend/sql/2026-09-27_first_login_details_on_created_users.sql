-- When a new apprentice completed their first-sign-in details.
--
-- Why the column is needed
-- ------------------------
-- A newly created apprenticeship learner is now asked, the first time they sign
-- in, for their home address, title, date of birth and mobile, and to agree to
-- an electronic signature (learner_api/first_login_details.py). Finishing moves
-- them from 'Fresh user' to 'Onboarding' and opens the enrolment wizard.
--
-- The answers land in columns this table already has (Title, Country,
-- Current_postcode, Current_address_line_1..4, Date_of_birth, Phone_number, and
-- the reusable "Learner_signature" triple). What had no home was the fact that
-- the learner has done it: without it they would be asked again at every
-- sign-in. Null means "not yet"; the timestamp is when they finished.
--
-- Existing rows stay null. That does not re-ask anybody further along: the
-- screens are only shown to learners still at 'Fresh user'.
--
-- Column naming follows this table's convention: initial-capital, quoted,
-- because `Created_users` was created outside Django with irregular casing.
--
-- Safe to re-run. Additive only; no existing column, row or index is touched.

-- 1. Inspect first: does the column exist, and how many learners are there to
--    carry it?
select (
         select count(*)
           from information_schema.columns
          where table_schema = 'enrolment'
            and table_name   = 'Created_users'
            and column_name  = 'First_login_details_completed_at'
       ) as column_exists,
       count(*) as learner_rows
  from enrolment."Created_users";

-- 2. Apply.
alter table enrolment."Created_users"
  add column if not exists "First_login_details_completed_at" timestamptz;

-- 3. Verify.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'enrolment'
   and table_name   = 'Created_users'
   and column_name  = 'First_login_details_completed_at';
