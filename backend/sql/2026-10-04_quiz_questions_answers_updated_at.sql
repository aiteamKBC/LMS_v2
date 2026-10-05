-- Quiz questions and answers: add `updated_at`.
-- Owner-run SQL only; no Django migration.
--
-- WHY THIS IS NEEDED
--
-- The Audit Trail decides between "Created" and "First recorded" by comparing a
-- row's `created_at` with its `updated_at`: a row this save inserted has both
-- stamped by the same write. `curriculum.quizzes` has both columns, but
-- `curriculum.quiz_questions` and `curriculum.quiz_answers` have only
-- `created_at`, so every question and answer -- even one created a second ago --
-- is reported as "First recorded" (17,160 answers and 3,140 questions in the
-- last 14 days). The application code (quiz_api.models, and the
-- `timestamps=` registration in system_audit.records) expects this column.
--
-- APPLY BEFORE DEPLOYING THE CODE THAT DECLARES `updated_at` ON THE QUIZ
-- MODELS: the ORM selects every model field, so a database without this
-- column would fail every quiz question/answer read.
--
-- NO BACKFILL
--
-- Existing rows are left with `updated_at` NULL. Nobody knows when they were
-- last edited, and copying `created_at` into it would claim they never were.
-- That is why the column is added WITHOUT a default and the default is set in a
-- second statement: `add column ... default now()` would stamp every existing
-- row with the time this script ran. A NULL stamp reads as "cannot tell", which
-- the audit layer treats as "not proven created" -- the safe answer.
--
-- COST ON THE LIVE TABLES
--
-- Both statements per table are catalogue-only changes in PostgreSQL (a
-- nullable column with no default, then a default that applies to future rows
-- only), so neither table is rewritten. Each takes a brief ACCESS EXCLUSIVE
-- lock; `lock_timeout` makes the script give up rather than queue behind a long
-- transaction and block quiz traffic.
--
-- IDEMPOTENT
--
-- Safe to run more than once: `add column if not exists`, and setting the same
-- default again is a no-op.

begin;

set local lock_timeout = '5s';

alter table curriculum.quiz_questions add column if not exists updated_at timestamptz;
alter table curriculum.quiz_questions alter column updated_at set default now();

alter table curriculum.quiz_answers add column if not exists updated_at timestamptz;
alter table curriculum.quiz_answers alter column updated_at set default now();

commit;

-- Verify (read-only):
--
--   select table_name, column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--    where table_schema = 'curriculum'
--      and table_name in ('quiz_questions', 'quiz_answers')
--      and column_name = 'updated_at';
--
--   -- Expect 0 / 0 straight after applying: no existing row is stamped.
--   select (select count(*) from curriculum.quiz_questions where updated_at is not null) as questions_stamped,
--          (select count(*) from curriculum.quiz_answers  where updated_at is not null) as answers_stamped;
