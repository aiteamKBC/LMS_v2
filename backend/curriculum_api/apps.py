import os
import sys

from django.apps import AppConfig
from django.conf import settings


class CurriculumApiConfig(AppConfig):
    name = 'curriculum_api'

    def ready(self):
        """Warm the curriculum payload caches for this worker, in the background.

        Without this the first request after a deploy or restart pays the whole
        multi-table rebuild while every other request on the page queues behind
        its build lock. The warm runs on a daemon thread, so a slow or failing
        database delays nothing and blocks no worker from accepting requests.

        Skipped for management commands that are not serving traffic. `migrate`
        in particular must not have a thread reading tables it is in the middle
        of altering, and `test` has its own reason (see CURRICULUM_WARM in
        config/settings.py).
        """
        from .read_model import register_curriculum_home_read_model
        register_curriculum_home_read_model()

        command = sys.argv[1] if len(sys.argv) > 1 else ''
        if command in {
            'migrate', 'makemigrations', 'test', 'collectstatic', 'shell',
            'dbshell', 'createsuperuser', 'showmigrations', 'sqlmigrate',
            'flush', 'loaddata', 'dumpdata', 'check', 'diffsettings',
            'rebuild_read_model', 'reconcile_read_models',
            'process_read_model_events',
        }:
            return
        # runserver spawns a reloader child that does the actual serving; the
        # parent would only warm a cache it never reads from.
        if command == 'runserver' and os.environ.get('RUN_MAIN') != 'true':
            return
        # Once reads have switched to the persistent projection, its worker is
        # the only component that should pay the expensive rebuild. The old
        # process-local warm remains the staged-rollout fallback while the flag
        # is off.
        if getattr(settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False):
            return
        from .views import schedule_curriculum_warm
        schedule_curriculum_warm()
