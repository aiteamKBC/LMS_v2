-- Phase 4G post-reset Reader restoration plan.
-- STATUS: NOT EXECUTED. Supply reader_password as a psql variable at execution.
-- Target only: green-term-97168878 / br-orange-shadow-abm8uwwe /
-- ep-dawn-block-ab5vob3x / neondb.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'neondb'
     OR current_setting('neon.branch_id', true) <> 'br-orange-shadow-abm8uwwe'
     OR current_setting('neon.endpoint_id', true) <> 'ep-dawn-block-ab5vob3x'
     OR current_user <> 'neondb_owner'
  THEN
    RAISE EXCEPTION 'Benchmark Reader restoration target mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolname = 'lms_benchmark_reader')
  THEN
    RAISE EXCEPTION 'lms_benchmark_reader already exists';
  END IF;
END
$guard$;

CREATE ROLE lms_benchmark_reader LOGIN PASSWORD :'reader_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 4;

ALTER ROLE lms_benchmark_reader SET default_transaction_read_only = on;
ALTER ROLE lms_benchmark_reader SET statement_timeout = '30s';
ALTER ROLE lms_benchmark_reader SET lock_timeout = '2s';
ALTER ROLE lms_benchmark_reader SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE lms_benchmark_reader SET search_path = pg_catalog;

REVOKE ALL ON DATABASE neondb FROM lms_benchmark_reader;
GRANT CONNECT ON DATABASE neondb TO lms_benchmark_reader;

-- PostgreSQL grants TEMP to PUBLIC by default. This restores the previously
-- verified test-branch control. Review the effect on other test roles before
-- execution; do not apply this statement to the parent or Production.
REVOKE TEMPORARY ON DATABASE neondb FROM PUBLIC;

GRANT USAGE ON SCHEMA login, enrolment, "Learner", curriculum,
  "Audit", "Last_audit", fetching_evidence,
  structured_manual_activities, "Coach"
  TO lms_benchmark_reader;

GRANT SELECT ON login."Login_accounts", login."Login_sessions"
  TO lms_benchmark_reader;

GRANT SELECT ON enrolment."Created_users", enrolment."Extended_ILR",
  enrolment."Enrolment_Reviews"
  TO lms_benchmark_reader;

GRANT SELECT ON
  "Learner".learners,
  "Learner".learner_training_plan_modules,
  "Learner".learner_training_plan_weeks,
  "Learner".learner_training_plan_components,
  "Learner".learner_progress_entries,
  "Learner".learner_activity_sources,
  "Learner".learner_activity_reporting_segments,
  "Learner".learner_journal_rows,
  "Learner".learner_progress_historical_components,
  "Learner".learner_progress_ksbs,
  "Learner".learner_quiz_answers,
  "Learner".learner_quiz_chosen_answers,
  "Learner".learner_quiz_correct_answers,
  "Learner".learner_source_course_memberships,
  "Learner".learner_monthly_targets,
  "Learner".learner_activity_documents,
  "Learner"."Evidence",
  "Learner".evidence_files,
  "Learner".learning_reflection_submissions,
  "Learner".reviews,
  "Learner".review_sections,
  "Learner".review_documents,
  "Learner".progress_review_source_snapshots
  TO lms_benchmark_reader;

GRANT SELECT ON
  curriculum.programmes,
  curriculum.cohorts,
  curriculum.groups,
  curriculum.modules,
  curriculum.weeks,
  curriculum.components,
  curriculum.historical_components,
  curriculum.ksb_definitions,
  curriculum.ksb_mappings,
  curriculum.quizzes,
  curriculum.quiz_questions,
  curriculum.quiz_answers,
  curriculum.quiz_component_links,
  curriculum.quiz_course_links,
  curriculum.record_revisions,
  curriculum.source_courses,
  curriculum.source_activities,
  curriculum.source_materials,
  curriculum.live_sessions,
  curriculum.live_session_occurrences,
  curriculum.live_session_attendance,
  curriculum.review_types,
  curriculum.review_templates,
  curriculum.review_sections,
  curriculum.review_fields,
  curriculum.review_instances,
  curriculum.review_instance_answers,
  curriculum.review_instance_signatures,
  curriculum.review_occurrence_overrides
  TO lms_benchmark_reader;

GRANT SELECT ON
  "Audit".learner_match,
  "Audit".contract_document_archive,
  "Audit".ilr_learning_deliveries,
  "Audit".learner_evidence_overrides,
  "Last_audit".learners,
  "Last_audit".activities,
  "Last_audit".activity_actual_hours,
  "Last_audit".activity_planned_hours,
  "Last_audit".activity_results,
  "Last_audit".groups,
  "Last_audit".group_learners,
  "Last_audit".group_activities,
  "Last_audit".learner_assignments,
  "Last_audit".learner_attendance,
  "Last_audit".attendance_module_exclusions,
  "Last_audit".bank_holidays_england_wales,
  fetching_evidence.aptem_cv_contracts_probe,
  fetching_evidence.evidence_items,
  fetching_evidence.learner_evidence,
  structured_manual_activities.activity_ksbs,
  structured_manual_activities.learner_activity_ksbs,
  structured_manual_activities.learner_journal_row_ksbs,
  structured_manual_activities.manual_activity_hours_revision,
  "Coach".coach_calendar_event,
  "Coach".coach_calendar_event_learner_link,
  "Coach".coach_imported_review_instance,
  "Coach".coach_migrated_review_document,
  "Coach".coach_migrated_review_revision,
  "Coach".coach_migrated_review_signature,
  "Coach".coach_migrated_review_template,
  "Coach".review_source_reconciliation
  TO lms_benchmark_reader;

-- This function has a write path and was the only unsafe PUBLIC execution
-- grant found in the original Phase 4G.2 manifest review.
REVOKE EXECUTE ON FUNCTION
  "Coach".refresh_learner_absence_counts(integer, text)
  FROM PUBLIC;

COMMIT;

-- Required post-execution verification (run as the new Reader):
--   current_database() = neondb
--   current_user = lms_benchmark_reader
--   neon.branch_id = br-orange-shadow-abm8uwwe
--   neon.endpoint_id = ep-dawn-block-ab5vob3x
--   transaction_read_only = on
--   0 memberships, 0 owned application objects, 0 DML grants,
--   0 sequence privileges; explicit manifest SELECT succeeds; writes fail.
-- Rotate the Windows Credential Manager entry only after those checks pass.
