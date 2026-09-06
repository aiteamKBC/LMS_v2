import os
import sys

from django.apps import AppConfig


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
        command = sys.argv[1] if len(sys.argv) > 1 else ''
        if command in {
            'migrate', 'makemigrations', 'test', 'collectstatic', 'shell',
            'dbshell', 'createsuperuser', 'showmigrations', 'sqlmigrate',
            'flush', 'loaddata', 'dumpdata', 'check', 'diffsettings',
        }:
            return
        # runserver spawns a reloader child that does the actual serving; the
        # parent would only warm a cache it never reads from.
        if command == 'runserver' and os.environ.get('RUN_MAIN') != 'true':
            return
        from .views import schedule_curriculum_warm
        schedule_curriculum_warm()
