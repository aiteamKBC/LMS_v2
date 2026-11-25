export interface SchemaTable {
  name: string;
  description: string;
}

export interface SchemaGroup {
  id: string;
  name: string;
  description: string;
  icon: string;
  tables: SchemaTable[];
}

// Static documentation, not a live inventory or a count of database records.
// Group membership: the supplied 95-table Curriculum Schema audit catalogue.
// Business purposes checked against curriculum_api models, calendar_holidays,
// review_schedule/review_instances, web_week_points, versioning, module_hours,
// source catalogues, and specs/audits/dev-production-readiness/evidence/schema.json.
const group = (id: string, name: string, description: string, icon: string,
  entries: [string, string][]): SchemaGroup => ({
  id, name, description, icon,
  tables: entries.map(([name, description]) => ({ name, description })),
});

export const schemaGroups: SchemaGroup[] = [
  group('core-curriculum', 'Core Curriculum', 'Programmes, cohorts, groups and the structure of learning.', 'ri-book-open-line', [
    ['cohorts', 'Organises training cohorts within programmes, including their start and end dates.'],
    ['components', 'Defines weekly learning activities, such as reading and quizzes, and their completion requirements.'],
    ['groups', 'Organises learner groups within cohorts, including session times and the responsible coach.'],
    ['historical_components', 'Preserves activity definitions from earlier learning systems to retain the context of historical learning.'],
    ['module_completion_criteria', 'Defines module completion requirements, such as finishing quizzes and achieving the required score.'],
    ['module_details', 'Explains module objectives, learner and employer benefits, and end-point assessment requirements.'],
    ['modules', 'Defines training modules, their content, schedules and planned learning hours.'],
    ['programmes', 'Defines training programmes, their levels, objectives and required training hours.'],
    ['weeks', 'Organises learning weeks within a module, including their order, titles and learning outcomes.'],
  ]),
  group('week-templates-calendar', 'Week Templates and Calendar', 'Reusable learning weeks, holiday calendars and scheduling choices.', 'ri-calendar-line', [
    ['calendar_countries', 'Defines supported countries and their default weekly rest days.'],
    ['calendar_holidays', 'Provides the shared catalogue of official and local holidays, including their names, dates and sources.'],
    ['cohort_calendar_holidays', 'Records which holidays apply to each training cohort and which are excluded.'],
    ['country_holiday_calendars', 'Keeps imported holiday calendars for each country and year and tracks their update status.'],
    ['module_calendar_holidays', 'Records holidays and closures specific to each training module.'],
    ['web_week_points', 'Organises weekly activities into named learning points for presentation to learners.'],
    ['week_template_components', 'Defines activities and learning requirements within reusable week templates.'],
    ['week_templates', 'Keeps reusable week templates with learning outcomes and activities for preparing training content.'],
  ]),
  group('coaches-tutors', 'Coaches and Tutors', 'Teaching staff, group assignments and module notifications.', 'ri-team-line', [
    ['coaches', 'Keeps coach details and active status to support communication and assignment of responsibilities.'],
    ['group_coaches', 'Identifies the coaches responsible for supporting each training group.'],
    ['tutor_module_notifications', 'Tracks module assignment notifications sent to tutors, including delivery status and attempts.'],
    ['tutors', 'Keeps tutor details, contact information and active status.'],
  ]),
  group('free-courses', 'Free Courses', 'Free course content and its weekly organisation.', 'ri-graduation-cap-line', [
    ['free_course_weeks', 'Organises free course weeks, their order and summaries of activities and learning hours.'],
    ['free_courses', 'Defines free courses, their descriptions, images and display order.'],
    ['free_programme_components', 'Keeps free course activities, their content and completion requirements.'],
  ]),
  group('ksb', 'KSB', 'Knowledge, skills and behaviours covered by learning activities.', 'ri-award-line', [
    ['ksb_component_mappings', 'Identifies the knowledge, skills and behaviours covered by each learning activity.'],
    ['ksb_source_activity_mappings', 'Identifies the knowledge, skills and behaviours covered by imported learning activities.'],
    ['ksb_standard_definitions', 'Defines the knowledge, skills and behaviours required by training standards.'],
    ['ksb_standard_versions', 'Keeps versions of training standards so their different requirements can be distinguished.'],
  ]),
  group('quizzes', 'Quizzes', 'Assessments, questions, answer choices and learning placement.', 'ri-question-line', [
    ['quiz_answers', 'Keeps answer choices for each quiz question, including correct choices and display order.'],
    ['quiz_component_links', 'Identifies the quizzes used within learning activities.'],
    ['quiz_course_links', 'Identifies the modules and weeks that include each quiz.'],
    ['quiz_questions', 'Keeps quiz questions, their types, scores and answer explanations.'],
    ['quizzes', 'Defines quizzes and their passing, attempt, publication and question display settings.'],
    ['source_reading_quiz_pairs', 'Identifies the assessment quiz paired with each imported reading activity within a group.'],
  ]),
  group('module-hours', 'Module Hours', 'Planned training hours, targets and the history of adjustments.', 'ri-time-line', [
    ['module_hours_access', 'Defines access permissions for managing module learning hours.'],
    ['module_hours_audit', 'Records changes to hour targets and management permissions, including previous values, new values and who changed them.'],
    ['module_hours_targets', 'Defines module hour targets for comparison with planned learning hours.'],
    ['source_planned_hours_bulk_batches', 'Records bulk changes to planned activity hours and summarises their results.'],
    ['source_planned_hours_bulk_items', 'Records the outcome for each activity in a bulk hours change, including previous and new planned hours.'],
    ['source_planned_hours_default_revisions', 'Keeps the history of changes to default hours for source activities and who made them.'],
    ['source_planned_hours_defaults', 'Defines default planned hours for source activities within each training group.'],
  ]),
  group('live-sessions-attendance', 'Live Sessions and Attendance', 'Scheduled sessions, attendance evidence, absences and recordings.', 'ri-video-line', [
    ['live_session_absence_report_links', 'Documents how legacy absence reports were matched to the recognised absence records.'],
    ['live_session_absence_report_sources', 'Preserves copies of legacy absence reports so their sources can be checked during review.'],
    ['live_session_absence_review_events', 'Records absence review decisions, status changes, reasons and who made them.'],
    ['live_session_absences', 'Records a learner absence, their report and their choice for recovering missed learning.'],
    ['live_session_artifacts', 'Keeps references to session recordings and transcripts and tracks their storage status.'],
    ['live_session_attendance', 'Keeps attendance evidence received from Teams, including join intervals and attendance duration.'],
    ['live_session_attendance_aliases', 'Defines approved alternative email addresses used to recognise learner attendance within a module.'],
    ['live_session_attendance_identity_audit', 'Records changes to attendance identity matching and who made them.'],
    ['live_session_attendance_identity_links', 'Documents reviewed matches between a participant attendance record and the correct learner for a session.'],
    ['live_session_attendance_identity_rules', 'Keeps rules for matching participant identities to learners within a module.'],
    ['live_session_join_launches', 'Records session join links opened from the platform to help track access.'],
    ['live_session_learner_attendance', 'Keeps the final attendance register for each learner and session, including attendance duration and recovery status.'],
    ['live_session_occurrences', 'Keeps each individual session occurrence, its scheduled and actual times, status and attendance evidence.'],
    ['live_session_recording_events', 'Records interactions with session recordings, such as playback, pauses and skipped sections.'],
    ['live_session_recording_views', 'Tracks how long a learner has watched a recording and their last playback position.'],
    ['live_session_recovery_transitions', 'Keeps the history of changes to missed-session recovery status, including reasons and evidence.'],
    ['live_sessions', 'Defines live sessions, their schedules, recurrence, participants and meeting settings.'],
    ['qr_attendance', 'Records learner attendance confirmed using a QR code.'],
    ['session_result_archive', 'Tracks the archiving of session recordings and transcripts, including storage status and archiving errors.'],
    ['session_result_jobs', 'Tracks session result collection tasks, their progress and retry attempts.'],
  ]),
  group('reviews', 'Reviews', 'Review templates, learner meetings, answers and signatures.', 'ri-file-list-3-line', [
    ['learner_review_additions', 'Records additional reviews scheduled for individual learners, including dates and reasons.'],
    ['review_clash_resolutions', 'Keeps decisions to retain reviews that fall in the same month within a programme.'],
    ['review_fields', 'Defines review form questions and fields, answer requirements and display order.'],
    ['review_instance_answers', 'Keeps answers entered during a learner review, including who answered and when.'],
    ['review_instance_manual_overrides', 'Documents manual changes to review status, their reasons and who made them.'],
    ['review_instance_reopens', 'Records reopened reviews, including the reasons and their previous state.'],
    ['review_instance_signatures', 'Keeps participant signatures for learner reviews, including their roles and signing dates.'],
    ['review_instances', 'Tracks each scheduled learner review from its target date through starting and completion.'],
    ['review_occurrence_overrides', 'Keeps decisions to skip particular review dates and their reasons without changing the recurrence pattern.'],
    ['review_sections', 'Organises review form sections, their order and the expected time for each section.'],
    ['review_templates', 'Defines review templates, recurrence, participants, signature requirements and notifications.'],
    ['review_types', 'Defines available review types, their names and active status.'],
  ]),
  group('source-lms-content', 'Source LMS and Content', 'Imported learning catalogues, activities and source materials.', 'ri-folder-line', [
    ['source_activities', 'Catalogues activities from learning sources and tracks their matching to curriculum activities.'],
    ['source_courses', 'Catalogues courses from learning sources and tracks their matching to programmes and modules.'],
    ['source_lms_activities', 'Keeps source LMS activity details, such as reading content, videos and quizzes.'],
    ['source_lms_group_activities', 'Identifies activities belonging to each source LMS group and their display order.'],
    ['source_lms_groups', 'Keeps known source LMS groups, their names and when they were observed.'],
    ['source_lms_raw_pages', 'Keeps batches of data received from the source LMS for reference during imports.'],
    ['source_materials', 'Catalogues learning materials, their links, durations and the status of stored copies.'],
  ]),
  group('microsoft-teams', 'Microsoft Teams', 'Meeting creation, calendar synchronisation and delivery tracking.', 'ri-calendar-event-line', [
    ['module_teams_shares', 'Identifies modules that share Teams sessions with a source module.'],
    ['teams_calendar_create_claims', 'Tracks session calendar creation requests to prevent duplicate creation when requests overlap.'],
    ['teams_calendar_create_drafts', 'Keeps draft Teams calendar settings before session creation is completed.'],
    ['teams_calendar_integrity_events', 'Records Teams calendar changes and integrity checks, their outcomes and who initiated them.'],
    ['teams_calendar_sync_state', 'Keeps the last verified state used when synchronising session calendars.'],
    ['teams_graph_failures', 'Records communication failures with Microsoft services to help diagnose meeting problems.'],
    ['teams_organization_calendar_connections', 'Keeps settings for connecting organisation calendars to Microsoft Teams services.'],
    ['teams_schedule_emails', 'Tracks session schedule emails sent to recipients, including delivery status and attempts.'],
  ]),
  group('learner-activity-display', 'Learner Activity Display', 'Activity visibility choices and their audit history.', 'ri-eye-line', [
    ['activity_events', 'Records platform usage, such as opening pages, viewing content and downloading files, for activity monitoring.'],
    ['learner_activity_display_audit', 'Keeps the history of learner activity visibility changes, their reasons and who made them.'],
    ['learner_activity_display_overrides', 'Keeps custom visibility decisions for an individual learner activity within a module.'],
  ]),
  group('versioning-cache', 'Versioning and Cache', 'Change history, saved versions and keeping displayed content fresh.', 'ri-history-line', [
    ['cache_epoch', 'Signals changes to curriculum content so the platform can refresh temporarily stored copies.'],
    ['cache_scope_epoch', 'Tracks updates within each content area so affected views can be refreshed.'],
    ['record_revisions', 'Records curriculum content changes, including a snapshot at the time, the reason and who made the change.'],
    ['record_versions', 'Keeps named versions of curriculum content and notes for each version.'],
  ]),
];

export const totalTables = schemaGroups.reduce((sum, item) => sum + item.tables.length, 0);

export function searchCatalogue(query: string, groups = schemaGroups): SchemaGroup[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return groups;
  return groups.flatMap(item => {
    const tables = item.name.toLocaleLowerCase().includes(term) ? item.tables : item.tables.filter(table =>
      table.name.toLocaleLowerCase().includes(term) || table.description.toLocaleLowerCase().includes(term));
    return tables.length ? [{ ...item, tables }] : [];
  });
}
