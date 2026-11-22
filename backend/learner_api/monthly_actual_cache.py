"""Durable monthly-actual snapshots derived from the canonical Monthly Logs reader.

PostgreSQL triggers clear these snapshots and notify
``lms_monthly_actuals_changed`` whenever an accepted-hours dependency changes.
The null state is the durable queue; the scheduler consumes it, so a missed
notification or process restart cannot leave a snapshot permanently stale.
"""
import json
import logging
from decimal import Decimal, ROUND_HALF_UP

from django.db import connections, transaction
from django.utils import timezone

from . import canonical_learning as canonical
from . import journal_sources, monthly_logs

log = logging.getLogger(__name__)

VIEW_FIELDS = (
    'row_count', 'planned_hours', 'estimated_hours', 'snapshot_digest',
    'submitted_hours', 'not_accepted_hours', 'total_actual_hours',
    'verification_hours',
)
ADVISORY_LOCK_NAMESPACE = 11092026


def _seconds(hours):
    value = Decimal(str(hours or 0)) * Decimal(3600)
    return int(value.quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def _view(month):
    return {field: month.get(field, 0) for field in VIEW_FIELDS}


def build_payloads(standard, journal, *, computed_at):
    """Build cache payloads from two already-canonical Monthly Logs responses."""
    by_view = {
        'standard': {row['month']: row for row in standard.get('months') or []},
        'journal': {row['month']: row for row in journal.get('months') or []},
    }
    result = {}
    for month in sorted(set(by_view['standard']) | set(by_view['journal'])):
        standard_month = by_view['standard'].get(month)
        journal_month = by_view['journal'].get(month)
        if standard_month is None or journal_month is None:
            raise ValueError(f'Monthly actual view is incomplete for {month}.')
        standard_seconds = _seconds(standard_month.get('actual_hours'))
        journal_seconds = _seconds(journal_month.get('actual_hours'))
        if standard_seconds != journal_seconds:
            raise ValueError(f'Monthly accepted-hours views disagree for {month}.')
        result[month] = {
            'seconds': standard_seconds,
            'summary': {
                'version': 1,
                'complete': True,
                'seconds': standard_seconds,
                'computed_at': computed_at.isoformat(),
                'valid_until': None,
                'views': {
                    'standard': _view(standard_month),
                    'journal': _view(journal_month),
                },
                'totals': {
                    'standard': standard.get('training_plan_totals') or {},
                    'journal': journal.get('training_plan_totals') or {},
                },
            },
        }
    return result


def _owner_for_profile(profile_id, cursor):
    cursor.execute('''SELECT enrolment_id FROM "Learner".learners WHERE id=%s''', [profile_id])
    matches = cursor.fetchall()
    if len(matches) != 1 or matches[0][0] is None:
        raise LookupError('The consolidated learner identity needs review.')
    enrolment_id = int(matches[0][0])
    owner = canonical.require_profile(enrolment_id)
    if int(owner['id']) != int(profile_id):
        raise LookupError('The consolidated learner identity needs review.')
    return enrolment_id, owner


def _summary_learner(enrolment_id, owner):
    return {
        **owner,
        'id': enrolment_id,
        '_profile': owner,
        '_canonical_profile': owner,
        '_view_as': False,
    }


def _canonical_summaries(enrolment_id, owner):
    learner = _summary_learner(enrolment_id, owner)
    options = {'include_open': True, 'include_future': True}
    with journal_sources.standard_monthly_reads():
        standard = monthly_logs.summary_data(learner, **options)
    with journal_sources.learner_journal_reads():
        journal = monthly_logs.summary_data(learner, **options)
    return standard, journal


def refresh_learner(profile_id, *, database='enrolment'):
    """Refresh one profile's existing target rows; never create or alter targets."""
    profile_id = int(profile_id)
    computed_at = timezone.now()
    with transaction.atomic(using=database), connections[database].cursor() as cursor:
        cursor.execute('SELECT pg_try_advisory_xact_lock(%s,%s)',
                       [ADVISORY_LOCK_NAMESPACE, profile_id])
        if not cursor.fetchone()[0]:
            return {'profile_id': profile_id, 'status': 'busy', 'updated': 0}
        enrolment_id, owner = _owner_for_profile(profile_id, cursor)
        standard, journal = _canonical_summaries(enrolment_id, owner)
        payloads = build_payloads(standard, journal, computed_at=computed_at)
        cursor.execute('''SELECT chosen.id,chosen.report_month
            FROM "Learner".learner_monthly_targets chosen
            JOIN (
                SELECT DISTINCT ON (report_month) id
                FROM "Learner".learner_monthly_targets
                WHERE learner_id=%s AND coalesce(programme_profile_id,'')=''
                  AND (programme_id IS NULL OR programme_id IS NOT DISTINCT FROM %s)
                ORDER BY report_month,
                  (programme_id IS NOT DISTINCT FROM %s) DESC,
                  updated_at DESC,id DESC
            ) selected ON selected.id=chosen.id
            FOR UPDATE OF chosen''', [profile_id, owner.get('programme_id'), owner.get('programme_id')])
        targets = cursor.fetchall()
        updated = 0
        for target_id, month in targets:
            payload = payloads.get(month)
            if payload is None:
                continue
            cursor.execute('''UPDATE "Learner".learner_monthly_targets
                SET actual_seconds_total=%s,actual_updated_at=%s,actual_summary=%s::jsonb
                WHERE id=%s AND learner_id=%s''', [
                    payload['seconds'], computed_at, json.dumps(payload['summary']),
                    target_id, profile_id,
                ])
            updated += cursor.rowcount
    return {'profile_id': profile_id, 'status': 'refreshed', 'updated': updated,
            'months': {month: payload['seconds'] for month, payload in payloads.items()}}


def sync_completed_hours(profile_id, *, database='enrolment'):
    """Synchronize the two-decimal legacy snapshot from canonical accepted hours."""
    profile_id = int(profile_id)
    with transaction.atomic(using=database), connections[database].cursor() as cursor:
        cursor.execute('SELECT pg_try_advisory_xact_lock(%s,%s)',
                       [ADVISORY_LOCK_NAMESPACE + 1, profile_id])
        if not cursor.fetchone()[0]:
            return {'profile_id': profile_id, 'status': 'busy'}
        enrolment_id, owner = _owner_for_profile(profile_id, cursor)
        metrics = canonical.metrics(enrolment_id, owner=owner)
        actual = (metrics.get('otjh') or {}).get('completed_actual')
        if actual is None:
            actual = (metrics.get('otjh') or {}).get('actual')
        if actual is None:
            raise ValueError('Canonical accepted hours are unavailable.')
        value = Decimal(str(actual)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        cursor.execute('SELECT completed_hours FROM "Learner".learners WHERE id=%s FOR UPDATE',
                       [profile_id])
        before = cursor.fetchone()[0]
        if before != value:
            cursor.execute('''UPDATE "Learner".learners
                SET completed_hours=%s,updated_at=CURRENT_TIMESTAMP WHERE id=%s''',
                           [value, profile_id])
    return {'profile_id': profile_id, 'status': 'synchronized',
            'before': before, 'after': value}


def invalidated_profile_ids(*, limit=25, database='enrolment'):
    with connections[database].cursor() as cursor:
        cursor.execute('''SELECT learner_id
            FROM "Learner".learner_monthly_targets
            WHERE actual_updated_at IS NULL
            GROUP BY learner_id ORDER BY min(id) LIMIT %s''', [max(1, int(limit))])
        return [int(row[0]) for row in cursor.fetchall()]


def refresh_invalidated(*, limit=25, database='enrolment'):
    counts = {'refreshed': 0, 'busy': 0, 'failed': 0, 'failedProfiles': []}
    for profile_id in invalidated_profile_ids(limit=limit, database=database):
        try:
            result = refresh_learner(profile_id, database=database)
            counts['busy' if result['status'] == 'busy' else 'refreshed'] += 1
        except Exception as error:  # noqa: BLE001 - one learner cannot block the durable queue
            counts['failed'] += 1
            counts['failedProfiles'].append(profile_id)
            log.error('monthly_actual_refresh_failed learner_profile_id=%s error=%s',
                      profile_id, type(error).__name__)
    return counts
