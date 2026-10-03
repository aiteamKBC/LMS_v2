from django.urls import path

from .ai_marking import coach_marking_ai_feedback, coach_marking_ai_prompt
from .csrf import coach_csrf_token
from .bulk_attendance import coach_bulk_attendance
from . import personal_learning
from .monthly_reports import coach_monthly_report_detail, coach_monthly_reports
from .meeting_reminders import coach_meeting_reminder
from .enrolment_documents import (
    coach_enrolment_document,
    coach_enrolment_documents,
    coach_sign_enrolment_document,
)
from .review_pdf import coach_mcm_pdf
from .migrated_completion_views import (
    migrated_review_submit, migrated_review_coach_sign,
    migrated_review_complete, migrated_review_generate_pdf,
)
from .migrated_intelligence_views import (
    migrated_review_intelligence, migrated_review_check_session, migrated_review_summary,
)
from .dashboard_view import coach_dashboard
from .views import (
    coach_attendance,
    coach_attendance_details,
    coach_manual_attendance,
    coach_source_attendance,
    coach_learner_case_file,
    coach_learner_case_file_next_session,
    coach_learner_case_file_reviews,
    coach_absence_reports,
    coach_caseload,
    coach_caseload_coach_rag,
    coach_directory,
    coach_evidence_awaiting_review,
    coach_marking_queue,
    coach_imported_review_history,
    coach_monthly_activity,
    coach_review_instance_answers,
    coach_review_instance_complete,
    coach_review_instance_progress,
    coach_review_instance_detail,
    coach_review_instance_initialize,
    coach_review_instance_book,
    coach_review_instance_local_status,
    coach_review_instance_previous,
    coach_review_instance_for_event,
    coach_review_instance_mark_in_progress_manually,
    coach_review_instance_meeting_summary,
    coach_review_instance_reopen,
    coach_review_instance_signature,
    coach_aptem_review_reconciliation_preview,
    coach_review_learner_addition_templates,
    coach_review_learner_additions_create,
    coach_timetable_event_artifact_content,
    coach_timetable_event_artifacts,
    coach_timetable_event_summary,
    coach_timetable_event_action,
    coach_timetable_book_event,
    coach_timetable_schedule_event,
    coach_timetable,
)


