from django.urls import path

from .csrf import coach_csrf_token
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
    coach_monthly_activity,
    coach_timetable_event_action,
    coach_timetable_book_event,
    coach_timetable_schedule_event,
    coach_timetable,
)


urlpatterns = [
    path('csrf', coach_csrf_token, name='coach-csrf'),
    path('coaches', coach_directory, name='coach-directory'),
    path('coach/dashboard', coach_dashboard, name='coach-dashboard'),
    path('coach/caseload', coach_caseload, name='coach-caseload'),
    path('coach/caseload/<int:learner_id>/coach-rag', coach_caseload_coach_rag, name='coach-caseload-coach-rag'),
    path('coach/attendance', coach_attendance, name='coach-attendance'),
    path('coach/attendance/details', coach_attendance_details, name='coach-attendance-details'),
    path('coach/absence-reports', coach_absence_reports, name='coach-absence-reports'),
    path('coach/evidence-awaiting-review', coach_evidence_awaiting_review, name='coach-evidence-awaiting-review'),
    path('coach/marking-queue', coach_marking_queue, name='coach-marking-queue'),
    path('coach/marking-queue/<uuid:submission_id>', coach_marking_queue, name='coach-marking-submission'),
    path('coach/monthly-activity', coach_monthly_activity, name='coach-monthly-activity'),
    path('coach/timetable', coach_timetable, name='coach-timetable'),
    path('coach/timetable/events/book', coach_timetable_book_event, name='coach-timetable-event-book'),
    path('coach/timetable/events/schedule', coach_timetable_schedule_event, name='coach-timetable-event-schedule'),
    path('coach/timetable/events/action', coach_timetable_event_action, name='coach-timetable-event-action'),
]
