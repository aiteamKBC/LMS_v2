from django.urls import path

from system_audit import activity as system_activity

from . import activity, learner_assignments, programme_audit, quality, review_schedule, review_types, reviews, views
from .teams_schedule_delivery import schedule_email
from .teams_calendar_state import sync_calendar_state
from .teams_directory import search_teams_directory
from .teams_calendar_actions import calendar_action
from . import session_results


urlpatterns = [
    path('curriculum/modules/<str:module_id>/session-results/', session_results.module_results),
    path('curriculum/session-results/<str:series_id>/sync/', session_results.queue_sync),
    path('curriculum/session-results/<str:series_id>/sessions/<int:session_number>/', session_results.admin_session),
    path('curriculum/session-results/<str:series_id>/artifacts/<str:artifact_id>/', session_results.admin_content),
    path('curriculum/session-results/<str:series_id>/artifacts/<str:artifact_id>/visibility/', session_results.recording_visibility),
    path('curriculum/session-results/<str:series_id>/sessions/<int:session_number>/attendance.csv', session_results.export_attendance),
    path('curriculum/session-results/<str:series_id>/sessions/<int:session_number>/attendance.pdf', session_results.export_attendance, {'file_format': 'pdf'}),
    path('curriculum/teams-directory/', search_teams_directory, name='curriculum-teams-directory'),
    path('curriculum/cohorts/<str:identifier>/learner-assignments/', learner_assignments.cohort_learner_assignments, name='curriculum-cohort-learner-assignments'),
    path('curriculum/modules/<str:identifier>/learner-assignments/', learner_assignments.module_learner_assignments, name='curriculum-module-learner-assignments'),
    path('curriculum/programmes/<str:programme_id>/reviews/', reviews.curriculum_programme_review_collection, name='curriculum-programme-reviews'),
    path('curriculum/programmes/<str:programme_id>/reviews/clone/', reviews.curriculum_review_clone, name='curriculum-programme-reviews-clone'),
    path('curriculum/programmes/<str:programme_id>/reviews/schedule/', review_schedule.curriculum_programme_review_schedule, name='curriculum-programme-reviews-schedule'),
    path('curriculum/programmes/<str:programme_id>/reviews/clashes/resolve/', review_schedule.curriculum_programme_review_clash_resolve, name='curriculum-programme-reviews-clash-resolve'),
    # Before the '<str:review_id>' route below, or 'types' is read as a review id.
    path('curriculum/review-types/', review_types.curriculum_review_type_collection, name='curriculum-review-types'),
    path('curriculum/review-types/<str:review_type_id>/', review_types.curriculum_review_type_detail, name='curriculum-review-type-detail'),
    path('curriculum/reviews/<str:review_id>/', reviews.curriculum_review_detail, name='curriculum-review-detail'),
    path('curriculum/overview/', views.curriculum_overview, name='curriculum-overview'),
    path('curriculum/stats/', views.curriculum_stats, name='curriculum-stats'),
    # Polled by every open tab to notice a write made somewhere else. Kept next
    # to nothing in cost: one Redis read, no database.
    path('curriculum/cache-epoch/', views.curriculum_cache_epoch, name='curriculum-cache-epoch'),
    path('curriculum/preview/cohort-end-date/', views.curriculum_preview_cohort_end_date, name='curriculum-preview-cohort-end-date'),
    path('curriculum/preview/module-session-plan/', views.curriculum_preview_module_session_plan, name='curriculum-preview-module-session-plan'),
    path('curriculum/preview/tutor-availability/', views.curriculum_preview_tutor_availability, name='curriculum-preview-tutor-availability'),
    # The learner roster and the achievement roll-up are the same read at every
    # level of Programme -> Cohort -> Group -> Module -> Week. These two routes
    # take the scope as a query param; the per-level routes below are the same
    # thing addressed by path.
    path('curriculum/learner-roster/', views.curriculum_scope_learner_roster, name='curriculum-scope-learner-roster'),
    path('curriculum/learner-ksb-impact/', views.curriculum_scope_learner_ksb_impact, name='curriculum-scope-learner-ksb-impact'),
    path('curriculum/programmes/', views.curriculum_programme_collection, name='curriculum-programmes'),
    path('curriculum/programmes/tree/', views.curriculum_programme_tree_save, name='curriculum-programme-tree-save'),
    # Before the <identifier> detail route, or 'reorder' reads as a programme id.
    path('curriculum/programmes/reorder/', views.curriculum_programme_reorder, name='curriculum-programmes-reorder'),
    path('curriculum/free-programmes/<str:programme_id>/modules/', views.curriculum_free_programme_modules, name='curriculum-free-programme-modules'),
    path('curriculum/free-programmes/<str:programme_id>/convert/', views.curriculum_free_programme_convert, name='curriculum-free-programme-convert'),
    path('curriculum/programmes/<str:identifier>/detail/', views.curriculum_programme_tree_detail, name='curriculum-programme-tree-detail'),
    path('curriculum/programmes/<str:programme_id>/audit-assets/', programme_audit.programme_audit_assets, name='curriculum-programme-audit-assets'),
    path('curriculum/programme-audit/status/', programme_audit.programme_audit_status, name='curriculum-programme-audit-status'),
    path('curriculum/programme-audit/materials/', programme_audit.programme_audit_materials, name='curriculum-programme-audit-materials'),
    path('curriculum/programme-audit/materials/<slug:material_key>/', programme_audit.programme_audit_material, name='curriculum-programme-audit-material'),
    path('curriculum/programmes/<str:programme_id>/ksb-coverage/', views.curriculum_programme_ksb_coverage, name='curriculum-programme-ksb-coverage'),
    path('curriculum/programmes/<str:programme_id>/learner-ksb-impact/', views.curriculum_programme_learner_ksb_impact, name='curriculum-programme-learner-ksb-impact'),
    path('curriculum/programmes/<str:programme_id>/learner-roster/', views.curriculum_programme_learner_roster, name='curriculum-programme-learner-roster'),
    path('curriculum/programmes/<str:programme_id>/cohorts/', views.curriculum_programme_cohort_collection, name='curriculum-programme-cohorts'),
    path('curriculum/programmes/<str:identifier>/restore/', views.curriculum_programme_restore, name='curriculum-programme-restore'),
    path('curriculum/programmes/<str:identifier>/', views.curriculum_programme_detail, name='curriculum-programme-detail'),
    path('curriculum/quality/audit-trail/', quality.curriculum_quality_audit_trail, name='curriculum-quality-audit-trail'),
    # Who used the LMS, as opposed to what they changed. The record endpoint is
    # written to by the browser on navigation; the two reads answer the Audit
    # Trail's People view, for one workspace or for all of them.
    #
    # Served under two sets of names. The `curriculum/activity/...` paths are
    # the ones already in production and keep working unchanged. The
    # `activity/...` paths are the system-wide names the admin Audit Trail
    # calls. They are the same views: the scope is a query parameter
    # (`?workspace=`), never a second implementation.
    #
    # Both stay below the `curriculum_api/` prefix on purpose -- production
    # LiteSpeed forwards the established `*_api` prefixes to Django and an
    # unknown one falls through to the SPA, so a new prefix would be a
    # deployment change rather than a code change.
    path('curriculum/activity/record/', activity.curriculum_activity_record, name='curriculum-activity-record'),
    path('curriculum/activity/people/', activity.curriculum_activity_people, name='curriculum-activity-people'),
    path('curriculum/activity/people/<str:email>/', activity.curriculum_activity_person, name='curriculum-activity-person'),
    path('activity/record/', system_activity.activity_record, name='system-activity-record'),
    path('activity/people/', system_activity.activity_people, name='system-activity-people'),
    path('activity/people/<str:email>/', system_activity.activity_person, name='system-activity-person'),
    path('curriculum/quality/versions/', quality.curriculum_quality_versions, name='curriculum-quality-versions'),
    path('curriculum/quality/versions/<str:entity_type>/<path:entity_id>/', quality.curriculum_quality_record_history, name='curriculum-quality-record-history'),
    path('curriculum/standards/', views.curriculum_standards, name='curriculum-standards'),
    path('curriculum/standards/<str:identifier>/', views.curriculum_standard_detail, name='curriculum-standard-detail'),
    path('curriculum/modules/', views.curriculum_module_collection, name='curriculum-modules'),
    path('curriculum/modules/resolve-structures/', views.curriculum_module_structure_resolve, name='curriculum-module-structure-resolve'),
    # Before the '<str:identifier>' route below, or 'archived' is read as a module id.
    path('curriculum/modules/archived/', views.curriculum_archived_modules, name='curriculum-modules-archived'),
    path('curriculum/modules/<str:module_catalogue_id>/archived-structure/', views.curriculum_archived_module_structure, name='curriculum-module-archived-structure'),
    path('curriculum/modules/<str:identifier>/restore/', views.curriculum_module_restore, name='curriculum-module-restore'),
    path('curriculum/modules/<str:module_catalogue_id>/structure/', views.curriculum_module_structure, name='curriculum-module-structure'),
    path('curriculum/modules/<str:module_catalogue_id>/settings/', views.curriculum_module_settings, name='curriculum-module-settings'),
    path('curriculum/modules/<str:module_catalogue_id>/session-plan/', views.curriculum_module_session_plan, name='curriculum-module-session-plan'),
    path('curriculum/modules/<str:module_catalogue_id>/ai-material/', views.curriculum_module_ai_material, name='curriculum-module-ai-material'),
    path('curriculum/modules/<str:module_catalogue_id>/teams-meetings/restore/', views.curriculum_module_teams_meeting_restore, name='curriculum-module-teams-meeting-restore'),
    path('curriculum/modules/<str:module_catalogue_id>/meeting-invitees/', views.curriculum_module_meeting_invitees, name='curriculum-module-meeting-invitees'),
    path('curriculum/modules/<str:module_catalogue_id>/ksb-coverage/', views.curriculum_module_ksb_coverage, name='curriculum-module-ksb-coverage'),
    # A module has no roster of its own: these report the learners in the group
    # that delivers it, and what they achieved against this module's components.
    path('curriculum/modules/<str:module_catalogue_id>/learner-roster/', views.curriculum_module_learner_roster, name='curriculum-module-learner-roster'),
    path('curriculum/modules/<str:module_catalogue_id>/learner-ksb-impact/', views.curriculum_module_learner_ksb_impact, name='curriculum-module-learner-ksb-impact'),
    path('curriculum/modules/<str:module_catalogue_id>/components/<str:component_id>/', views.curriculum_module_component_detail, name='curriculum-module-component-detail'),
    path('curriculum/modules/<str:module_catalogue_id>/weeks/<str:week_id>/', views.curriculum_module_week_detail, name='curriculum-module-week-detail'),
    path('curriculum/modules/<str:identifier>/', views.curriculum_module_detail, name='curriculum-module-detail'),
    path('curriculum/module-catalogue/', views.curriculum_module_collection, name='curriculum-module-catalogue'),
    path('curriculum/module-catalogue/<str:identifier>/', views.curriculum_module_detail, name='curriculum-module-catalogue-detail'),
    path('curriculum/week-templates/', views.curriculum_week_template_collection, name='curriculum-week-templates'),
    path('curriculum/week-templates/<str:identifier>/', views.curriculum_week_template_detail, name='curriculum-week-template-detail'),
    path('curriculum/week-components/<str:component_id>/upload/', views.curriculum_week_component_upload, name='curriculum-week-component-upload'),
    # Must precede curriculum/components/<component_id>/, or "library" would be
    # captured as a component id.
    path('curriculum/components/library/', views.curriculum_component_library, name='curriculum-component-library'),
    path('curriculum/components/', views.curriculum_component_collection, name='curriculum-components'),
    path('curriculum/components/<str:component_id>/upload/', views.curriculum_component_upload, name='curriculum-component-upload'),
    path('curriculum/components/<str:component_id>/ksb-mappings/', views.curriculum_component_ksb_mappings, name='curriculum-component-ksb-mappings'),
    path('curriculum/components/<str:component_id>/', views.curriculum_component_detail, name='curriculum-component-detail'),
    path('curriculum/teams-meetings/', views.curriculum_teams_meeting, name='curriculum-teams-meeting'),
    path('curriculum/teams-meetings/summary/', views.curriculum_teams_meeting_summary, name='curriculum-teams-meeting-summary'),
    path('curriculum/live-sessions/occurrences/', views.curriculum_live_session_occurrences, name='curriculum-live-session-occurrences'),
    path('curriculum/teams-meetings/<str:live_session_id>/schedule/', views.curriculum_teams_meeting_schedule, name='curriculum-teams-meeting-schedule'),
    path('curriculum/teams-meetings/<str:live_session_id>/schedule-email/', schedule_email, name='curriculum-teams-schedule-email'),
    path('curriculum/teams-meetings/<str:live_session_id>/calendar-state/', sync_calendar_state, name='curriculum-teams-calendar-state'),
    path('curriculum/teams-meetings/<str:live_session_id>/actions/', calendar_action, name='curriculum-teams-calendar-action'),
    path('curriculum/teams-meetings/<str:live_session_id>/occurrences/<int:session_number>/schedule/', views.curriculum_teams_meeting_occurrence_schedule, name='curriculum-teams-meeting-occurrence-schedule'),
    path('curriculum/teams-meetings/<str:live_session_id>/occurrences/<str:occurrence_id>/join/', views.curriculum_teams_meeting_join, name='curriculum-teams-meeting-join'),
    path('curriculum/teams-meetings/<str:live_session_id>/artifacts/', views.curriculum_teams_meeting_artifacts, name='curriculum-teams-meeting-artifacts'),
    path('curriculum/teams-meetings/<str:live_session_id>/artifacts/<str:artifact_id>/content/', views.curriculum_teams_meeting_artifact_content, name='curriculum-teams-meeting-artifact-content'),
    path('curriculum/teams-meetings/<str:live_session_id>/artifacts/<str:artifact_id>/recording-events/', views.curriculum_teams_recording_events, name='curriculum-teams-recording-events'),
    path('curriculum/presentations/slides/', views.curriculum_presentation_slides, name='curriculum-presentation-slides'),
    path('curriculum/uploads/<path:path>', views.curriculum_uploaded_file, name='curriculum-uploaded-file'),
    path('curriculum/weeks/<str:week_id>/ksb-coverage/', views.curriculum_week_ksb_coverage, name='curriculum-week-ksb-coverage'),
    path('curriculum/weeks/<str:week_id>/learner-roster/', views.curriculum_week_learner_roster, name='curriculum-week-learner-roster'),
    path('curriculum/weeks/<str:week_id>/learner-ksb-impact/', views.curriculum_week_learner_ksb_impact, name='curriculum-week-learner-ksb-impact'),
    path('curriculum/ksb-mappings/<str:mapping_id>/', views.curriculum_ksb_mapping_detail, name='curriculum-ksb-mapping-detail'),
    path('curriculum/ksb-coverage/', views.curriculum_ksb_coverage, name='curriculum-ksb-coverage'),
    path('curriculum/ksb-coverage/trace/<str:ksb_id>/', views.curriculum_ksb_trace, name='curriculum-ksb-trace'),
    path('curriculum/readiness/ksb-coverage/', views.curriculum_readiness_validation, name='curriculum-readiness-ksb-coverage'),
    path('curriculum/ksb-frameworks/', views.curriculum_ksb_framework_collection, name='curriculum-ksb-frameworks'),
    path('curriculum/ksb-frameworks/<str:identifier>/', views.curriculum_ksb_framework_detail, name='curriculum-ksb-framework-detail'),
    path('curriculum/ksb-profiles/', views.curriculum_ksb_framework_collection, name='curriculum-ksb-profiles'),
    path('curriculum/ksb-profiles/<str:identifier>/', views.curriculum_ksb_framework_detail, name='curriculum-ksb-profile-detail'),
    path('curriculum/ksb-sets/', views.curriculum_ksb_sets, name='curriculum-ksb-sets'),
    path('curriculum/cohorts/', views.curriculum_cohort_collection, name='curriculum-cohorts'),
    # Before the '<str:identifier>' routes below, or 'archived' is read as a cohort id.
    path('curriculum/cohorts/archived/', views.curriculum_archived_cohorts, name='curriculum-cohorts-archived'),
    path('curriculum/cohorts/<str:cohort_id>/ksb-coverage/', views.curriculum_cohort_ksb_coverage, name='curriculum-cohort-ksb-coverage'),
    path('curriculum/cohorts/<str:cohort_id>/learner-roster/', views.curriculum_cohort_learner_roster, name='curriculum-cohort-learner-roster'),
    path('curriculum/cohorts/<str:cohort_id>/learner-ksb-impact/', views.curriculum_cohort_learner_ksb_impact, name='curriculum-cohort-learner-ksb-impact'),
    path('curriculum/cohorts/<str:cohort_id>/groups/', views.curriculum_cohort_group_collection, name='curriculum-cohort-groups'),
    path('curriculum/cohorts/<str:identifier>/restore/', views.curriculum_cohort_restore, name='curriculum-cohort-restore'),
    path('curriculum/cohorts/<str:identifier>/', views.curriculum_cohort_detail, name='curriculum-cohort-detail'),
    path('curriculum/groups/', views.curriculum_group_collection, name='curriculum-groups'),
    path('curriculum/groups/archived/', views.curriculum_archived_groups, name='curriculum-groups-archived'),
    # Declared before the <identifier> route below, which would otherwise
    # capture these as group ids.
    path('curriculum/groups/<str:group_id>/ksb-coverage/', views.curriculum_group_ksb_coverage, name='curriculum-group-ksb-coverage'),
    path('curriculum/groups/<str:group_id>/learner-roster/', views.curriculum_group_learner_roster, name='curriculum-group-learner-roster'),
    path('curriculum/groups/<str:group_id>/learner-ksb-impact/', views.curriculum_group_learner_ksb_impact, name='curriculum-group-learner-ksb-impact'),
    path('curriculum/groups/<str:identifier>/restore/', views.curriculum_group_restore, name='curriculum-group-restore'),
    path('curriculum/groups/<str:identifier>/', views.curriculum_group_detail, name='curriculum-group-detail'),
    path('curriculum/groups/<str:identifier>/modules/', views.curriculum_group_modules, name='curriculum-group-modules'),
    path('curriculum/group-modules/<str:identifier>/', views.curriculum_module_detail, name='curriculum-group-module-detail'),
    path('curriculum/sessions/', views.curriculum_session_collection, name='curriculum-sessions'),
    path('curriculum/sessions/<str:identifier>/', views.curriculum_session_detail, name='curriculum-session-detail'),
    path('curriculum/staffing/', views.curriculum_staffing_collection, name='curriculum-staffing'),
    path('curriculum/staffing/<str:identifier>/', views.curriculum_staffing_detail, name='curriculum-staffing-detail'),
    path('curriculum/holidays/', views.curriculum_holiday_collection, name='curriculum-holidays'),
    path('curriculum/holidays/<str:identifier>/', views.curriculum_holiday_detail, name='curriculum-holiday-detail'),
    # The GOV.UK half of the calendar on its own, in the feed's own shape
    # (title, notes, bunting) rather than the label/start/end one the rest of
    # the curriculum reads holidays through. Read-only: these are not authored
    # here, they are mirrored, and the two routes below are how the mirror is
    # kept current and how it reports what GOV.UK changed.
    path('curriculum/england-holidays/', views.curriculum_england_holidays, name='curriculum-england-holidays'),
    # Declared before nothing in particular -- there is no <identifier> route on
    # england-holidays -- but kept adjacent so the three read as one feature.
    path('curriculum/england-holidays/syncs/', views.curriculum_england_holiday_syncs, name='curriculum-england-holiday-syncs'),
    path('curriculum/england-holidays/refresh/', views.curriculum_england_holidays_refresh, name='curriculum-england-holidays-refresh'),
    # The tutor workspace's own read: assigned modules + the next live session.
    # Declared before the <identifier> route below, which would otherwise
    # capture 'tutor-workspace' as a tutor id.
    path('curriculum/tutor-workspace/', views.curriculum_tutor_workspace, name='curriculum-tutor-workspace'),
    path('curriculum/tutors/', views.curriculum_tutors, name='curriculum-tutors'),
    path('curriculum/tutors/<str:identifier>/', views.curriculum_tutor_detail, name='curriculum-tutor-detail'),
    path('curriculum/coaches/', views.curriculum_coaches, name='curriculum-coaches'),
    path('curriculum/coaches/<str:identifier>/', views.curriculum_coach_detail, name='curriculum-coach-detail'),
]
