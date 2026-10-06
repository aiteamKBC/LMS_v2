"""
ASGI config for config project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

django_application = get_asgi_application()

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter

from chat.routing import websocket_urlpatterns
from coach_api.dashboard_snapshot_scheduler import CoachDashboardSnapshotASGI
from curriculum_api.session_sync_runtime import SessionSyncASGI
from learner_api.catchup_reminders import CatchupReminderASGI


application = ProtocolTypeRouter(
    {
        'http': CoachDashboardSnapshotASGI(CatchupReminderASGI(SessionSyncASGI(django_application))),
        'websocket': AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
