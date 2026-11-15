"""Daily refresh of used country calendars in a serving process, with DB locks."""
import logging
import os
import sys
import threading

log = logging.getLogger(__name__)
_lock = threading.Lock()
_thread = None
_stop = threading.Event()


def _loop():
    from django.db import connections
    from .country_calendars import sync_saved
    if _stop.wait(60):
        return
    while not _stop.is_set():
        try:
            results = sync_saved(due_only=True)
            if results:
                log.info('Country holiday refresh checked=%s failed=%s', len(results), sum(row['status'] != 'ok' for row in results))
        except Exception as exc:
            # Do not log provider URLs, exception bodies, or API keys.
            log.error('Country holiday refresh failed (%s); it will retry.', type(exc).__name__)
        finally:
            connections.close_all()
        _stop.wait(24 * 60 * 60)


def start_scheduler():
    global _thread
    if not os.environ.get('CALENDARIFIC_API_KEY') or os.environ.get('COUNTRY_HOLIDAY_AUTO_SYNC', 'true').lower() in {'false', '0', 'off', 'no'}:
        return False
    if any(arg in {'test', 'pytest', 'py.test'} for arg in sys.argv) or 'PYTEST_CURRENT_TEST' in os.environ:
        return False
    from django.conf import settings
    if getattr(settings, 'CHAT_TEST_MODE', False) or getattr(settings, 'RUN_APP_ON_TEST_BRANCH', False):
        return False
    with _lock:
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_loop, name='country-holiday-calendars', daemon=True)
            _thread.start()
    return True


class CountryCalendarWSGI:
    def __init__(self, application):
        self.application = application

    def __call__(self, environ, start_response):
        start_scheduler()
        return self.application(environ, start_response)


class CountryCalendarASGI:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope.get('type') == 'http':
            start_scheduler()
        return await self.application(scope, receive, send)
