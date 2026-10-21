export interface InfoSource {
  id: string;
  section: string;
  title: string;
  description: string;
  sources: { table: string; fields: string; purpose: string; database?: string }[];
  explanation: string;
  references: string[];
}

// A code-reviewed reference, not a live schema inspector. Keep entries aligned
// with the named readers when their source contracts change.
export const coachInfoSources: InfoSource[] = [
  {
    id: 'caseload', section: 'Dashboard', title: 'Total learners & learner details',
    description: 'The coach’s caseload, learner names, programme, cohort, group and status.',
    sources: [
      { table: '"Learner".learners', fields: 'id, enrolment_id, full_name, email, learner_type, coach_email, programme, programme_status, cohort, group_name', purpose: 'Permanent learner profile and coach ownership.' },
      { table: 'enrolment."Created_users"', fields: 'id, "Username", "Email", "Programme_status"', purpose: 'Linked enrolment details and source programme status.' },
    ],
    explanation: 'The caseload is scoped by normalized coach_email. Dashboard readers apply the existing hidden-programme-status rules before counting learners. Learner profile IDs and enrolment IDs are separate; join learners.enrolment_id to Created_users.id.',
    references: ['backend/coach_api/views.py → fetch_caseload_learner_profiles', 'backend/coach_api/services/dashboard/service.py → normalize_start_dates'],
  },
  {
    id: 'dates', section: 'Dashboard', title: 'Learner start date',
    description: 'The Start Date column in the All Learners table.',
    sources: [
      { table: 'enrolment."Created_users"', fields: 'id, "Learner_start_date"', purpose: 'Authoritative display date, reached through the profile’s enrolment_id.' },
    ],
    explanation: 'caseload_profile_start_date parses Learner_start_date. A missing or invalid date stays unavailable. This display date is separate from the programme window used to calculate OTJH targets.',
    references: ['backend/coach_api/views.py → caseload_profile_start_date', 'backend/coach_api/services/dashboard/profile_dates.py'],
  },
  {
    id: 'otjh', section: 'Dashboard', title: 'OTJH hours, progress & risk',
    description: 'Actual hours, planned hours, target to date and the OTJH risk indicators.',
    sources: [
      { table: '"Learner".learner_progress_entries', fields: 'learner_id, actual_seconds, accepted, deleted_at, component_ref', purpose: 'Accepted, non-deleted activity time; learner_id is the profile ID.' },
      { table: '"Learner".learner_monthly_targets', fields: 'learner_id, enrolment_id, programme_id, programme_profile_id, report_month, target_hours', purpose: 'Monthly targets matching the learner’s programme and enrolment.' },
      { table: 'enrolment."Created_users"', fields: '"Start_date", "End_date", "Learner_start_date", "Learner_end_date", "Apprenticeship_End_date", "Practical_period_end_date"', purpose: 'Programme window, with Learner.learners start_date/end_date as fallbacks.' },
    ],
    explanation: 'Stored accepted seconds are converted to hours. The canonical reader also resolves eligible current LMS saves whose seconds are not stored yet, using marking decisions without double counting. Planned hours come from monthly targets. The backend derives target-to-date, shortfall and RAG from the programme window; missing facts remain unavailable.',
    references: ['backend/learner_api/canonical_learning.py → otjh_summary_bulk', 'backend/learner_api/canonical_hours.py → pending_hour_records', 'backend/coach_api/services/dashboard/otjh.py', 'backend/coach_api/selectors/otjh.py'],
  },
  {
    id: 'activities', section: 'Dashboard', title: 'Activities & learning progress',
    description: 'Completed and total activities, progress percentage and supporting KSB evidence.',
    sources: [
      { table: '"Learner".learner_progress_entries', fields: 'id, learner_id, activity_status, accepted, component_ref, source_system, reporting_month, deleted_at', purpose: 'Canonical activity records for the learner.' },
      { table: '"Learner".learner_progress_ksbs', fields: 'progress_id, ksb_code, ksb_description', purpose: 'KSB evidence attached to each progress record.' },
      { table: '"Learner".learner_activity_sources', fields: 'canonical_progress_id, activity_status, completed', purpose: 'Retained source evidence used by completion resolution.' },
    ],
    explanation: 'The Dashboard uses the canonical learner metrics. Completion is resolved from each activity and its source evidence; accepted evidence controls credited hours and KSB points. An activity completion percentage is calculated, rather than read from a single stored percentage column.',
    references: ['backend/learner_api/canonical_learning.py → counts_as_completed, metrics_from_records, metrics_bulk', 'backend/coach_api/views.py → caseload_canonical_metrics'],
  },
  {
    id: 'snapshot', section: 'Dashboard', title: 'Dashboard summary & cached values',
    description: 'How the summary, learner list, upcoming meetings and risk panels are served.',
    sources: [
      { table: '"Coach".coach_dashboard_snapshot', fields: 'owner_email, payload, schema_version, refreshed_at', purpose: 'Persisted dashboard projection for one coach, rebuilt from source records.' },
    ],
    explanation: 'The dashboard endpoints serve cached or persisted projections. Source tables remain authoritative; dates, hidden statuses and OTJH can be refreshed at read time. A configured shared read model is another supported read path. This snapshot is not a table to edit to correct learner records.',
    references: ['backend/coach_api/dashboard_view.py → coach_dashboard_section', 'backend/coach_api/services/dashboard/service.py → build', 'backend/coach_api/services/dashboard/sections.py'],
  },
  {
    id: 'reviews', section: 'Meetings', title: 'Monthly Coaching, Progress Reviews & Review',
    description: 'Curriculum review occurrences, forms, answers, signatures and completion status.',
    sources: [
      { table: 'curriculum.review_instances', fields: 'id, learner_id, learner_kind, review_template_id, target_date, calendar_event_id, definition_snapshot, progress_snapshot, status, completed_at', purpose: 'A learner’s opened review instance and its saved definition.' },
      { table: 'curriculum.review_instance_answers', fields: 'review_instance_id, field_id, answer, answered_by, answered_at', purpose: 'Saved answers for that instance.' },
      { table: 'curriculum.review_instance_signatures', fields: 'review_instance_id, role, signed_by, signed_at, signature', purpose: 'Signatures linked to the same review instance.' },
      { table: '"Coach".coach_calendar_event', fields: 'id, event_key, learner_id, event_type, scheduled_date, scheduled_time, status', purpose: 'Linked booking state for scheduled reviews.' },
    ],
    explanation: 'Curriculum generates planned occurrences; an instance is created when the review is first opened. The saved definition governs its questions and signatures. Dashboard Last PR / Last MCM dates are derived from completed events in the matching category, including imported review history.',
    references: ['backend/curriculum_api/review_instances.py', 'backend/coach_api/services/dashboard/service.py → refresh'],
  },
  {
    id: 'imported-reviews', section: 'Meetings', title: 'Imported review history',
    description: 'Historical Aptem reviews and their LMS continuation records.',
    sources: [
      { table: '"Learner".reviews', fields: 'id, learner_id, aptem_review_id, review_type, planned_scheduled_date, completed_date, status, review_data', purpose: 'Retained imported review history.' },
      { table: '"Learner".review_sections', fields: 'review_id, section_name, section_order, fields_json, tables_json', purpose: 'Imported form sections.' },
      { table: '"Coach".coach_imported_review_instance', fields: 'owner_email, event_key, learner_id, source_review_id, answers, status, progress_snapshot, completed_at', purpose: 'Coach-owned continuation state layered over the imported review.' },
    ],
    explanation: 'The imported record and its editable continuation are distinct. source_review_id links the continuation to the original review; event_key identifies its meeting occurrence. Last PR excludes imported reviews belonging to other review categories.',
    references: ['backend/learner_api/review_history.py', 'backend/coach_api/models.py → ImportedReviewInstance', 'backend/coach_api/migrated_reviews.py'],
  },
  {
    id: 'calendar', section: 'Meetings', title: 'Calendar, weekly meetings & Catch-up Queue',
    description: 'Booking dates, meeting links, catch-up associations and calendar sync status.',
    sources: [
      { table: '"Coach".coach_calendar_event', fields: 'event_key, owner_email, learner_id, event_type, target_date, scheduled_date, scheduled_time, status, sync_state', purpose: 'Saved booking state, scoped to the coach and learner.' },
      { table: '"Coach".coach_absence_report', fields: 'learner_id, status, catchup_event_key', purpose: 'Absence follow-up and the associated catch-up event.' },
      { table: 'curriculum.live_session_occurrences', fields: 'id, live_session_id', purpose: 'Tracked live-session occurrences also included in the timetable.' },
    ],
    explanation: 'Calendar and weekly counts combine resolved review events, standalone bookings and tracked live sessions. The Dashboard applies its backend work-week window. A local booking status and its Microsoft sync_state describe different things; saved locally does not mean synchronized successfully.',
    references: ['backend/coach_api/models.py → CoachCalendarEvent, CoachAbsenceReport', 'backend/coach_api/services/dashboard/upcoming.py', 'backend/coach_api/views.py → coach_timetable'],
  },
  {
    id: 'attendance', section: 'Attendance', title: 'Attendance records & corrections',
    description: 'Teams evidence, legacy attendance, manual entries and learner-specific corrections.',
    sources: [
      { table: '"Learner".learner_attendance_details', fields: 'learner_profile_id, enrolment_id, occurrence_id, source, attended_seconds, is_expected, session_date', purpose: 'Attendance reporting rows; verified Teams reads select expected Microsoft Teams occurrences.' },
      { table: '"Coach".coach_manual_attendance', fields: 'learner_id, enrolment_id, session_date, module_name, session_title, status', purpose: 'Manually recorded attendance.' },
      { table: '"Coach".coach_attendance_adjustment', fields: 'learner_id, source, source_id, status, is_deleted', purpose: 'Correction for one learner and one source row.' },
      { table: 'public.kbc_attendance', fields: '"ID", "Email", "key", "date", "Attendance", attendance_status, module, lecture_name', purpose: 'Legacy attendance matched by Aptem ID, with email fallback when that ID is absent.', database: 'Separate KBC attendance database' },
    ],
    explanation: 'The attendance reader combines the supported sources and applies learner-specific adjustments. The verified_teams_attendance view filters learner_attendance_details by source and expected attendance. Dashboard attendance is derived by these readers, not by counting every raw row as a separate attended session.',
    references: ['backend/learner_api/teams_attendance.py', 'backend/learner_api/attendance.py', 'backend/coach_api/models.py → CoachManualAttendance, CoachAttendanceSourceAdjustment', 'backend/coach_api/views.py → dashboard_attendance_rows'],
  },
  {
    id: 'marking', section: 'Marking', title: 'Pending marking & submission decisions',
    description: 'The marking queue, submitted evidence and the Dashboard pending-marking count.',
    sources: [
      { table: '"Learner".learning_reflection_submissions', fields: 'id, learner_id, learner_kind, activity_type, component_ref, status, submitted_at, actual_time_hours', purpose: 'Official submissions and marking decisions. Here learner_id refers to the enrolment record.' },
      { table: '"Learner".learners', fields: 'enrolment_id, accepted_assignments, rejected_assignments, accepted_reflections, rejected_reflections', purpose: 'Profile link and recomputed marking tallies.' },
    ],
    explanation: 'The Dashboard counts submissions with status submitted_for_tutor_review or escalated for the coach’s linked enrolment IDs. Personal-course review endpoints are separate and do not contribute to official marking totals.',
    references: ['backend/coach_api/selectors/dashboard/marking.py', 'backend/learner_api/marking_tally.py', 'backend/coach_api/personal_learning.py'],
  },
  {
    id: 'monthly-logs', section: 'Monthly Logs', title: 'Monthly activities, targets & signatures',
    description: 'Month and year summaries, accepted OTJH hours and learner/coach signatures.',
    sources: [
      { table: '"Learner".learner_progress_entries', fields: 'learner_id, reporting_month, actual_seconds, accepted, deleted_at', purpose: 'Activities allocated to their stored reporting month.' },
      { table: '"Learner".learner_monthly_targets', fields: 'learner_id, report_month, target_hours', purpose: 'Programme-scoped monthly target hours.' },
      { table: '"Learner".learner_monthly_signatures', fields: 'learner_id, report_month, signer_role, review_confirmed', purpose: 'Confirmed learner and coach signatures for each month.' },
    ],
    explanation: 'The year overview groups non-deleted progress entries by reporting_month and sums accepted seconds / 3600. A signature counts only when review_confirmed is true. Programme summary totals and the selected year’s month rows have different scopes.',
    references: ['backend/coach_api/monthly_logs.py → project_year, learner_month', 'backend/learner_api/monthly_logs.py'],
  },
  {
    id: 'support', section: 'Tickets', title: 'Inclusion Ticket System & Support Tickets',
    description: 'Wellbeing and safeguarding tickets, status, notes and ownership.',
    sources: [
      { table: 'public.support_tickets', fields: 'id, email, ticket_type, subject, status, urgency, notes, evidence, assigned_owner, is_archived', purpose: 'Tickets owned by the Inclusion application.', database: 'Separate Inclusion & Safeguarding database' },
      { table: '"Learner".learners', fields: 'email, coach_email, programme_status', purpose: 'LMS caseload ownership determines which learner tickets the coach can see.' },
    ],
    explanation: 'Inclusion Ticket System opens the external application. Support Tickets reads its database for learners on the coach’s caseload, matched by normalized email. The ticket’s coach_email is not the ownership rule. Coaches can add notes and change wellbeing status; safeguarding status is read-only here.',
    references: ['backend/coach_api/support_tickets.py', 'frontend/src/features/inclusion/navigation.ts'],
  },
];
