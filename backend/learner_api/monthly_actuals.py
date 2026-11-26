"""Persisted Monthly Logs summaries, refreshed only by identified write events.

Reads never repair or refresh data. Missing, invalidated, incomplete or expired
snapshots fall back to the existing canonical reader. The event listener is an
explicit management command, never an application-startup thread or timer.
"""
from contextlib import contextmanager
from datetime import datetime
import json
import math

from django.core.serializers.json import DjangoJSONEncoder
from django.db import connections, transaction
from django.utils import timezone

from old_otjh import repository
from . import canonical_learning as canonical, journal_sources
from .monthly_log_sources import decoded

# Bump when canonical hour allocation or signed-row digest rules change.
VERSION = 1
CHANNEL = 'lms_monthly_actuals_changed'
MONTH_FIELDS = (
    'row_count', 'planned_hours', 'estimated_hours', 'not_accepted_hours',
    'total_actual_hours', 'snapshot_digest', 'submitted_hours', 'verification_hours',
)
TARGET_SQL = '''SELECT DISTINCT ON (report_month)
    id,learner_id,report_month,target_hours,actual_seconds_total,actual_updated_at,actual_summary
    FROM "Learner".learner_monthly_targets
    WHERE learner_id=%s AND coalesce(programme_profile_id,'')=''
      AND (programme_id IS NULL OR programme_id IS NOT DISTINCT FROM %s)
    ORDER BY report_month,(programme_id IS NOT DISTINCT FROM %s) DESC,updated_at DESC,id DESC'''


def storage_available(using):
    """One bounded schema check; do not cache across different databases/DDL."""
    connection = connections[using]
    if connection.vendor != 'postgresql':
        return False
    with connection.cursor() as cursor:
        cursor.execute('''SELECT EXISTS(SELECT 1 FROM pg_attribute
            WHERE attrelid=to_regclass('"Learner".learner_monthly_targets')
              AND attname='actual_summary' AND NOT attisdropped)
            AND to_regprocedure('"Learner".invalidate_monthly_actuals(bigint[])') IS NOT NULL
            AND (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
                 AND tgname ~ '^monthly_actual_event_[0-9]+_(insert|update|delete)$')=87''')
        return cursor.fetchone()[0]


def selected_targets(owner):
    return repository.query(TARGET_SQL, [owner['id'], owner.get('programme_id'), owner.get('programme_id')])


def snapshot(owner, *, now=None):
    """Return a complete, current snapshot or None; zero remains a valid total."""
    using = repository._query_alias.get() or repository.DB
    if not storage_available(using):
        return None
    rows = selected_targets(owner)
    rows = [item for item in rows if item['target_hours'] is not None]
    if not rows:
        return None
    now = now or timezone.now()
    variant = 'journal' if journal_sources.enabled() else 'standard'
    timestamp, totals, states, unallocated = None, None, {}, None
    for item in rows:
        meta = decoded(item.get('actual_summary'), {})
        seconds, updated = item.get('actual_seconds_total'), item.get('actual_updated_at')
        if not isinstance(meta, dict) or meta.get('version') != VERSION or not meta.get('complete'):
            return None
        if seconds is None or updated is None or seconds < 0:
            return None
        if meta.get('seconds') != seconds or meta.get('computed_at') != updated.isoformat():
            return None  # Independent/manual total edits must not reuse older metadata.
        if timestamp is not None and updated != timestamp:
            return None  # Never combine two different projection generations.
        timestamp = updated
        until = meta.get('valid_until')
        if until:
            try:
                expires = datetime.fromisoformat(until)
                if expires.tzinfo is None or now >= expires:
                    return None
            except (TypeError, ValueError):
                return None
        views = meta.get('views')
        view = views.get(variant) if isinstance(views, dict) else None
        if not isinstance(view, dict) or any(key not in view for key in MONTH_FIELDS):
            return None
        total_views = meta.get('totals')
        programme_totals = total_views.get(variant) if isinstance(total_views, dict) else None
        if (not isinstance(programme_totals, dict)
                or not {'accepted_hours', 'planned_hours'} <= programme_totals.keys()
                or totals is not None and totals != programme_totals):
            return None
        totals = programme_totals
        # Owner-level unallocated activity is stored once, on the first current
        # target. It remains visible without duplicating that list every month.
        if 'unallocated' in meta:
            values = meta['unallocated']
            values = values.get(variant) if isinstance(values, dict) else None
            if unallocated is not None or not isinstance(values, list):
                return None
            unallocated = values
        states[item['report_month']] = {
            **{key: view[key] for key in MONTH_FIELDS},
            'actual_hours': seconds / 3600,
            'training_plan_target': float(item['target_hours']),
        }
    if unallocated is None:
        return None
    return {'months': states, 'training_plan_totals': totals, 'unallocated_activities': unallocated}


