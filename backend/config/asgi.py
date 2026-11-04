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
from config.health import with_health_check
from config.load_metric import with_load_metric
from curriculum_api.session_sync_runtime import SessionSyncASGI
from learner_api.catchup_reminders import CatchupReminderASGI
from curriculum_api.module_collaboration_consumer import ModuleCollaborationASGI


# Outermost: requests in progress, reported for auto scaling
# (config/load_metric.py; health checks start it but aren't counted).
# Next: /health/ answers for the load balancer before Django, host
# validation or the scheduler wrappers run (see config/health.py).
application = with_load_metric(with_health_check(ProtocolTypeRouter(
    {
        'http': CoachDashboardSnapshotASGI(CatchupReminderASGI(SessionSyncASGI(django_application))),
        'websocket': ModuleCollaborationASGI(AuthMiddlewareStack(URLRouter(websocket_urlpatterns))),
    }
)))