urlpatterns = [
    path('migrated-reviews/<str:review_id>/intelligence', migrated_review_intelligence, name='migrated-review-intelligence'),
    path('migrated-reviews/<str:review_id>/check-session', migrated_review_check_session, name='migrated-review-check-session'),
    path('migrated-reviews/<str:review_id>/summary', migrated_review_summary, name='migrated-review-summary'),
    path('migrated-reviews/<str:review_id>/submit', migrated_review_submit, name='migrated-review-submit'),
    path('migrated-reviews/<str:review_id>/coach-sign', migrated_review_coach_sign, name='migrated-review-coach-sign'),
    path('migrated-reviews/<str:review_id>/complete', migrated_review_complete, name='migrated-review-complete'),
    path('migrated-reviews/<str:review_id>/generate-pdf', migrated_review_generate_pdf, name='migrated-review-generate-pdf'),
    path('coach/personal-marking', personal_learning.marking),
    path('coach/personal-marking/<uuid:submission_id>', personal_learning.marking),
    path('coach/personal-marking/<uuid:submission_id>/evidence', personal_learning.evidence),
    path('coach/personal-marking/<uuid:submission_id>/evidence/<uuid:file_id>', personal_learning.evidence),
    path('csrf', coach_csrf_token, name='coach-csrf'),
    path('coaches', coach_directory, name='coach-directory'),
    path('coach/dashboard', coach_dashboard, name='coach-dashboard'),
    path('coach/learners/<int:learner_id>/case-file', coach_learner_case_file, name='coach-learner-case-file'),
    path('coach/learners/<int:learner_id>/next-session', coach_learner_case_file_next_session, name='coach-learner-case-file-next-session'),
    path('coach/learners/<int:learner_id>/reviews', coach_learner_case_file_reviews, name='coach-learner-case-file-reviews'),
    # Enrolment Documents tab: the learner's enrolment review documents, signed
    # by the coach with their saved signature (coach_api/enrolment_documents.py).
    path('coach/learners/<int:learner_id>/enrolment-documents', coach_enrolment_documents, name='coach-enrolment-documents'),
    path('coach/learners/<int:learner_id>/enrolment-documents/<str:event_key>', coach_enrolment_document, name='coach-enrolment-document'),
    path('coach/learners/<int:learner_id>/enrolment-documents/<str:event_key>/sign', coach_sign_enrolment_document, name='coach-enrolment-document-sign'),
    path('coach/caseload', coach_caseload, name='coach-caseload'),
    path('coach/imported-review-history', coach_imported_review_history, name='coach-imported-review-history'),
    path('coach/caseload/<int:learner_id>/coach-rag', coach_caseload_coach_rag, name='coach-caseload-coach-rag'),
    path('coach/attendance', coach_attendance, name='coach-attendance'),
    path('coach/attendance/bulk', coach_bulk_attendance, name='coach-bulk-attendance'),
    path('coach/attendance/details', coach_attendance_details, name='coach-attendance-details'),
    path('coach/attendance/manual', coach_manual_attendance, name='coach-manual-attendance-create'),
    path('coach/attendance/manual/<int:record_id>', coach_manual_attendance, name='coach-manual-attendance-detail'),
    path('coach/attendance/source', coach_source_attendance, name='coach-source-attendance'),
    path('coach/absence-reports', coach_absence_reports, name='coach-absence-reports'),
    path('coach/evidence-awaiting-review', coach_evidence_awaiting_review, name='coach-evidence-awaiting-review'),
    # The learners' end-of-month reports. The detail route is declared first;
    # the bare list route would otherwise never be reached for a report id.
    path('coach/monthly-reports/<uuid:report_id>', coach_monthly_report_detail, name='coach-monthly-report-detail'),
    path('coach/monthly-reports', coach_monthly_reports, name='coach-monthly-reports'),
    path('coach/marking-queue', coach_marking_queue, name='coach-marking-queue'),
    path('coach/marking-queue/<uuid:submission_id>', coach_marking_queue, name='coach-marking-submission'),
    path('coach/marking-queue/<uuid:submission_id>/ai-feedback', coach_marking_ai_feedback, name='coach-marking-ai-feedback'),
    path('coach/marking-queue/<uuid:submission_id>/ai-prompt', coach_marking_ai_prompt, name='coach-marking-ai-prompt'),
    path('coach/monthly-activity', coach_monthly_activity, name='coach-monthly-activity'),
    path('coach/timetable', coach_timetable, name='coach-timetable'),
    path('coach/timetable/events/book', coach_timetable_book_event, name='coach-timetable-event-book'),
    path('coach/timetable/events/schedule', coach_timetable_schedule_event, name='coach-timetable-event-schedule'),
    path('coach/timetable/events/action', coach_timetable_event_action, name='coach-timetable-event-action'),
    path('coach/timetable/events/<str:event_key>/reminder', coach_meeting_reminder, name='coach-meeting-reminder'),
    path('coach/timetable/events/<str:event_key>/artifacts', coach_timetable_event_artifacts, name='coach-timetable-event-artifacts'),
    path('coach/timetable/events/<str:event_key>/artifacts/<str:artifact_type>/<str:artifact_id>/content', coach_timetable_event_artifact_content, name='coach-timetable-event-artifact-content'),
    path('coach/timetable/events/<str:event_key>/summary', coach_timetable_event_summary, name='coach-timetable-event-summary'),
    # Curriculum-driven Review instances: opening a scheduled MCM/Progress
    # Review, saving its answers, signing and completing it -- the question
    # set/signature rules were resolved by Curriculum, not hard-coded here.
    path('coach/reviews/open', coach_review_instance_for_event, name='coach-review-instance-open'),
    path('coach/reviews/learners/<int:learner_id>/aptem-reconciliation-preview',
         coach_aptem_review_reconciliation_preview, name='coach-aptem-review-reconciliation-preview'),
    # Learner-specific additional Reviews (coach "Create session" -> Review):
    # one canonical occurrence for ONE learner, never a standalone calendar
    # row and never a new programme-wide template. Declared before the
    # generic <str:instance_id> route below so 'learner-additions' is never
    # swallowed as an instance id.
    path(
        'coach/reviews/learner-additions/templates',
        coach_review_learner_addition_templates,
        name='coach-review-learner-addition-templates',
    ),
    path('coach/reviews/learner-additions', coach_review_learner_additions_create, name='coach-review-learner-additions-create'),
    path('coach/reviews/<str:instance_id>', coach_review_instance_detail, name='coach-review-instance-detail'),
    path('coach/reviews/<str:instance_id>/initialize', coach_review_instance_initialize, name='coach-review-instance-initialize'),
    path('coach/reviews/<str:instance_id>/book', coach_review_instance_book, name='coach-review-instance-book'),
    path('coach/reviews/<str:instance_id>/local-status', coach_review_instance_local_status, name='coach-review-instance-local-status'),
    path('coach/reviews/<str:instance_id>/previous', coach_review_instance_previous, name='coach-review-instance-previous'),
    path('coach/reviews/<str:instance_id>/answers', coach_review_instance_answers, name='coach-review-instance-answers'),
    path('coach/reviews/<str:instance_id>/meeting-summary', coach_review_instance_meeting_summary, name='coach-review-instance-meeting-summary'),
    path('coach/reviews/<str:instance_id>/complete', coach_review_instance_complete, name='coach-review-instance-complete'),
    # Reopens a completed/awaiting-signature review for correction. Clears every
    # signature already collected -- see reopen_review_instance_for_editing.
    path('coach/reviews/<str:instance_id>/reopen', coach_review_instance_reopen, name='coach-review-instance-reopen'),
    # Progress Review only: freeze this instance's learner-progress figures.
    # An explicit coach action -- no other route ever recalculates them.
    path('coach/reviews/<str:instance_id>/progress', coach_review_instance_progress, name='coach-review-instance-progress'),
    path(
        'coach/reviews/<str:instance_id>/mark-in-progress',
        coach_review_instance_mark_in_progress_manually,
        name='coach-review-instance-mark-in-progress',
    ),
    path('coach/reviews/<str:instance_id>/signatures', coach_review_instance_signature, name='coach-review-instance-signature'),
    path('coach/reviews/<str:instance_id>/pdf', coach_mcm_pdf, name='coach-mcm-pdf'),
]