def monthly_snapshot(owner, *, targets=None):
    """Shared whole-learner month totals; never refresh during a page read.

    Callers that already read targets must not mix their earlier selection with
    a newer cached generation. Module/week/activity breakdowns stay canonical.
    """
    if not owner or owner.get('id') is None:
        return None
    saved = snapshot(owner)
    if saved is not None and targets is not None:
        selected = {month: value['training_plan_target'] for month, value in saved['months'].items()}
        if selected != targets:
            return None
    return saved


def allocated_months(owner):
    """Coach aggregates can reuse months when no unallocated time is omitted.

    Older snapshots retain unallocated display rows without their acceptance
    verdict. Do not infer that verdict or drop their hours from coach totals.
    """
    saved = monthly_snapshot(owner)
    if saved is None or any(canonical.number(row.get('actual_hours')) != 0
                            for row in saved['unallocated_activities']):
        return None
    return saved


def summary(learner, *, include_open=False, include_future=False, ensure_month=None):
    """Same summary contract and role checks; activity detail stays canonical."""
    from . import monthly_logs as logs

    owner = learner.get('_canonical_profile')
    if owner is None:
        return None
    saved = snapshot(owner)
    if saved is None:
        return None
    signs = canonical.signatures_for(owner)
    months = set(saved['months']) | {sign['report_month'] for sign in signs}
    open_month = timezone.localdate().strftime('%Y-%m')
    if ensure_month:
        months.add(ensure_month)
    months = sorted(month for month in months if month < open_month
                    or include_open and month == open_month or include_future and month > open_month)
    locks = logs.lock_states(learner['id'], months, canonical_owner=owner)
    result = []
    for month in months:
        values = saved['months'].get(month)
        state = logs.month_state(month, [], signs,
            values['training_plan_target'] if values else None, learner_id=learner['id'], lock=locks[month])
        state.update(submitted_hours=0.0, verification_hours=0.0)
        if values is not None:
            state.update(values)
        result.append(state)
    profile = learner.get('_profile') or {}
    return {
        'learner': {'id': learner['id'], 'aptem_id': learner.get('aptem_id'), 'name': learner['name'],
            'programme': learner['programme'], 'coach_name': profile.get('coach_name') or learner.get('coach_name'),
            'planned_end_date': profile.get('end_date')},
        'months': result, 'total_months': len(result),
        'completed_months': sum(item['status'] == 'complete' for item in result),
        'training_plan_totals': saved['training_plan_totals'],
        'unallocated_activities': saved['unallocated_activities'],
        'read_only': learner['_view_as'],
    }


@contextmanager
def _perspective(journal):
    token = journal_sources._current.set(journal)
    try:
        yield
    finally:
        journal_sources._current.reset(token)


