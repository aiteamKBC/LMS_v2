"""Persisted, per-learner plan counts. HTTP reads never build a learning plan.

Uses the existing projection store, independently of the whole-dashboard outbox.
Dirty rows retain their last successful value. A compare-and-set lease prevents
duplicate builders and stops a concurrent source change being overwritten.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import logging
import threading
import time
import uuid

from django.conf import settings
from django.db import connections, transaction
from django.db.models import Q
from django.db.models.functions import Lower, Trim
from django.utils import timezone

from learner_api.models import LearnerProfile, EnrolmentUser
from read_models.models import ReadModel

log = logging.getLogger(__name__)
MODEL = 'coach.activity-plan'
SCOPE = 'learner-profile'
VERSION = 1
ALIAS = 'enrolment'
LEASE = timedelta(minutes=5)
RECHECK = timedelta(hours=24)
_thread = None
_lock = threading.Lock()
_wake = threading.Event()


def store():
    return ReadModel.objects.using(ALIAS).filter(model_key=MODEL, scope_type=SCOPE)


def ensure_profiles(ids):
    """Queue initial summaries; never replace an existing successful projection."""
    now = timezone.now()
    ReadModel.objects.using(ALIAS).bulk_create([
        ReadModel(model_key=MODEL, scope_type=SCOPE, scope_id=str(pk), schema_version=VERSION,
                  payload={}, expires_at=now) for pk in set(ids)
    ], ignore_conflicts=True)
    _wake.set()


def mark_dirty(ids=None, *, using=ALIAS):
    """Called in/on commit of source writes. No calculated values are discarded."""
    def invalidate():
        try:
            rows = store()
            if ids is not None:
                rows = rows.filter(scope_id__in=[str(pk) for pk in ids])
            rows.update(expires_at=timezone.now())
            _wake.set()
        except Exception:
            log.warning('activity_plan_invalidation_failed', exc_info=True)
    transaction.on_commit(invalidate, using=using)


def mark_sources_dirty(source_ids, *, using=ALIAS):
    ids = list(LearnerProfile.objects.using(using).filter(enrolment_id__in=source_ids).values_list('pk', flat=True))
    mark_dirty(ids, using=using)


def snapshot_fields(row, enrolment_id, *, now):
    payload = row.payload if row and row.schema_version == VERSION else {}
    plan = payload.get('activityPlan')
    if payload.get('enrolmentId') != enrolment_id:
        plan = None
    dirty = not row or row.expires_at is None or row.expires_at <= now
    state = ('updating' if dirty else 'ready') if plan else 'pending'
    if row and (row.source_revision or {}).get('error'):
        state = 'unavailable'
    result = {'activityPlan': plan, 'activityPlanState': state,
              'activityPlanCalculatedAt': payload.get('calculatedAt') if plan else None}
    if plan and type(payload.get('completedRecords')) is int:
        result['completedRecords'] = payload['completedRecords']
    return result


def attach_snapshots(owner_email, payload):
    """One bulk ownership read and one projection read, regardless of row count."""
    items = payload.get('learners') or []
    if not items:
        return
    ids = [int(item['id']) for item in items if str(item.get('id', '')).isdigit()]
    owned = dict(LearnerProfile.objects.using(ALIAS).annotate(owner=Lower(Trim('coach_email')))
        .filter(pk__in=ids, owner=owner_email.strip().lower(), enrolment_id__isnull=False).values_list('pk', 'enrolment_id'))
    try:
        rows = {int(row.scope_id): row for row in store().filter(scope_id__in=list(map(str, owned)))}
        missing = set(owned) - set(rows)
        queue_failed = set()
        if missing:
            try:
                ensure_profiles(missing)
            except Exception:
                queue_failed = missing
                log.warning('activity_plan_initial_queue_failed', exc_info=True)
        now = timezone.now()
        for item in items:
            pk = int(item['id'])
            fields = snapshot_fields(rows.get(pk), owned.get(pk), now=now) if pk in owned else {
                'activityPlan': None, 'activityPlanState': 'unavailable', 'activityPlanCalculatedAt': None}
            if pk in queue_failed:
                fields['activityPlanState'] = 'unavailable'
            item.update(fields)
        start_worker()
    except Exception:
        log.warning('activity_plan_snapshot_read_failed', exc_info=True)
        for item in items:
            item.update(activityPlan=None, activityPlanState='unavailable', activityPlanCalculatedAt=None)


def _claim(scope_ids=None):
    now = timezone.now()
    with transaction.atomic(using=ALIAS):
        # All web processes share this bound, including development runservers.
        with connections[ALIAS].cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(%s)', [673140921])
        if store().filter(source_revision__has_key='token', source_revision__leaseUntil__gt=now.isoformat()).count() >= 4:
            return None
        due = store().filter(expires_at__lte=now)
        if scope_ids is not None:
            due = due.filter(scope_id__in=scope_ids)
        row = due.filter(
            Q(source_revision__leaseUntil__isnull=True) | Q(source_revision__leaseUntil__lte=now.isoformat())
        ).order_by('expires_at', 'pk').first()
        if row is None:
            return None
        claim = {'token': str(uuid.uuid4()), 'leaseUntil': (now + LEASE).isoformat()}
        store().filter(pk=row.pk).update(source_revision=claim)
        row.source_revision = claim
        return row


def build_payload(profile_id, *, as_of):
    from .dashboard_activity_plan import plan_activity_counts
    from .activity_plan_reconcile import fingerprints
    revision = fingerprints([profile_id]).get(profile_id)
    profile = LearnerProfile.objects.using(ALIAS).get(pk=profile_id)
    source = EnrolmentUser.all_learners.using(ALIAS).get(pk=profile.enrolment_id)
    plan = plan_activity_counts(source, profile, as_of=as_of, include_record_counts=True)
    records = plan.pop('completedRecords')
    if not revision or fingerprints([profile_id]).get(profile_id) != revision:
        raise ValueError('Source changed while calculating activity counts')
    return {'enrolmentId': source.pk, 'activityPlan': plan, 'completedRecords': records,
            'calculatedAt': as_of.isoformat(), 'sourceFingerprint': revision}


def refresh_one(scope_ids=None):
    row = None
    try:
        row = _claim() if scope_ids is None else _claim(scope_ids)
        if row is None:
            return False
        started = timezone.now()
        payload = build_payload(int(row.scope_id), as_of=started)
        # A save/mark/delete arriving during the build changes expires_at. Keep
        # that dirty marker and run again; never publish a falsely fresh result.
        saved = store().filter(pk=row.pk, source_revision=row.source_revision, expires_at=row.expires_at).update(
            payload=payload, schema_version=VERSION, refreshed_at=started,
            expires_at=started + RECHECK, source_revision={}, status=ReadModel.STATUS_READY)
        if not saved:
            store().filter(pk=row.pk, source_revision=row.source_revision).update(source_revision={})
        return True
    except Exception as error:
        log.warning('activity_plan_snapshot_refresh_failed error=%s', type(error).__name__)
        if row is not None:
            store().filter(pk=row.pk, source_revision=row.source_revision).update(source_revision={
                'error': True, 'leaseUntil': (timezone.now() + timedelta(minutes=1)).isoformat()})
        return False
    finally:
        connections.close_all()


def _run():
    from .activity_plan_reconcile import reconcile
    last_reconciled = 0
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix='activity-snapshot') as pool:
        while True:
            try:
                if time.monotonic() - last_reconciled >= 60:
                    try:
                        reconcile()
                    finally:
                        connections.close_all()
                        last_reconciled = time.monotonic()
                worked = [job.result() for job in [pool.submit(refresh_one), pool.submit(refresh_one)]]
                if any(worked):
                    continue
            except Exception:
                log.warning('activity_plan_worker_failed', exc_info=True)
            _wake.wait(5)
            _wake.clear()


def start_worker():
    global _thread
    if not getattr(settings, 'COACH_ACTIVITY_PLAN_WORKER_ENABLED', True):
        return
    with _lock:
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_run, name='activity-plan-snapshots', daemon=True)
            _thread.start()
