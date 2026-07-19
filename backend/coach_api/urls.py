from django.urls import path

from .views import (
    coach_attendance,
    coach_absence_reports,
    coach_caseload,
    coach_caseload_coach_rag,
    coach_marking_queue,
    coach_timetable_event_action,
    coach_timetable_schedule_event,
    coach_timetable,
)


urlpatterns = [
    path('coach/caseload', coach_caseload, name='coach-caseload'),
    path('coach/caseload/<int:learner_id>/coach-rag', coach_caseload_coach_rag, name='coach-caseload-coach-rag'),
    path('coach/attendance', coach_attendance, name='coach-attendance'),
    path('coach/absence-reports', coach_absence_reports, name='coach-absence-reports'),
    path('coach/marking-queue', coach_marking_queue, name='coach-marking-queue'),
    path('coach/timetable', coach_timetable, name='coach-timetable'),
    path('coach/timetable/events/schedule', coach_timetable_schedule_event, name='coach-timetable-event-schedule'),
    path('coach/timetable/events/action', coach_timetable_event_action, name='coach-timetable-event-action'),
]
