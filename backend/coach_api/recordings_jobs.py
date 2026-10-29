"""Durable background jobs. HTTP paths enqueue/read; Microsoft I/O runs in workers."""
from datetime import timedelta
from hashlib import sha256
import json
import logging
import os
import sys
import threading
import uuid
from types import SimpleNamespace

from django.conf import settings
from django.core.cache import cache
from django.db import close_old_connections, transaction, router, connections
from django.db.models import Q, F, Case, When, Value, IntegerField, Count, Max
from django.utils import timezone

from .models import CoachingRecordingJob
from .recordings_calendar import _instant
from .recordings_calendar_media import calendar_key, calendar_record, event_context, attendance_rows
from .recordings_errors import calendar_failure

log = logging.getLogger(__name__)
_lock = threading.Lock()
_threads = []
_stop = threading.Event()
_wake = threading.Event()
ACCOUNT_FAILURES = ('calendar_not_found', 'calendar_mailbox_unavailable', 'calendar_access_denied')


def job_key(kind, context):
    return kind + ':' + sha256(json.dumps(context, sort_keys=True).encode()).hexdigest()


def account_failures(owners, now):
    """A failed mailbox belongs to an account, not each visited date window."""
    if not owners:
        return {}
    blocked = {}
    failures = list(CoachingRecordingJob.objects.filter(kind='calendar', owner_email__in=owners,
        state='failed', retryable=False, attempts__gt=0, error_code__in=ACCOUNT_FAILURES, next_run_at__gt=now
        ).order_by('-updated_at').values('owner_email', 'error_code', 'next_run_at', 'updated_at'))
    if not failures:
        return blocked
    successes = dict(CoachingRecordingJob.objects.filter(kind='calendar', owner_email__in={row['owner_email'] for row in failures})
        .values('owner_email').annotate(latest=Max('last_success_at')).values_list('owner_email', 'latest'))
    for row in failures:
        success = successes.get(row['owner_email'])
        if success is None or success < row['updated_at']:
            blocked.setdefault(row['owner_email'], row)
    return blocked


def ensure_jobs(items, *, refresh=False, include_result=True):
    now = timezone.now()
    rows = [CoachingRecordingJob(key=job_key(item[0], item[1]), kind=item[0], owner_email=item[1]['owner'],
        context=item[1], result=item[2] if len(item) > 2 else {}, next_run_at=now) for item in items]
    if not rows:
        return {}
    blocked = account_failures({row.owner_email for row in rows if row.kind == 'calendar'}, now) if not refresh else {}
    for row in rows:
        failure = blocked.get(row.owner_email) if row.kind == 'calendar' else None
        if failure:
            row.state, row.error_code, row.retryable = 'failed', failure['error_code'], False
            row.next_run_at = failure['next_run_at']
    # Only new windows inherit the pause. Existing queued manual retries must
    # survive ordinary browser polls while waiting for a worker to claim them.
    CoachingRecordingJob.objects.bulk_create(rows, ignore_conflicts=True)
    keys = [row.key for row in rows]
    if refresh:
        CoachingRecordingJob.objects.filter(key__in=keys).exclude(state='running').update(
            state='queued', next_run_at=now, error_code='', retryable=True, updated_at=now)
    _wake.set()
    start_workers()
    found = CoachingRecordingJob.objects.filter(key__in=keys)
    if not include_result:
        found = found.defer('result')
    return {row.key: row for row in found}


