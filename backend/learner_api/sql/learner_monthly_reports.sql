-- Deployment-owned schema for learner monthly reports.
--
-- One row per learner per calendar month: the reflection the learner typed in
-- the monthly-report wizard, the activity record as it stood when they
-- submitted, and the ids of any documents they attached.
--
-- The activity snapshot is stored rather than recomputed so a downloaded report
-- always matches what the learner saw and signed off. Recomputing it later would
-- silently change a submitted record whenever the curriculum, a coach's marking
-- or the calendar moved on.
--
-- Attachments themselves live in "Learner"."evidence_files" (uploaded through
-- the existing quarantine/scan/approve pipeline with a
-- 'monthly-report:YYYY-MM' section_ref); only their ids and display names are
-- denormalised here so the report reads without a join.
--
-- This script is intentionally idempotent so deployment and PostgreSQL test
-- setup can safely apply it more than once. Runtime request handlers must not
-- execute this DDL.

create schema if not exists "Learner";

create table if not exists "Learner".learner_monthly_reports (
    id                 uuid primary key,
    learner_kind       varchar(32) not null,
    learner_id         varchar(128) not null,
    learner_name       text,
    programme_name     text,
    -- The calendar month the report covers, as 'YYYY-MM'. Not a date: the row
    -- is about a month, and a date column invites a spurious day component.
    month_key          varchar(7) not null,
    month_label        text,
    status             varchar(64) not null default 'submitted',
    -- What the learner typed: what they learned that month.
    learned_summary    text not null,
    -- The timeline as it stood at submission: [{at, type, title, action, ...}].
    activity_snapshot  jsonb not null default '[]'::jsonb,
    -- The headline figures shown in the wizard: totalEvents, activeDays,
    -- loggedMinutes, ksbCount, plus the KSB codes evidenced.
    summary_metrics    jsonb not null default '{}'::jsonb,
    -- Uploaded documents: [{id, filename, contentType, sizeBytes}].
    attachments        jsonb not null default '[]'::jsonb,
    -- The KSBs the learner claims they worked on this month, chosen from their
    -- programme: [{code, type, description}]. The description is snapshotted
    -- with the code so the report still reads correctly if the curriculum
    -- rewords a KSB afterwards.
    selected_ksbs      jsonb not null default '[]'::jsonb,
    -- The learner's sign-off, as a data URL, exactly as it was signed. Held on
    -- the report rather than read from the learner's row, so re-saving a
    -- reusable signature never rewrites what was already signed.
    signature          text,
    signed_name        text,
    signed_at          timestamptz,
    submitted_at       timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

-- Additive column top-ups, so re-applying this script over an earlier
-- deployment brings the table forward without touching existing rows.
alter table "Learner".learner_monthly_reports
    add column if not exists learner_name text,
    add column if not exists programme_name text,
    add column if not exists month_label text,
    add column if not exists status varchar(64) not null default 'submitted',
    add column if not exists activity_snapshot jsonb not null default '[]'::jsonb,
    add column if not exists summary_metrics jsonb not null default '{}'::jsonb,
    add column if not exists attachments jsonb not null default '[]'::jsonb,
    add column if not exists selected_ksbs jsonb not null default '[]'::jsonb,
    add column if not exists signature text,
    add column if not exists signed_name text,
    add column if not exists signed_at timestamptz,
    add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_learner_monthly_reports_learner
    on "Learner".learner_monthly_reports (learner_kind, learner_id);
create index if not exists idx_learner_monthly_reports_submitted
    on "Learner".learner_monthly_reports (submitted_at desc);
-- One report per learner per month: the wizard reads and rewrites the same row,
-- so a resubmission updates rather than duplicating the month.
create unique index if not exists uq_learner_monthly_reports_month
    on "Learner".learner_monthly_reports (learner_kind, learner_id, month_key);
