"""Calendar health routes, under the same prefix as the other Teams calendar routes.

Kept in their own URLconf and included ahead of ``curriculum_api.urls`` from
``config/urls.py``. The paths are distinct from every route there, so order only
keeps them findable in one place.
"""
from django.urls import path

from .teams_calendar_integrity import calendar_health, calendar_health_resolution, calendar_health_session

urlpatterns = [
    path('curriculum/teams-meetings/<str:live_session_id>/calendar-health/', calendar_health,
         name='curriculum-teams-calendar-health'),
    path('curriculum/teams-meetings/<str:live_session_id>/calendar-health/sessions/<str:occurrence_id>/',
         calendar_health_session, name='curriculum-teams-calendar-health-session'),
    path('curriculum/teams-meetings/<str:live_session_id>/calendar-health/resolution/', calendar_health_resolution,
         name='curriculum-teams-calendar-health-resolution'),
]
