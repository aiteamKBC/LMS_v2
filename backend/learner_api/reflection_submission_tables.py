"""Idempotent Neon table setup for complete learner reflection submissions."""

from django.db import connections

_READY = False


def ensure_learning_reflection_submissions_table():
    global _READY
    if _READY:
        return

    with connections["enrolment"].cursor() as cur:
        cur.execute('create schema if not exists "Learner"')
        cur.execute(
            """
            create table if not exists "Learner"."learning_reflection_submissions" (
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
                planned_otjh                 text,
                status                      varchar(64) not null default 'submitted_for_tutor_review',
                learning_reflection         text not null,
                ksb_codes                   jsonb not null default '[]'::jsonb,
                ksb_explanations            jsonb not null default '{}'::jsonb,
                confidence_before           jsonb not null default '{}'::jsonb,
                confidence_after            jsonb not null default '{}'::jsonb,
                application_type            varchar(64),
                application_text            text,
                evidence_files              jsonb not null default '[]'::jsonb,
                evidence_consent_confirmed  boolean not null default false,
                selected_benefits            jsonb not null default '[]'::jsonb,
                benefit_explanation          text,
                actual_time_hours            text,
                completed_during_paid_hours  varchar(32),
                date_completed               date,
                otjh_confirmed                boolean not null default false,
                signed_declaration            boolean not null default false,
                quality_score                 smallint not null default 0,
                full_submission               jsonb not null default '{}'::jsonb,
                coach_feedback                text,
                reviewed_by                   text,
                reviewed_at                   timestamptz,
                submitted_at                  timestamptz not null default now()
            )
            """
        )
        cur.execute(
            'alter table "Learner"."learning_reflection_submissions" '
            'add column if not exists coach_feedback text'
        )
        cur.execute(
            'alter table "Learner"."learning_reflection_submissions" '
            'add column if not exists reviewed_by text'
        )
        cur.execute(
            'alter table "Learner"."learning_reflection_submissions" '
            'add column if not exists reviewed_at timestamptz'
        )
        cur.execute(
            'create index if not exists idx_learning_reflections_learner '
            'on "Learner"."learning_reflection_submissions" (learner_kind, learner_id)'
        )
        cur.execute(
            'create index if not exists idx_learning_reflections_activity '
            'on "Learner"."learning_reflection_submissions" (activity_type, activity_id)'
        )
        cur.execute(
            'create index if not exists idx_learning_reflections_submitted '
            'on "Learner"."learning_reflection_submissions" (submitted_at desc)'
        )
        cur.execute(
            'create unique index if not exists uq_learning_reflections_activity '
            'on "Learner"."learning_reflection_submissions" '
            '(learner_kind, learner_id, activity_type, activity_id)'
        )

    _READY = True
