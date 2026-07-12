from django.urls import path

from .views import coach_attendance, coach_caseload, coach_marking_queue, coach_timetable


urlpatterns = [
    path('coach/caseload', coach_caseload, name='coach-caseload'),
    path('coach/attendance', coach_attendance, name='coach-attendance'),
    path('coach/marking-queue', coach_marking_queue, name='coach-marking-queue'),
    path('coach/timetable', coach_timetable, name='coach-timetable'),
]