def project(owner, targets, *, journal):
    """Reuse the actual Monthly Logs rules; do not substitute SUM(raw seconds)."""
    from collections import defaultdict
    from . import monthly_logs as logs
    from . import monthly_log_attendance, attendance_otjh
    from .hour_review_status import review_hour_totals

    with _perspective(journal):
        records = canonical.entries_for(owner, monthly_summary=True)
        rows = canonical.rows_for(owner, records)
        attendance = attendance_otjh.additional_rows(rows,
            monthly_log_attendance.read_rows(owner, now=timezone.now()))
        grouped = defaultdict(list)
        for item in [*rows, *attendance]:
            grouped[item.get('reporting_month')].append(item)
        # Do not hide target-less months. Unallocated activity stays visible in
        # the owner metadata; it is never assigned a guessed month or target.
        complete = all(not month or month in targets for month in grouped)
        unallocated = [{key: item.get(key) for key in ('id', 'title', 'actual_hours', 'actual_hours_recorded')}
                       for item in [*rows, *attendance] if not item.get('reporting_month')]
        # Recovered titles depend on retained evidence readers outside this
        # event contract; those learners keep the canonical summary path.
        complete = complete and not any(r.get('component_type') == 'old_lms_recovered' for r in records)
        review = review_hour_totals(records, canonical.allocations)
        states = {}
        for month in targets:
            state = logs.month_state(month, grouped.get(month, []), [], targets[month], lock={
                'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None})
            state.update(review.get(month, {'submitted_hours': 0.0, 'verification_hours': 0.0}))
            states[month] = state
        metrics = canonical.metrics_from_records(records, targets)['otjh']
        totals = {'accepted_hours': metrics.get('completed_actual', metrics['actual'])
                  + sum(item['actual_hours'] for item in attendance), 'planned_hours': metrics['planned']}
        return states, totals, complete, records, unallocated


def link_attendance_targets(cursor, owner, selected):
    """Relink one owner's register to current UK session-month targets.

    Links describe the session month; accepted hours still obey the canonical
    presence/recording and protected-history rules. Link-only updates are not
    source events, so they cannot recursively invalidate the summary.
    """
    cursor.execute('''SELECT EXISTS(SELECT 1 FROM pg_attribute
        WHERE attrelid=to_regclass('curriculum.live_session_learner_attendance')
          AND attname='monthly_target_id' AND NOT attisdropped)''')
    if not cursor.fetchone()[0]:
        return  # Rolling deployment before the additive attendance migration.
    targets = [{'month': item['report_month'], 'id': item['id']} for item in selected]
    cursor.execute('''WITH selected AS (
            SELECT * FROM jsonb_to_recordset(%s::jsonb) AS t(month text,id bigint)
        ), links AS (
            SELECT r.id,t.id AS target_id
            FROM curriculum.live_session_learner_attendance r
            LEFT JOIN curriculum.live_session_occurrences o
              ON o.id=r.occurrence_id AND o.live_session_id=r.live_session_id
            LEFT JOIN selected t ON t.month=to_char(o.scheduled_start AT TIME ZONE 'Europe/London','YYYY-MM')
            WHERE r.learner_profile_id=%s
        ) UPDATE curriculum.live_session_learner_attendance r SET monthly_target_id=links.target_id
          FROM links WHERE r.id=links.id AND r.learner_profile_id=%s
          AND r.monthly_target_id IS DISTINCT FROM links.target_id''',
        [json.dumps(targets), owner['id'], owner['id']])


def link_subject_attempt_targets(cursor, owner, selected):
    """Link one learner's saved attempts by their evidenced completion month.

    A relationship is provenance, not another hour contribution. Existing
    canonical timing/retake rules still choose the counted attempt. Untimed
    submissions may link, while undated attempts and absent targets stay NULL.
    """
    cursor.execute('''SELECT EXISTS(SELECT 1 FROM pg_attribute
        WHERE attrelid=to_regclass('"Learner".subject_activity_attempts')
          AND attname='monthly_target_id' AND NOT attisdropped)''')
    if not cursor.fetchone()[0]:
        return  # Rolling deployment before the additive attempt migration.
    cursor.execute('''SELECT id,submitted_at,definition->'studyTime'
        FROM "Learner".subject_activity_attempts WHERE learner_id=%s''', [owner['id']])
    targets = {item['report_month']: item['id'] for item in selected}
    links = []
    for ident, submitted_at, timing in cursor.fetchall():
        timing = decoded(timing, {})
        timing = timing if isinstance(timing, dict) else {}
        completed = timing.get('declaredCompletedAt') or timing.get('submittedAt') or submitted_at
        try:
            at = canonical.completion_reporting_instant(completed) if submitted_at else None
        except (AttributeError, TypeError, ValueError, OverflowError):
            at = None  # Do not guess a month from malformed saved evidence.
        links.append({'id': str(ident), 'target_id': targets.get(at.strftime('%Y-%m')) if at else None})
    if not links:
        return
    cursor.execute('''UPDATE "Learner".subject_activity_attempts a SET monthly_target_id=x.target_id
        FROM jsonb_to_recordset(%s::jsonb) x(id uuid,target_id bigint)
        WHERE a.id=x.id AND a.learner_id=%s AND a.monthly_target_id IS DISTINCT FROM x.target_id''',
        [json.dumps(links), owner['id']])


def refresh(learner_id, *, using='enrolment'):
    """One identified learner, one repeatable snapshot, one atomic replacement.

    Concurrent source changes invalidate target rows in the same transaction as
    their write. PostgreSQL then rejects this older repeatable-read update; no
    stale total can win the race. A failed event leaves the reader on live data.
    """
    if connections[using].in_atomic_block:
        raise RuntimeError('Refresh must run after the source transaction commits')
    token = repository._query_alias.set(using)
    try:
        with transaction.atomic(using=using):
            connection = connections[using]
            if connection.vendor != 'postgresql':
                raise RuntimeError('Monthly actual refresh requires PostgreSQL')
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
                cursor.execute("SET LOCAL lock_timeout='5s'")
                cursor.execute("SET LOCAL statement_timeout='90s'")
                cursor.execute('SELECT transaction_timestamp()')
                at = cursor.fetchone()[0]
            if not storage_available(using):
                raise RuntimeError('Monthly actual event storage has not been migrated')
            owners = repository.query('''SELECT id,enrolment_id,aptem_id,programme_id,learner_type,
                EXISTS(SELECT 1 FROM "Learner".progress_transfer_requests t WHERE t.enrolment_id=l.enrolment_id)
                    AS progress_transfer_active
                FROM "Learner".learners l WHERE id=%s''', [int(learner_id)])
            if not owners:
                return 0
            owner = owners[0]
            selected = [item for item in selected_targets(owner) if item['target_hours'] is not None]
            if not selected:
                return 0
            targets = {item['report_month']: float(item['target_hours']) for item in selected}
            standard, standard_totals, standard_complete, _, standard_unallocated = project(owner, targets, journal=False)
            journal, journal_totals, journal_complete, records, journal_unallocated = project(owner, targets, journal=True)
            # Time passage can make already-Present attendance eligible without
            # a new write. Expire conservatively at that saved session end;
            # a read falls back, it never starts a timer or refresh job.
            expiry = repository.query('''SELECT min(o.scheduled_end) AS valid_until
                FROM curriculum.live_session_learner_attendance r
                JOIN curriculum.live_session_occurrences o ON o.id=r.occurrence_id AND o.live_session_id=r.live_session_id
                WHERE r.learner_profile_id=%s AND r.attendance_status='present' AND o.scheduled_end>%s''', [owner['id'], at])
            until = expiry[0]['valid_until']
            update_rows = []
            for target in selected:
                month = target['report_month']
                seconds = journal[month]['actual_hours'] * 3600
                if not math.isfinite(seconds) or abs(seconds - round(seconds)) > 1e-6:
                    raise ValueError('Fractional monthly seconds require explicit storage review')
                if abs(seconds - standard[month]['actual_hours'] * 3600) > 1e-6:
                    raise ValueError('Monthly actual differs between reporting perspectives')
                meta = {'version': VERSION, 'complete': standard_complete and journal_complete,
                    'seconds': int(round(seconds)), 'computed_at': at.isoformat(),
                    'valid_until': until.isoformat() if until else None,
                    'totals': {'standard': standard_totals, 'journal': journal_totals},
                    'views': {name: {key: states[month][key] for key in MONTH_FIELDS}
                              for name, states in (('standard', standard), ('journal', journal))}}
                if target['id'] == selected[0]['id']:
                    meta['unallocated'] = {'standard': standard_unallocated, 'journal': journal_unallocated}
                update_rows.append({'id': target['id'], 'seconds': int(round(seconds)), 'summary': meta})
            # Relink only persisted activities. Synthetic attempts/attendance
            # contribute to the total without inventing progress records.
            by_month = {item['report_month']: item['id'] for item in selected}
            links = []
            for record in records:
                if not str(record['id']).isdigit():
                    continue
                parts = canonical.allocations(record)
                if len(parts) > 1:
                    raise ValueError('A multi-month activity cannot use one monthly target FK')
                target_id = by_month.get(parts[0].get('reporting_month')) if parts else None
                links.append({'id': int(record['id']), 'target_id': target_id})
            with connection.cursor() as cursor:
                from .assignment_monthly_targets import link_assignment_targets
                link_assignment_targets(cursor, owner, selected, records)
                link_attendance_targets(cursor, owner, selected)
                link_subject_attempt_targets(cursor, owner, selected)
                # Source writers lock progress before invalidating targets.
                # Use the same order to avoid a target/progress lock inversion.
                cursor.execute('''UPDATE "Learner".learner_progress_entries p SET monthly_target_id=x.target_id
                    FROM jsonb_to_recordset(%s::jsonb) x(id bigint,target_id bigint)
                    WHERE p.id=x.id AND p.learner_id=%s AND p.monthly_target_id IS DISTINCT FROM x.target_id
                      AND NOT (p.kbc_attendance_key IS NULL
                        AND p.source_payload->>'original_source_ref' LIKE 'att:%%'
                        AND EXISTS(SELECT 1 FROM "Learner".source_lms_attendance a JOIN "Learner".learners l
                          ON l.aptem_id=a.aptem_id WHERE l.id=p.learner_id
                          AND a.source_key=substring(p.source_payload->>'original_source_ref' FROM 5)))''',
                    [json.dumps(links), owner['id']])
                cursor.execute('''UPDATE "Learner".learner_monthly_targets t
                    SET actual_seconds_total=x.seconds,actual_updated_at=%s,actual_summary=x.summary
                    FROM jsonb_to_recordset(%s::jsonb) x(id bigint,seconds bigint,summary jsonb)
                    WHERE t.id=x.id AND t.learner_id=%s''',
                    [at, json.dumps(update_rows, cls=DjangoJSONEncoder), owner['id']])
                if cursor.rowcount != len(selected):
                    raise RuntimeError('Monthly target selection changed')
            return len(selected)
    finally:
        repository._query_alias.reset(token)
