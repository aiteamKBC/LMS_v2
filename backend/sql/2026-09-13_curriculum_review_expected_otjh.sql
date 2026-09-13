-- Expected OTJH hours for a Review template, and whether completing an
-- occurrence of it adds those hours to the learner's total OTJH.
--
-- Template-level configuration only, same as record_time_spent -- the actual
-- learner-facing "completing this review adds N hours" behaviour has
-- nowhere to run yet (see reviews.py module docstring: learner_review_instances
-- doesn't exist), so these columns are read by that future code path.
--
-- Forward-only, idempotent, non-destructive. Safe to re-run.

alter table curriculum.review_templates
    add column if not exists expected_otjh numeric(8, 2) not null default 0;

alter table curriculum.review_templates
    add column if not exists counts_towards_otjh boolean not null default false;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'review_templates_expected_otjh_non_negative'
    ) then
        alter table curriculum.review_templates
            add constraint review_templates_expected_otjh_non_negative check (expected_otjh >= 0);
    end if;
end $$;
