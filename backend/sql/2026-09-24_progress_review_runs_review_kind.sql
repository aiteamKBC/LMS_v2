-- Monthly Coaching Meeting decks reuse the Progress Review PPTX pipeline and
-- its tables; review_kind keeps an MCM run and a Progress Review run on the
-- same date apart. Same DDL as progress_reviews_api.tables.ensure_progress_review_tables.
alter table "Learner"."progress_review_runs"
  add column if not exists review_kind varchar(32) not null default 'progress_review';

-- An edited or re-uploaded deck is a new run that points at the run it
-- revises (revision_source 'edited' | 'uploaded'); the original is kept.
alter table "Learner"."progress_review_runs"
  add column if not exists parent_run_id text;
alter table "Learner"."progress_review_runs"
  add column if not exists revision_source varchar(32) not null default 'generated';