def cached_results(rows, field):
    """Batch cache immutable last-success data; always read live job state first."""
    namespace = sha256(json.dumps(settings.DATABASES, sort_keys=True, default=str).encode()).hexdigest()[:24]
    keys = {row['key']: f'coach-snapshot:v2:{namespace}:{field}:{row["key"]}:{row["last_success_at"].isoformat()}'
            for row in rows if row['last_success_at']}
    try:
        saved = cache.get_many(list(keys.values()))
    except Exception:
        saved = {}
        log.warning('Coaching snapshot cache unavailable; reading durable snapshots.')
    missing = [key for key, cache_key in keys.items() if cache_key not in saved]
    if missing:
        if field == 'media':
            fresh = {keys[row['key']]: {'artifacts': row['result__artifacts'] or [], 'noTeams': row['result__noTeams'] is True}
                for row in CoachingRecordingJob.objects.filter(key__in=missing).values('key', 'result__artifacts', 'result__noTeams')}
        else:
            fresh = {keys[row['key']]: row['value'] or [] for row in CoachingRecordingJob.objects.filter(key__in=missing)
                     .annotate(value=F(f'result__{field}')).values('key', 'value')}
        saved.update(fresh)
        try:
            cache.set_many(fresh, timeout=300)
        except Exception:
            log.warning('Coaching snapshot cache unavailable; durable snapshots retained.')
    return {row['key']: saved.get(keys.get(row['key']), {} if field == 'media' else []) for row in rows}


def calendar_snapshots(coaches, start, end, *, refresh=False):
    # A saved month also serves its day/week views, without another Graph scan.
    covering = {}
    for row in CoachingRecordingJob.objects.filter(kind='calendar', owner_email__in=[row['email'] for row in coaches],
            last_success_at__isnull=False, context__start__lte=start.isoformat(), context__end__gte=end.isoformat()
            ).order_by('-last_success_at').values('owner_email', 'context'):
        covering.setdefault(row['owner_email'], row['context'])
    items = [('calendar', covering.get(row['email'], {'owner': row['email'], 'start': start.isoformat(), 'end': end.isoformat()})) for row in coaches]
    jobs = ensure_jobs(items, refresh=refresh, include_result=False)
    from .recordings_index import indexed_calendars
    events = indexed_calendars(jobs.values(), start, end)
    missing = [{'key': row.key, 'last_success_at': row.last_success_at}
               for row in jobs.values() if row.key not in events]
    if missing:
        # Rolling backfill can use the retained complete source snapshot. An
        # absent/stale index never becomes a fabricated successful empty view.
        events.update(cached_results(missing, 'events'))
    now = timezone.now()
    # Foreground calendar navigation must not sit behind an old evidence backlog.
    CoachingRecordingJob.objects.filter(key__in=list(jobs), next_run_at__lte=now).exclude(state='running').update(updated_at=now)
    if len(coaches) == 1:
        focused = [job_key('evidence', event_context(row.owner_email, event))
                   for row in jobs.values() for event in events[row.key]]
        CoachingRecordingJob.objects.filter(key__in=focused, next_run_at__lte=now).exclude(state='running').update(updated_at=now)
    if refresh:
        # An explicit retry also renews evidence whose provider/storage failure
        # may have been repaired since the last attempt. Identity stays stable.
        ensure_jobs([('evidence', event_context(row.owner_email, event), {'event': event})
                     for row in jobs.values() for event in events[row.key]
                     if not event.get('isCancelled') and _instant(event_context(row.owner_email, event)['start']) <= timezone.now()], refresh=True)
    result = []
    for kind, context in items:
        job = jobs[job_key(kind, context)]
        pending = job.state in ('queued', 'running') or bool(job.next_run_at and job.next_run_at <= timezone.now())
        result.append({'events': events[job.key] if job.last_success_at else None,
            'pending': pending, 'error': {'code': job.error_code, 'retryable': job.retryable} if job.error_code else None,
            'syncedAt': job.last_success_at.isoformat() if job.last_success_at else None})
    return result


def evidence_jobs(contexts):
    keyed = {job_key('evidence', context): context for context in contexts}
    keys = list(keyed)
    if not keys:
        return {}
    # Calendar polling needs file availability, not every participant/report.
    rows = list(CoachingRecordingJob.objects.filter(key__in=keys).values('key', 'state', 'error_code', 'next_run_at', 'last_success_at'))
    files = cached_results(rows, 'media')
    return {calendar_key(keyed[row['key']]): SimpleNamespace(context=keyed[row['key']], state=row['state'],
        error_code=row['error_code'], next_run_at=row['next_run_at'], last_success_at=row['last_success_at'],
        result={'artifacts': files[row['key']].get('artifacts', []), 'noTeams': files[row['key']].get('noTeams', False)}) for row in rows}


