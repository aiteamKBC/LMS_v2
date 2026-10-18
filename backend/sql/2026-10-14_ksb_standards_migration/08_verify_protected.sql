-- KSB standards migration -- READ-ONLY verification: fingerprints of everything the
-- migration must NOT change (signed records, history, evidence, Teams). Run after
-- 01_plan.sql (it reads the plan), before and after 02_apply.sql: every row must match.
-- READ-ONLY. Fingerprints of everything the KSB migration must NOT change.
-- count + order-independent 64-bit hash sum of each row's text form.
-- Tables the migration does touch are fingerprinted with the touched columns removed,
-- or restricted to rows outside the migration's plan.
with t(object, n, h) as (
  select 'curriculum.ksb_profiles', count(*), sum(hashtextextended(x::text, 7)) from curriculum.ksb_profiles x
  union all select 'curriculum.review_instances', count(*), sum(hashtextextended(x::text, 7)) from curriculum.review_instances x
  union all select 'curriculum.review_instance_answers', count(*), sum(hashtextextended(x::text, 7)) from curriculum.review_instance_answers x
  union all select 'curriculum.review_instance_signatures', count(*), sum(hashtextextended(x::text, 7)) from curriculum.review_instance_signatures x
  union all select 'curriculum.review_instance_reopens', count(*), sum(hashtextextended(x::text, 7)) from curriculum.review_instance_reopens x
  union all select 'curriculum.review_instance_manual_overrides', count(*), sum(hashtextextended(x::text, 7)) from curriculum.review_instance_manual_overrides x
  union all select 'curriculum.review_templates', count(*), sum(hashtextextended(x::text, 7)) from curriculum.review_templates x
  union all select 'curriculum.record_revisions', count(*), sum(hashtextextended(x::text, 7)) from curriculum.record_revisions x
  union all select 'curriculum.record_versions', count(*), sum(hashtextextended(x::text, 7)) from curriculum.record_versions x
  union all select 'curriculum.learner_review_additions', count(*), sum(hashtextextended(x::text, 7)) from curriculum.learner_review_additions x
  union all select 'Learner.reviews', count(*), sum(hashtextextended(x::text, 7)) from "Learner".reviews x
  union all select 'Learner.review_documents', count(*), sum(hashtextextended(x::text, 7)) from "Learner".review_documents x
  union all select 'Learner.review_sections', count(*), sum(hashtextextended(x::text, 7)) from "Learner".review_sections x
  union all select 'Learner.progress_review_runs', count(*), sum(hashtextextended(x::text, 7)) from "Learner".progress_review_runs x
  union all select 'Learner.progress_review_source_snapshots', count(*), sum(hashtextextended(x::text, 7)) from "Learner".progress_review_source_snapshots x
  union all select 'Learner.progress_review_signature_cache', count(*), sum(hashtextextended(x::text, 7)) from "Learner".progress_review_signature_cache x
  union all select 'Learner.learner_monthly_signatures', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_monthly_signatures x
  union all select 'Learner.learner_monthly_reports', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_monthly_reports x
  union all select 'Learner.learner_monthly_locks', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_monthly_locks x
  union all select 'Learner.learning_reflection_submissions', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learning_reflection_submissions x
  union all select 'Learner.learner_progress_entries', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_progress_entries x
  union all select 'Learner.evidence_items', count(*), sum(hashtextextended(x::text, 7)) from "Learner".evidence_items x
  union all select 'Learner.evidence_files', count(*), sum(hashtextextended(x::text, 7)) from "Learner".evidence_files x
  union all select 'Learner.learner_evidence', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_evidence x
  union all select 'Learner.Evidence', count(*), sum(hashtextextended(x::text, 7)) from "Learner"."Evidence" x
  union all select 'Learner.evidence_overrides', count(*), sum(hashtextextended(x::text, 7)) from "Learner".evidence_overrides x
  union all select 'Learner.learner_evidence_overrides', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_evidence_overrides x
  union all select 'Learner.learner_activity_ksbs', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_activity_ksbs x
  union all select 'Learner.learner_journal_row_ksbs', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_journal_row_ksbs x
  union all select 'Learner.evidence_report_ksbs', count(*), sum(hashtextextended(x::text, 7)) from "Learner".evidence_report_ksbs x
  union all select 'Learner.learner_ksbs', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_ksbs x
  union all select 'Learner.aptem_component_ksbs', count(*), sum(hashtextextended(x::text, 7)) from "Learner".aptem_component_ksbs x
  union all select 'Learner.learner_attendance_details', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_attendance_details x
  union all select 'Learner.manual_activity_hours_revision', count(*), sum(hashtextextended(x::text, 7)) from "Learner".manual_activity_hours_revision x
  union all select 'Learner.learner_activity_revisions (pre-existing, non-migration)', count(*), sum(hashtextextended(x::text, 7))
    from "Learner".learner_activity_revisions x where x.source_system is distinct from 'ksb-standards-migration'
  union all select 'Learner.learner_progress_ksbs (outside the plan)', count(*), sum(hashtextextended(x::text, 7))
    from "Learner".learner_progress_ksbs x
   where not exists (select 1 from ksb_mig.progress_plan p where p.progress_id = x.progress_id and p.position = x.position and p.action = 'repoint')
  union all select 'Learner.learner_ksb_assignments (learners outside the repin plan)', count(*), sum(hashtextextended(x::text, 7))
    from "Learner".learner_ksb_assignments x
   where not exists (select 1 from ksb_mig.pin_plan p where p.learner_id = x.learner_id and p.action = 'repin')
  union all select 'enrolment.Wizard_Ksb_Assessments', count(*), sum(hashtextextended(x::text, 7)) from enrolment."Wizard_Ksb_Assessments" x
  union all select 'enrolment.Wizard_Skills_Radar', count(*), sum(hashtextextended(x::text, 7)) from enrolment."Wizard_Skills_Radar" x
  union all select 'enrolment.Enrolment_Reviews', count(*), sum(hashtextextended(x::text, 7)) from enrolment."Enrolment_Reviews" x
  union all select 'Audit.monthly_audit_signoffs', count(*), sum(hashtextextended(x::text, 7)) from "Audit".monthly_audit_signoffs x
  union all select 'Audit.learner_evidence_overrides', count(*), sum(hashtextextended(x::text, 7)) from "Audit".learner_evidence_overrides x
  union all select 'Coach.coach_migrated_review_signature', count(*), sum(hashtextextended(x::text, 7)) from "Coach".coach_migrated_review_signature x
  union all select 'Coach.coach_migrated_review_document', count(*), sum(hashtextextended(x::text, 7)) from "Coach".coach_migrated_review_document x
  union all select 'Coach.coach_imported_review_instance', count(*), sum(hashtextextended(x::text, 7)) from "Coach".coach_imported_review_instance x
  -- Teams / calendar
  union all select 'curriculum.live_session_occurrences', count(*), sum(hashtextextended(x::text, 7)) from curriculum.live_session_occurrences x
  union all select 'curriculum.live_session_attendance', count(*), sum(hashtextextended(x::text, 7)) from curriculum.live_session_attendance x
  union all select 'curriculum.live_session_learner_attendance', count(*), sum(hashtextextended(x::text, 7)) from curriculum.live_session_learner_attendance x
  union all select 'curriculum.live_session_recording_views', count(*), sum(hashtextextended(x::text, 7)) from curriculum.live_session_recording_views x
  union all select 'curriculum.teams_calendar_sync_state', count(*), sum(hashtextextended(x::text, 7)) from curriculum.teams_calendar_sync_state x
  union all select 'curriculum.teams_calendar_integrity_events', count(*), sum(hashtextextended(x::text, 7)) from curriculum.teams_calendar_integrity_events x
  union all select 'curriculum.teams_calendar_create_claims', count(*), sum(hashtextextended(x::text, 7)) from curriculum.teams_calendar_create_claims x
  union all select 'curriculum.teams_schedule_emails', count(*), sum(hashtextextended(x::text, 7)) from curriculum.teams_schedule_emails x
  union all select 'curriculum.module_teams_shares', count(*), sum(hashtextextended(x::text, 7)) from curriculum.module_teams_shares x
  union all select 'Coach.coach_meeting_artifacts', count(*), sum(hashtextextended(x::text, 7)) from "Coach".coach_meeting_artifacts x
  union all select 'Coach.coach_meeting_attendance', count(*), sum(hashtextextended(x::text, 7)) from "Coach".coach_meeting_attendance x
  union all select 'Coach.coach_meeting_attendance_reports', count(*), sum(hashtextextended(x::text, 7)) from "Coach".coach_meeting_attendance_reports x
  union all select 'Coach.coach_meeting_summaries', count(*), sum(hashtextextended(x::text, 7)) from "Coach".coach_meeting_summaries x
  -- Touched tables, touched columns removed
  union all select 'curriculum.modules (minus ksb_profile_source_id, updated_at)', count(*),
    sum(hashtextextended((to_jsonb(x) - 'ksb_profile_source_id' - 'updated_at')::text, 7)) from curriculum.modules x
  union all select 'curriculum.programmes (minus ksb_profile_source_id, updated_at)', count(*),
    sum(hashtextextended((to_jsonb(x) - 'ksb_profile_source_id' - 'updated_at')::text, 7)) from curriculum.programmes x
  union all select 'curriculum.components (minus ksb_mappings)', count(*),
    sum(hashtextextended((to_jsonb(x) - 'ksb_mappings')::text, 7)) from curriculum.components x
  union all select 'curriculum.weeks', count(*), sum(hashtextextended(x::text, 7)) from curriculum.weeks x
  union all select 'curriculum.ksb_mappings (outside the plan)', count(*), sum(hashtextextended(x::text, 7))
    from curriculum.ksb_mappings x where not exists (select 1 from ksb_mig.mapping_plan p where p.mapping_id = x.id)
  union all select 'curriculum.ksb_profile_versions (pre-existing)', count(*), sum(hashtextextended(x::text, 7))
    from curriculum.ksb_profile_versions x where x.source_profile_id not in ('standard:st0596-v1-0', 'standard:st0612-v1-0')
  union all select 'curriculum.ksb_definitions (pre-existing versions)', count(*), sum(hashtextextended(x::text, 7))
    from curriculum.ksb_definitions x join curriculum.ksb_profile_versions v on v.id = x.profile_version_id
   where v.source_profile_id not in ('standard:st0596-v1-0', 'standard:st0612-v1-0')
  union all select 'curriculum.standard_ksbs', count(*), sum(hashtextextended(x::text, 7)) from curriculum.standard_ksbs x
)
select object, n, h::text as fingerprint from t order by object;
