import os
import sys

from django.apps import AppConfig
from django.conf import settings
from config.management_safety import reconciliation_command


#: LOAD_METRIC_SERVICE values whose web workers serve curriculum pages.
#: night-api serves the learner, login and curriculum paths overnight and at
#: weekends while those services are scaled to zero. Unset is local
#: development or a deployment that does not name its services.
CURRICULUM_WARM_SERVICES = frozenset({'', 'curriculum-api', 'night-api'})
_WEB_SERVERS = ('uvicorn', 'gunicorn', 'daphne', 'hypercorn')


def serves_curriculum_pages(argv=None, environ=None):
    """Whether this process is a web worker of a service with curriculum pages.

    An allow-list, so a new management command or worker never warms by
    default. uvicorn and gunicorn workers inherit the server's argv[0];
    `runserver` serves from its reloader child (RUN_MAIN), not the parent.
    """
    argv = sys.argv if argv is None else argv
    environ = os.environ if environ is None else environ
    program = os.path.basename(argv[0] if argv else '').lower()
    command = argv[1] if len(argv) > 1 else ''
    if program == 'manage.py' or program.startswith('django-admin'):
        web = command == 'runserver' and environ.get('RUN_MAIN') == 'true'
    else:
        web = any(server in program or server in ' '.join(argv[:2]).lower() for server in _WEB_SERVERS)
    if not web:
        return False
    return environ.get('LOAD_METRIC_SERVICE', '').strip().lower() in CURRICULUM_WARM_SERVICES


class CurriculumApiConfig(AppConfig):
    name = 'curriculum_api'

    def ready(self):
        """Warm the curriculum payload caches for this worker, in the background.

        Without this the first request after a deploy or restart pays the whole
        multi-table rebuild while every other request on the page queues behind
        its build lock. The warm runs on a daemon thread, so a slow or failing
        database delays nothing and blocks no worker from accepting requests.

        Only a web-server process of a service that serves curriculum pages
        warms (see serves_curriculum_pages). Any management command -- the
        session worker starts a new `process_session_results` process every
        minute -- or another service's worker would only pay for a warm it
        never reads; `migrate` must not read tables it is altering, and `test`
        has its own reason (see CURRICULUM_WARM in config/settings.py).
        """
        from .read_model import register_curriculum_home_read_model
        register_curriculum_home_read_model()

        if reconciliation_command():
            return

        if not serves_curriculum_pages():
            return
        self.log_cache_backend()
        # Once reads have switched to the persistent projection, its worker is
        # the only component that should pay the expensive rebuild. The old
        # process-local warm remains the staged-rollout fallback while the flag
        # is off.
        if getattr(settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False):
            return
        from .views import schedule_curriculum_warm
        schedule_curriculum_warm()

    def log_cache_backend(self):
        """Say once, per worker, whether the payload cache is shared.

        `cached_curriculum_value` stores every built payload in Django's cache as
        well as in process memory, so that the other workers can read what one of
        them built. Without a `CACHE_URL` that cache is LocMemCache, which is
        private to the process -- so under nine two-worker services each of the
        eighteen builds its own copy and a reader keeps landing on a cold one.

        Nothing here changes that; it is a `.env` line and a Redis instance. What
        this does is make which one is running a fact in the log rather than an
        assumption, because the two are indistinguishable from the outside except
        by how often the page is slow.
        """
        import logging

        from django.conf import settings

        backend = (settings.CACHES.get('default') or {}).get('BACKEND', '')
        shared = 'redis' in backend.lower()
        logging.getLogger('curriculum_api.views').info(
            'Curriculum payload cache: %s (%s). %s',
            backend.rsplit('.', 1)[-1] or 'unknown',
            'shared between workers' if shared else 'process-local',
            '' if shared else 'Set CACHE_URL to share built payloads across workers.',
        )
