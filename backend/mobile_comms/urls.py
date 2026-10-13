from django.urls import path
from . import views
urlpatterns = [
    path("session/",views.session), path("preferences/",views.preferences),
    path("directory/",views.directory), path("threads/",views.threads),
    path("threads/<uuid:thread_id>/messages/",views.messages),
    path("threads/<uuid:thread_id>/read/",views.read_thread),
    path("notifications/",views.inbox),
    path("notifications/<int:notification_id>/read/",views.read_notification),
    path("device/",views.device),
]

