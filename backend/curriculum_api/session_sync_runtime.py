"""Start the durable session queue from serving processes, never on import.

The database worker owns leases, retries and occurrence binding. These threads
only wake it up; HTTP requests never transfer recording bytes themselves.
"""
import io
import logging
import os
import sys
import threading

log = logging.getLogger(__name__)
POLL_SECONDS = 60
MAX_MANUAL_WORKERS = 2
_lock = threading.Lock()
_automatic_thread = None
_manual_series = set()
_stop = threading.Event()


def run_worker(*, series_id=None, scheduled=False):
    from django.core.management import call_command
    from django.db import close_old_connections, connections

    try:
        close_old_connections()
        call_command('process_session_results', scheduled=scheduled,
                     limit=1 if series_id else 10,
                     live_session_ids=[series_id] if series_id else [],
                     stdout=io.StringIO(), stderr=io.StringIO())
    except Exception as error:
        # The command persists job failures; never log tokens, URLs or rosters.
        log.error('Session sync worker failed (%s). Check saved job status and server configuration.',
                  type(error).__name__)
    finally:
        connections.close_all()


def _automatic_loop():
    while not _stop.is_set():
        try:
            run_worker(scheduled=True)
        except Exception as error:
            log.error('Automatic session sync could not run (%s); it will retry.', type(error).__name__)
        _stop.wait(POLL_SECONDS)


def start_automatic_sync():
    """One scheduler per serving process, including after a preloaded fork.

    Invoked by the HTTP server wrappers after workers have forked. Django test
    clients and management commands do not enter these wrappers. The explicit
    opt-out supports deployments that retain their external scheduler instead.
    """
    global _automatic_thread
    if os.environ.get('SESSION_RESULTS_AUTOMATIC', 'true').lower() in {'0', 'false', 'off'}:
        return False
    if any(arg in {'test', 'pytest', 'py.test'} for arg in sys.argv) or 'PYTEST_CURRENT_TEST' in os.environ:
        return False
    from django.conf import settings
    if getattr(settings, 'CHAT_TEST_MODE', False) or getattr(settings, 'RUN_APP_ON_TEST_BRANCH', False):
        return False
    with _lock:
        if _automatic_thread is not None and _automatic_thread.is_alive():
            return True
        try:
            thread = threading.Thread(target=_automatic_loop, name='session-results-auto', daemon=True)
            thread.start()
        except RuntimeError as error:
            log.error('Could not start automatic session sync (%s).', type(error).__name__)
            return False
        _automatic_thread = thread
    return True


def _manual_run(series_id):
    try:
        run_worker(series_id=series_id)
    finally:
        with _lock:
            _manual_series.discard(series_id)


def start_requested_sync(series_id):
    """Immediately attempt this series after its queue transaction commits.

    Repeated clicks are coalesced locally; the worker's database lease also
    protects against other web processes and the periodic scheduler. Overflow
    remains in the durable queue for the automatic worker.
    """
    with _lock:
        if series_id in _manual_series or len(_manual_series) >= MAX_MANUAL_WORKERS:
            return False
        _manual_series.add(series_id)
        try:
            threading.Thread(target=_manual_run, args=(series_id,),
                             name='session-results-manual', daemon=True).start()
        except RuntimeError:
            _manual_series.discard(series_id)
            raise
    return True


class SessionSyncWSGI:
    def __init__(self, application):
        self.application = application

    def __call__(self, environ, start_response):
        start_automatic_sync()
        return self.application(environ, start_response)


class SessionSyncASGI:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http':
            start_automatic_sync()
        await self.application(scope, receive, send)
