"""Rebuild every Coach Dashboard snapshot on an hourly schedule.

The full dashboard build reads many remote tables and is far too slow to run
inside a page request, so the page reads the persisted CoachDashboardSnapshot
and this scheduler keeps it fresh in the background.

Like curriculum_api.session_sync_runtime, the thread is started by the HTTP
server wrappers (config.asgi / config.wsgi) after workers fork, never on import;
Django test clients and management commands do not enter those wrappers.

Every serving process runs its own thread, so each wake only rebuilds coaches
whose snapshot is older than the interval, and claims each coach with one
conditional UPDATE first.  Only the process whose UPDATE matched rebuilds that
coach; the others skip it.
"""
import hashlib
import logging
import os
import sys
import threading
from datetime import timedelta

log = logging.getLogger(__name__)

POLL_SECONDS = 300
STARTUP_DELAY_SECONDS = 60
# An old-schema snapshot is due immediately, but once claimed it must not be
# claimed again by another process while that rebuild is still running.
CLAIM_LEASE = timedelta(minutes=30)
_lock = threading.Lock()
_thread = None
_stop = threading.Event()


def interval() -> timedelta:
    try:
        seconds = int(os.environ.get('COACH_DASHBOARD_SNAPSHOT_INTERVAL_SECONDS', '3600'))
    except ValueError:
        seconds = 3600
    return timedelta(seconds=max(seconds, POLL_SECONDS))


def coach_emails(requested: str = '') -> list[str]:
    """Every Coach account's canonical email, the identity snapshots are keyed by."""
    from django.db.models.functions import Lower, Trim

    from learner_api.constants import ACCESS_COACH
    from learner_api.models import StaffUser
    from login.identity import accesses_for_staff

    queryset = StaffUser.objects.annotate(email_key=Lower(Trim('email')))
    requested = (requested or '').strip().lower()
    if requested:
        queryset = queryset.filter(email_key=requested)
    return sorted({
        row.email_key
        for row in queryset
        if row.email_key and ACCESS_COACH in accesses_for_staff(row)
    })


def claim(owner_email: str, *, now) -> bool:
    """Atomically take this coach's rebuild for the current interval."""
    from django.core.cache import cache
    from django.db.models import Q

    from coach_api.models import CoachDashboardSnapshot
    from coach_api.services.dashboard.service import CoachDashboardService

    due = Q(refreshed_at__lt=now - interval()) | (
        ~Q(schema_version=CoachDashboardService.SCHEMA_VERSION)
        & Q(refreshed_at__lt=now - CLAIM_LEASE)
    )
    rows = CoachDashboardSnapshot.objects.filter(owner_email=owner_email)
    if rows.filter(due).update(refreshed_at=now):
        return True
    if rows.exists():
        return False
    # First snapshot for this coach: there is no row to claim yet.  Redis is
    # best-effort here; if it is unavailable, at worst two processes build the
    # same first snapshot once.
    key = 'coach-dashboard-snapshot-claim:' + hashlib.sha256(owner_email.encode('utf-8')).hexdigest()
    try:
        return bool(cache.add(key, 1, timeout=int(CLAIM_LEASE.total_seconds())))
    except Exception:  # noqa: BLE001 - cache availability must not stop the schedule
        return True


def refresh_due_snapshots(*, emails=None, force: bool = False, now=None) -> dict:
    """Rebuild each due coach; one coach failing never stops the others."""
    from django.db import close_old_connections
    from django.utils import timezone

    from coach_api.dashboard_cache import invalidate_coach_dashboard_cache
    from coach_api.services.dashboard.service import CoachDashboardService

    counts = {'refreshed': 0, 'skipped': 0, 'failed': 0, 'failedCoaches': []}
    for owner_email in (coach_emails() if emails is None else emails):
        if _stop.is_set():
            break
        try:
            if not force and not claim(owner_email, now=now or timezone.now()):
                counts['skipped'] += 1
                continue
            CoachDashboardService(owner_email).refresh()
            # The page caches its response briefly; drop it so the next load
            # shows the snapshot that was just written.
            invalidate_coach_dashboard_cache(owner_email)
            counts['refreshed'] += 1
        except Exception as error:  # noqa: BLE001 - isolate each coach
            counts['failed'] += 1
            counts['failedCoaches'].append(owner_email)
            log.error('coach_dashboard_snapshot_refresh_failed coach_account_id=%s error=%s',
                      owner_email, type(error).__name__)
        finally:
            close_old_connections()
    return counts


def _loop():
    from django.db import connections

    _stop.wait(STARTUP_DELAY_SECONDS)
    while not _stop.is_set():
        try:
            counts = refresh_due_snapshots()
            if counts['refreshed'] or counts['failed']:
                log.info('coach_dashboard_snapshot_schedule refreshed=%s skipped=%s failed=%s',
                         counts['refreshed'], counts['skipped'], counts['failed'])
        except Exception as error:  # noqa: BLE001 - keep the schedule alive
            log.error('Coach Dashboard snapshot schedule could not run (%s); it will retry.',
                      type(error).__name__)
        finally:
            connections.close_all()
        _stop.wait(POLL_SECONDS)


def start_scheduler() -> bool:
    """One scheduler thread per serving process, including after a preloaded fork."""
    global _thread
    if os.environ.get('COACH_DASHBOARD_SNAPSHOT_SCHEDULE', 'true').strip().lower() in {'0', 'false', 'off', 'no'}:
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
            thread = threading.Thread(target=_loop, name='coach-dashboard-snapshots', daemon=True)
            thread.start()
        except RuntimeError as error:
            log.error('Could not start the Coach Dashboard snapshot schedule (%s).', type(error).__name__)
            return False
        _thread = thread
    return True


class CoachDashboardSnapshotWSGI:
    def __init__(self, application):
        self.application = application

    def __call__(self, environ, start_response):
        start_scheduler()
        return self.application(environ, start_response)


class CoachDashboardSnapshotASGI:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http':
            start_scheduler()
        await self.application(scope, receive, send)
