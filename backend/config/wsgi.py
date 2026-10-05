"""
WSGI config for config project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

application = get_wsgi_application()

from coach_api.dashboard_snapshot_scheduler import CoachDashboardSnapshotWSGI
from curriculum_api.session_sync_runtime import SessionSyncWSGI
from learner_api.catchup_reminders import CatchupReminderWSGI

application = CoachDashboardSnapshotWSGI(CatchupReminderWSGI(SessionSyncWSGI(application)))
