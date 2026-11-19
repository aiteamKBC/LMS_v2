"""Retry persisted Review feedback using the existing serving-process pattern.

No thread starts at import/AppConfig.ready. HTTP wrappers start after fork,
as with the existing dashboard/calendar schedulers. Short PostgreSQL transaction
claims coordinate each profile, including through transaction-pooling endpoints.
"""
import logging
import os
import sys
import threading

from django.conf import settings
from django.db import connection, connections

from .review_feedback_reconciliation import reconcile_imported_reviews

logger = logging.getLogger(__name__)
POLL_SECONDS = 300
STARTUP_DELAY_SECONDS = 60
_lock = threading.Lock()
_thread = None
_stop = threading.Event()


def run_scheduled_reconciliation():
    if connection.vendor != 'postgresql' or connection.in_atomic_block or not connection.get_autocommit():
        raise RuntimeError('Scheduled Review feedback requires canonical PostgreSQL autocommit.')
    return reconcile_imported_reviews(should_stop=_stop.is_set, lock_profiles=True)


def _loop():
    if _stop.wait(STARTUP_DELAY_SECONDS):
        return
    while not _stop.is_set():
        try:
            counts = run_scheduled_reconciliation()
            if counts is not None:
                logger.info('Review feedback reconciliation counts=%s', counts)
        except Exception as exc:  # keep committed source work retryable after an outage
            logger.error('Review feedback sweep failed (%s); it will retry.', type(exc).__name__)
        finally:
            connections.close_all()
        _stop.wait(POLL_SECONDS)


def start_scheduler():
    global _thread
    if os.environ.get('REVIEW_FEEDBACK_SCHEDULE', 'true').strip().lower() in {'false', '0', 'off', 'no'}:
        return False
    if any(arg in {'test', 'pytest', 'py.test'} for arg in sys.argv) or 'PYTEST_CURRENT_TEST' in os.environ:
        return False
    if (getattr(settings, 'CHAT_TEST_MODE', False) or getattr(settings, 'RUN_APP_ON_TEST_BRANCH', False)
            or not (settings.DEBUG or (settings.LEARNER_FEEDBACK_ENABLED
                                       and settings.LEARNER_NON_LECTURE_FEEDBACK_ENABLED))):
        return False
    with _lock:
        if _thread is None or not _thread.is_alive():
            thread = threading.Thread(target=_loop, name='review-feedback-reconciliation', daemon=True)
            try:
                thread.start()
            except RuntimeError as exc:
                logger.error('Review feedback scheduler could not start (%s); next request will retry.',
                             type(exc).__name__)
                return False
            _thread = thread
    return True


class ReviewFeedbackWSGI:
    def __init__(self, application):
        self.application = application

    def __call__(self, environ, start_response):
        start_scheduler()
        return self.application(environ, start_response)


class ReviewFeedbackASGI:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope.get('type') == 'http':
            start_scheduler()
        return await self.application(scope, receive, send)
