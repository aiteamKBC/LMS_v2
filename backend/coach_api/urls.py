from django.urls import path

from .ai_marking import coach_marking_ai_feedback, coach_marking_ai_prompt
from .csrf import coach_csrf_token
from . import personal_learning
from .monthly_reports import coach_monthly_report_detail, coach_monthly_reports
from .meeting_reminders import coach_meeting_reminder
from .review_pdf import coach_mcm_pdf
from .views import (
    coach_attendance,
    coach_attendance_details,
    coach_dashboard,
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
    coach_review_instance_for_event,
    coach_review_instance_mark_in_progress_manually,
    coach_review_instance_signature,
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
    path('coach/personal-marking', personal_learning.marking),
    path('coach/personal-marking/<uuid:submission_id>', personal_learning.marking),
    path('coach/personal-marking/<uuid:submission_id>/evidence', personal_learning.evidence),
    path('coach/personal-marking/<uuid:submission_id>/evidence/<uuid:file_id>', personal_learning.evidence),
    path('csrf', coach_csrf_token, name='coach-csrf'),
    path('coaches', coach_directory, name='coach-directory'),
    path('coach/dashboard', coach_dashboard, name='coach-dashboard'),
    path('coach/caseload', coach_caseload, name='coach-caseload'),
    path('coach/imported-review-history', coach_imported_review_history, name='coach-imported-review-history'),
    path('coach/caseload/<int:learner_id>/coach-rag', coach_caseload_coach_rag, name='coach-caseload-coach-rag'),
    path('coach/attendance', coach_attendance, name='coach-attendance'),
    path('coach/attendance/details', coach_attendance_details, name='coach-attendance-details'),
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
    path('coach/reviews/<str:instance_id>/answers', coach_review_instance_answers, name='coach-review-instance-answers'),
    path('coach/reviews/<str:instance_id>/complete', coach_review_instance_complete, name='coach-review-instance-complete'),
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
