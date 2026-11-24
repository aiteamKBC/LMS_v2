"""Background consumer for invalidated canonical monthly-actual snapshots."""
import logging
import os
import sys
import threading

log = logging.getLogger(__name__)

POLL_SECONDS = 60
STARTUP_DELAY_SECONDS = 15
_lock = threading.Lock()
_thread = None
_stop = threading.Event()


def _loop():
    from django.db import connections
    from .monthly_actual_cache import refresh_invalidated

    _stop.wait(STARTUP_DELAY_SECONDS)
    while not _stop.is_set():
        try:
            counts = refresh_invalidated(limit=25)
            if counts['refreshed'] or counts['failed']:
                log.info('monthly_actual_schedule refreshed=%s busy=%s failed=%s',
                         counts['refreshed'], counts['busy'], counts['failed'])
        except Exception as error:  # noqa: BLE001 - durable null rows retry next poll
            log.error('Monthly actual schedule could not run (%s); it will retry.',
                      type(error).__name__)
        finally:
            connections.close_all()
        _stop.wait(POLL_SECONDS)


def start_scheduler():
    global _thread
    if os.environ.get('MONTHLY_ACTUAL_CACHE_SCHEDULE', 'true').strip().lower() in {
            '0', 'false', 'off', 'no'}:
        return False
    if any(arg in {'test', 'pytest', 'py.test'} for arg in sys.argv) or 'PYTEST_CURRENT_TEST' in os.environ:
        return False
    from django.conf import settings
    if getattr(settings, 'CHAT_TEST_MODE', False) or getattr(settings, 'RUN_APP_ON_TEST_BRANCH', False):
        return False
    with _lock:
        if _thread is not None and _thread.is_alive():
            return True
        try:
            thread = threading.Thread(target=_loop, name='monthly-actual-cache', daemon=True)
            thread.start()
        except RuntimeError as error:
            log.error('Could not start the monthly actual schedule (%s).', type(error).__name__)
            return False
        _thread = thread
    return True


class MonthlyActualWSGI:
    def __init__(self, application):
        self.application = application

    def __call__(self, environ, start_response):
        start_scheduler()
        return self.application(environ, start_response)


class MonthlyActualASGI:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http':
            start_scheduler()
        await self.application(scope, receive, send)
