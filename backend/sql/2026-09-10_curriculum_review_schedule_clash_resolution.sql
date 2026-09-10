-- Programme Review schedule preview + clash resolution.
--
-- Forward-only, idempotent, non-destructive. Safe to re-run. Does not drop,
-- rename, or truncate anything; does not touch review_sections/review_fields
-- data. Extends curriculum.review_templates with the date recurrence is
-- calculated from, and adds two small tables that record occurrence-level
-- scheduling decisions -- see backend/curriculum_api/review_schedule.py for
-- how they are used.
--
-- Builds on (and must run after) the two previously-applied Review patches:
--   2026-09-10_curriculum_review_templates.sql
--   2026-09-10_curriculum_review_sections_and_advanced_fields.sql

-- 1. Schedule anchor date on review_templates -------------------------------
-- The date the FIRST occurrence is calculated from. Every existing Review
-- row is backfilled to its own created_at date, so recurrence becomes
-- calculable for every Review immediately, with no manual per-Review step.
alter table curriculum.review_templates
    add column if not exists schedule_anchor_date date;

update curriculum.review_templates
set schedule_anchor_date = created_at::date
where schedule_anchor_date is null;

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'curriculum'
          and table_name = 'review_templates'
          and column_name = 'schedule_anchor_date'
          and is_nullable = 'YES'
    ) then
        alter table curriculum.review_templates
            alter column schedule_anchor_date set not null;
        alter table curriculum.review_templates
            alter column schedule_anchor_date set default current_date;
    end if;
end $$;

-- 2. Occurrence-level overrides ---------------------------------------------
-- One row = one Review's one calendar occurrence has been explicitly
-- skipped. Never deletes or disables the recurring review_templates row --
-- "skip occurrence" is not "delete template". Restoring a skip soft-deletes
-- this row (deleted_at set) rather than hard-deleting it, so who skipped /
-- who restored an occurrence stays in the audit trail.
create table if not exists curriculum.review_occurrence_overrides (
    id varchar(128) primary key,
    review_id varchar(128) not null,
    programme_id varchar(255) not null,
    occurrence_date date not null,
    action varchar(16) not null default 'skip',
    reason varchar(1000) not null default '',
    deleted_at timestamp,
    deleted_by varchar(255),
    deleted_via_parent varchar(255),
    created_by varchar(255) not null default '',
    updated_by varchar(255) not null default '',
    created_at timestamp not null default current_timestamp,
    updated_at timestamp not null default current_timestamp
);

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'review_occurrence_overrides_action_check'
    ) then
        alter table curriculum.review_occurrence_overrides
            add constraint review_occurrence_overrides_action_check check (action in ('skip'));
    end if;
end $$;

-- At most one ACTIVE skip per (review, occurrence date) -- a partial index
-- rather than a plain unique constraint, so a skip/restore/skip history can
-- accumulate multiple soft-deleted rows for the same occurrence over time
-- without ever colliding.
create unique index if not exists review_occurrence_overrides_active_unique
    on curriculum.review_occurrence_overrides (review_id, occurrence_date)
    where deleted_at is null;

create index if not exists review_occurrence_overrides_review_idx
    on curriculum.review_occurrence_overrides (review_id);

create index if not exists review_occurrence_overrides_programme_idx
    on curriculum.review_occurrence_overrides (programme_id);

-- 3. Clash-level "keep all" acknowledgements ---------------------------------
-- One row = "these specific raw occurrences clash in this month, and the
-- user explicitly chose to keep every one of them" -- so the same clash does
-- not keep reappearing as unresolved after the user has already decided.
-- clash_signature is a deterministic digest of exactly which Review
-- occurrences made up the clash (see review_schedule.clash_signature); if a
-- template edit changes that set, the signature changes and this
-- acknowledgement naturally stops applying.
create table if not exists curriculum.review_clash_resolutions (
    id varchar(128) primary key,
    programme_id varchar(255) not null,
    clash_month varchar(7) not null,
    clash_signature varchar(2000) not null default '',
    resolution varchar(16) not null default 'keep_all',
    note varchar(1000) not null default '',
    deleted_at timestamp,
    deleted_by varchar(255),
    created_by varchar(255) not null default '',
    updated_by varchar(255) not null default '',
    created_at timestamp not null default current_timestamp,
    updated_at timestamp not null default current_timestamp
);

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'review_clash_resolutions_resolution_check'
    ) then
        alter table curriculum.review_clash_resolutions
            add constraint review_clash_resolutions_resolution_check check (resolution in ('keep_all'));
    end if;
end $$;

create unique index if not exists review_clash_resolutions_active_unique
    on curriculum.review_clash_resolutions (programme_id, clash_month, clash_signature)
    where deleted_at is null;

create index if not exists review_clash_resolutions_programme_idx
    on curriculum.review_clash_resolutions (programme_id);
