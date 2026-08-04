from django.urls import path

from . import calendar_connections

urlpatterns = [
    path("google/callback", calendar_connections.oauth_callback, {"provider": "google"}, name="google-calendar-callback"),
    path("microsoft/callback", calendar_connections.oauth_callback, {"provider": "microsoft"}, name="microsoft-calendar-callback"),
]
