-- Deployment-owned schema for complete learner reflection submissions.
-- This script is intentionally idempotent so deployment and PostgreSQL test
-- setup can safely apply it more than once. Runtime request handlers must not
-- execute this DDL.

create schema if not exists "Learner";

create table if not exists "Learner".learning_reflection_submissions (
    id                          uuid primary key,
    learner_kind                varchar(32) not null,
    learner_id                  varchar(128) not null,
    learner_name                text,
    programme_name              text,
    activity_type               varchar(64) not null,
    activity_id                 varchar(255) not null,
    activity_title              text,
    module_title                text,
    week_title                  text,
    planned_otjh                text,
    status                      varchar(64) not null default 'submitted_for_tutor_review',
    learning_reflection         text not null,
    ksb_codes                   jsonb not null default '[]'::jsonb,
    ksb_weights                 jsonb not null default '{}'::jsonb,
    ksb_explanations            jsonb not null default '{}'::jsonb,
    confidence_before           jsonb not null default '{}'::jsonb,
    confidence_after            jsonb not null default '{}'::jsonb,
    application_type            varchar(64),
    application_text            text,
    evidence_files              jsonb not null default '[]'::jsonb,
    evidence_consent_confirmed  boolean not null default false,
    selected_benefits           jsonb not null default '[]'::jsonb,
    benefit_explanation         text,
    actual_time_hours           text,
    completed_during_paid_hours varchar(32),
    date_completed              date,
    otjh_confirmed              boolean not null default false,
    signed_declaration          boolean not null default false,
    quality_score               smallint not null default 0,
    full_submission             jsonb not null default '{}'::jsonb,
    coach_feedback              text,
    reviewed_by                 text,
    reviewed_at                 timestamptz,
    progress_entry_id           bigint,
    enrolment_id                bigint,
    component_ref               text,
    programme_ref               text,
    cohort_ref                  text,
    group_ref                   text,
    module_ref                  text,
    week_ref                    text,
    submitted_at                timestamptz not null default now()
);

alter table "Learner".learning_reflection_submissions
    add column if not exists ksb_weights jsonb not null default '{}'::jsonb,
    add column if not exists coach_feedback text,
    add column if not exists reviewed_by text,
    add column if not exists reviewed_at timestamptz,
    add column if not exists progress_entry_id bigint,
    add column if not exists enrolment_id bigint,
    add column if not exists component_ref text,
    add column if not exists programme_ref text,
    add column if not exists cohort_ref text,
    add column if not exists group_ref text,
    add column if not exists module_ref text,
    add column if not exists week_ref text;

do $deployment$
begin
    if to_regclass('curriculum.ksb_mappings') is not null then
        execute $backfill$
            update "Learner".learning_reflection_submissions as submission
               set ksb_weights = mapping.weights
              from (
                    select component_id::text as activity_id,
                           jsonb_object_agg(ksb_code, weight order by ksb_code) as weights
                      from curriculum.ksb_mappings
                     where component_id is not null
                       and ksb_code is not null
                       and ksb_code <> ''
                     group by component_id
                   ) as mapping
             where submission.activity_id = mapping.activity_id
               and submission.ksb_weights = '{}'::jsonb
        $backfill$;
    end if;
end
$deployment$;

create index if not exists idx_learning_reflections_learner
    on "Learner".learning_reflection_submissions (learner_kind, learner_id);
create index if not exists idx_learning_reflections_activity
    on "Learner".learning_reflection_submissions (activity_type, activity_id);
create index if not exists idx_learning_reflections_submitted
    on "Learner".learning_reflection_submissions (submitted_at desc);
create index if not exists idx_learning_reflections_queue
    on "Learner".learning_reflection_submissions
       (learner_id, status, submitted_at, id);
create unique index if not exists uq_learning_reflections_activity
    on "Learner".learning_reflection_submissions
       (learner_kind, learner_id, activity_type, activity_id);
create index if not exists idx_learning_reflections_progress_entry
    on "Learner".learning_reflection_submissions (progress_entry_id)
    where progress_entry_id is not null;
create index if not exists idx_learning_reflections_component_ref
    on "Learner".learning_reflection_submissions (component_ref)
    where component_ref is not null;
