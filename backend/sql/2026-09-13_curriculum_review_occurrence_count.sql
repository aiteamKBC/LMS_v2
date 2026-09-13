-- Optional cap on how many times a Review template recurs.
--
-- NULL (the default) means unlimited -- the existing behaviour, where a
-- Review recurs for as long as the schedule preview window looks ahead.
-- A positive integer stops generate_occurrences() (review_schedule.py) from
-- projecting any occurrence beyond the Nth one counted from
-- schedule_anchor_date.
--
-- Forward-only, idempotent, non-destructive. Safe to re-run.

alter table curriculum.review_templates
    add column if not exists occurrence_count integer;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'review_templates_occurrence_count_positive'
    ) then
        alter table curriculum.review_templates
            add constraint review_templates_occurrence_count_positive check (occurrence_count is null or occurrence_count > 0);
    end if;
end $$;
