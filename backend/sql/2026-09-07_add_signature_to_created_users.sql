-- The learner's reusable signature, held on their own user record.
--
-- Why the columns are needed
-- --------------------------
-- Every signature the platform captured until now belonged to one document:
-- the apprenticeship agreement, the ILR, the training plan, a progress review.
-- Each of those carries its own `*_signature` / `*_signed_name` /
-- `*_signed_at` triple, which is right for a signed document — what was signed
-- must not change afterwards.
--
-- What was missing is a signature belonging to the *learner* rather than to a
-- document: one they set once (drawn from their name, or uploaded as an image
-- of their own handwriting) and reuse when signing later. The monthly report is
-- the first thing to need it, so these three hold it on the learner's row.
--
-- Stored as a data URL in a text column, matching every existing signature
-- column in the schema, so the same `startsWith('data:image/')` guards, PDF
-- signature blocks and rendering code work against it untouched.
--
-- This is the reusable copy, NOT the record of a signing
-- ------------------------------------------------------
-- A document still stores the signature as it was signed, on its own row.
-- Re-uploading a signature here must never rewrite what a learner already
-- signed, so nothing reads this column to render a past document —
-- "Learner".learner_monthly_reports keeps its own `signature`, `signed_name`
-- and `signed_at` for exactly that reason.
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
            and column_name  = 'Learner_signature'
       ) as columns_exist,
       count(*) as learner_rows
  from enrolment."Created_users";

-- 2. Apply.
alter table enrolment."Created_users"
  add column if not exists "Learner_signature" text;

alter table enrolment."Created_users"
  add column if not exists "Learner_signature_name" text;

alter table enrolment."Created_users"
  add column if not exists "Learner_signature_saved_at" timestamptz;

-- 3. Verify.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'enrolment'
   and table_name   = 'Created_users'
   and column_name in (
     'Learner_signature', 'Learner_signature_name', 'Learner_signature_saved_at'
   )
 order by column_name;