def source_summary(job):
    """Microsoft is the only playback source for the coaching workspace."""
    files = {}
    for artifact in (job.result.get('artifacts', []) if job else []):
        if artifact.get('artifact_type', 'recording') != 'recording':
            continue
        identity = artifact['graph_artifact_id']
        available = artifact.get('sourceAvailable') is True
        files[identity] = {'id': identity, 'startsAt': artifact.get('created_datetime'), 'endsAt': artifact.get('end_datetime'),
            'state': 'ready' if available else 'unavailable', 'source': 'microsoft'}
    rows = list(files.values())
    ready = sum(row['state'] == 'ready' for row in rows)
    state = 'ready' if ready else 'unavailable' if rows or (job and job.error_code) else 'pending'
    checked = getattr(job, 'last_success_at', None)
    check = {'state': 'failed' if job and job.error_code else 'complete' if checked else 'pending',
             'checkedAt': checked.isoformat() if checked else None}
    if check['state'] == 'complete' and not rows:
        # An empty successful provider response is not an unfinished discovery,
        # nor proof that no recording was ever made. Keep the playback contract.
        check['reason'] = 'no-teams-link' if job.result.get('noTeams') else 'no-recordings-returned'
    return {'state': state,
            'readyCount': ready, 'recordings': rows, 'check': check}


def source_details(record, *, discover=False):
    """Read saved evidence; an authorised detail view may enqueue one started occurrence."""
    from .recordings_media import session_window
    from .recordings_calendar_media import calendar_context
    start, end = session_window(record)
    if not start or not end or not getattr(record, 'graph_event_id', None):
        return None
    context = calendar_context(record.owner_email, record.graph_event_id, start, end)
    job = CoachingRecordingJob.objects.filter(key=job_key('evidence', context)).first()
    if job is None and discover and start <= timezone.now():
        job = ensure_jobs([('evidence', context)]).get(job_key('evidence', context))
    return job


def queue_attendance(record):
    """Called only after authorization when the user opens one meeting."""
    from .recordings_media import session_window
    from .recordings_calendar_media import calendar_context
    start, end = session_window(record)
    if not start or not end or not getattr(record, 'graph_event_id', None) or start > timezone.now():
        return None
    context = calendar_context(record.owner_email, record.graph_event_id, start, end)
    return next(iter(ensure_jobs([('attendance', context)]).values()))


def claim_job(kinds, *, owner=None):
    # Old archive rows are retained for history but can never be claimed again.
    kinds = tuple(kind for kind in kinds if kind in ('calendar', 'evidence', 'attendance'))
    if not kinds:
        return None
    now = timezone.now()
    due = Q(next_run_at__lte=now) & (~Q(state='running') | Q(lease_until__lte=now))
    if not CoachingRecordingJob.objects.filter(due, kind__in=kinds).exists():
        return None
    database = router.db_for_write(CoachingRecordingJob) or 'default'
    with transaction.atomic(using=database):
        # One short transaction lock coordinates the tenant-wide budget across
        # web workers/services and CLI runners; no lock is held during I/O.
        if connections[database].vendor == 'postgresql':
            with connections[database].cursor() as cursor:
                cursor.execute('SELECT pg_advisory_xact_lock(%s,%s)', [1346525001, 1])
        active = CoachingRecordingJob.objects.filter(state='running', lease_until__gt=now)
        counts = dict(active.values('kind').annotate(total=Count('key')).values_list('kind', 'total'))
        metadata = sum(counts.get(kind, 0) for kind in ('calendar', 'evidence', 'attendance'))
        # A slow mailbox must never occupy the two recording-discovery slots.
        caps = {'calendar': 1, 'evidence': 2, 'attendance': 1}
        allowed = [kind for kind in kinds if metadata < 3 and counts.get(kind, 0) < caps[kind]]
        if not allowed:
            return None
        rows = CoachingRecordingJob.objects.select_for_update(skip_locked=True).filter(due, kind__in=allowed)
        if owner:
            rows = rows.filter(owner_email=owner)
        priority = Case(When(kind='calendar', then=Value(0)), When(kind='attendance', then=Value(1)), default=Value(2), output_field=IntegerField())
        row = rows.order_by(priority, '-updated_at', 'next_run_at', 'key').first()
        if row is None:
            return None
        row.claim = uuid.uuid4()
        row.state = 'running'
        row.lease_until = now + timedelta(minutes=10)
        row.next_run_at = row.lease_until
        row.attempts += 1
        row.save(update_fields=['claim', 'state', 'lease_until', 'next_run_at', 'attempts', 'updated_at'])
        return row


def complete(row, result, *, seconds=None):
    now = timezone.now()
    database = router.db_for_write(CoachingRecordingJob) or 'default'
    with transaction.atomic(using=database):
        changed = CoachingRecordingJob.objects.using(database).filter(pk=row.pk, claim=row.claim).update(
            result=result, state='idle', claim=None, lease_until=None, last_success_at=now,
            next_run_at=now + timedelta(seconds=seconds) if seconds else None,
            attempts=0, error_code='', retryable=True, updated_at=now)
        if changed and row.kind == 'calendar':
            from .recordings_index import publish_calendar_index
            publish_calendar_index(row.key, row.context, result['events'], now, using=database)
            # A recovered mailbox releases older paused windows. Their saved
            # data remains usable while its own date window is refreshed.
            CoachingRecordingJob.objects.using(database).filter(kind='calendar', owner_email=row.owner_email,
                state='failed', retryable=False, error_code__in=ACCOUNT_FAILURES).filter(
                    Q(last_success_at__isnull=True) | Q(last_success_at__lte=now)).update(
                        state='queued', error_code='', retryable=True, next_run_at=now, updated_at=now)
    return changed


def execute_job(row):
    from .recordings_api import _coaches
    from .recordings_calendar import load_coach_calendar
    from .recordings_calendar_sync import fetch_recordings, fetch_attendance, CalendarMeetingWithoutTeams
    from .recordings_transport import recording_accessible
    from .views import persist_coach_meeting_snapshots
    if row.owner_email not in {coach['email'] for coach in _coaches()}:
        raise PermissionError('Coach access was revoked.')
    context = row.context
    if context['owner'] != row.owner_email:
        raise ValueError('Invalid job owner.')
    if row.kind == 'calendar':
        start, end = _instant(context['start']), _instant(context['end'])
        events = load_coach_calendar(row.owner_email, start, end)
        now = timezone.now()
        items = []
        for event in events:
            occurrence = event_context(row.owner_email, event)
            if not event.get('isCancelled') and _instant(occurrence['start']) <= now:
                items.append(('evidence', occurrence, {'event': event}))
        # Enqueue before publishing idle: a reader must never see a completed
        # calendar with no evidence jobs yet and stop polling prematurely.
        items.sort(key=lambda item: item[1]['end'])
        ensure_jobs(items)
        complete(row, {'events': events}, seconds=300 if end >= now - timedelta(days=2) else 86400)
        return
    if row.kind == 'evidence':
        event = row.result.get('event') or {}
        try:
            base, organizer, artifacts = fetch_recordings(context, event)
        except CalendarMeetingWithoutTeams:
            complete(row, {'event': event, 'artifacts': [], 'reports': [], 'noTeams': True}, seconds=86400)
            return
        previous = {item['graph_artifact_id']: item for item in row.result.get('artifacts', [])}
        for artifact in artifacts:
            try:
                saved = previous.get(artifact['graph_artifact_id'], {})
                checked = _instant(saved.get('sourceCheckedAt'))
                if saved.get('sourceAvailable') and checked and checked > timezone.now() - timedelta(hours=24):
                    artifact.update(sourceAvailable=True, sourceCheckedAt=checked.isoformat())
                else:
                    artifact['sourceAvailable'] = recording_accessible(base, artifact['graph_artifact_id'])
                    artifact['sourceCheckedAt'] = timezone.now().isoformat()
            except Exception:
                artifact['sourceAvailable'] = False
        age = timezone.now() - _instant(context['end'])
        delay = 300 if age < timedelta(days=2) else 3600 if age < timedelta(days=7) else 86400
        complete(row, {**row.result, 'event': event, 'base': base, 'organizer': organizer, 'artifacts': artifacts}, seconds=delay)
        return
    if row.kind == 'attendance':
        source = CoachingRecordingJob.objects.filter(pk=job_key('evidence', context)).first()
        if not source or not source.result.get('base'):
            ensure_jobs([('evidence', context)])
            complete(row, {}, seconds=86400 if source and source.result.get('noTeams') else 30)
            return
        organizer = source.result.get('organizer') or (((source.result.get('event') or {}).get('organizer') or {}).get('emailAddress') or {}).get('address') or row.owner_email
        artifacts = source.result.get('artifacts', [])
        reports = fetch_attendance(context, source.result['base'])
        record = calendar_record(context, organizer=organizer)
        tracker = [{**person, 'id': person['email'] or f'actual:{index}', 'attended': person['status'] == 'attended'}
                   for index, person in enumerate(attendance_rows(reports))]
        stored = persist_coach_meeting_snapshots(record, artifacts=artifacts, attendance_reports=reports, attendance_tracker={'tracker': tracker})
        if not stored.get('stored'):
            raise RuntimeError('Evidence metadata could not be saved.')
        complete(row, {'reportCount': len(reports)}, seconds=300 if not reports else 3600)
        return
    raise ValueError('Unknown recording job kind.')


def run_one(kinds=('calendar', 'evidence', 'attendance'), *, owner=None):
    row = claim_job(kinds, owner=owner)
    if row is None:
        return None
    status = 'complete'
    try:
        execute_job(row)
    except Exception as error:
        status = 'failed'
        failure = calendar_failure(error)
        code = failure['code'] if row.kind == 'calendar' else 'access_revoked' if isinstance(error, PermissionError) else f'{row.kind}_unavailable'
        delay = min(3600, 30 * 2 ** min(row.attempts, 6)) if failure['retryable'] else 86400
        now = timezone.now()
        deadline = now + timedelta(seconds=delay)
        database = router.db_for_write(CoachingRecordingJob) or 'default'
        with transaction.atomic(using=database):
            changed = CoachingRecordingJob.objects.filter(pk=row.pk, claim=row.claim).update(
                state='failed', claim=None, lease_until=None, next_run_at=deadline,
                error_code=code, retryable=failure['retryable'], updated_at=now)
            if changed and row.kind == 'calendar' and code in ACCOUNT_FAILURES and not failure['retryable']:
                # Pause already queued windows too, without changing another
                # worker's lease or replacing any source/evidence history.
                CoachingRecordingJob.objects.filter(kind='calendar', owner_email=row.owner_email
                    ).exclude(pk=row.pk).exclude(state='running').filter(
                        Q(last_success_at__isnull=True) | Q(last_success_at__lte=now)).update(
                            state='failed', error_code=code, retryable=False, next_run_at=deadline, updated_at=now)
        log.warning('Coaching recording %s job failed (%s); evidence retained.', row.kind, code)
    finally:
        close_old_connections()
    return status


def _loop(kinds):
    while not _stop.is_set():
        try:
            worked = run_one(kinds)
        except Exception as error:
            log.warning('Coaching recording worker unavailable (%s).', type(error).__name__)
            worked = False
            close_old_connections()
        if not worked:
            _wake.wait(5)
            _wake.clear()


def start_workers():
    """Start only for an explicit coaching request, never on import or in tests."""
    if (getattr(settings, 'COACH_TEST_MODE', False) or any(arg in ('test', 'pytest') for arg in sys.argv)
            or 'PYTEST_CURRENT_TEST' in os.environ
            or os.environ.get('COACH_RECORDINGS_AUTOMATIC', 'true').lower() in ('false', '0', 'off')):
        return False
    with _lock:
        if any(thread.is_alive() for thread in _threads):
            return True
        for index, kinds in enumerate([('calendar',), ('evidence',), ('evidence',), ('attendance',)]):
            thread = threading.Thread(target=_loop, args=(kinds,), daemon=True, name=f'coach-recordings-{index}')
            thread.start()
            _threads.append(thread)
    return True
