"""Request-scoped journal reads with shared canonical KSB sources for both roles."""
from contextvars import ContextVar
from contextlib import contextmanager
from functools import wraps
import re


_current = ContextVar('learner_journal_sources', default=False)
TABLES = {
    'manual_learner_activities': '"Learner".learner_journal_rows',
    'learner_journal_row_ksbs': '''(SELECT j.id AS row_id,j.learner_id,j.aptem_id,j.ksb_snapshot AS ksbs,
        coalesce((j.ksb_metadata->>'version')::bigint,1) AS version,
        j.ksb_metadata->>'created_by' AS created_by,j.ksb_metadata->>'updated_by' AS updated_by,
        (j.ksb_metadata->>'created_at')::timestamptz AS created_at,
        (j.ksb_metadata->>'updated_at')::timestamptz AS updated_at
        FROM "Learner".learner_journal_rows j WHERE j.ksb_snapshot IS NOT NULL)''',
    'learner_activity_ksbs': '''(SELECT m.learner_id,l.aptem_id,m.activity_id,m.ksbs,m.source_preference,
        m.source_metadata,m.version,m.created_by,m.updated_by,m.created_at,m.updated_at
        FROM "Learner".ksb_learner_activity_mappings m
        JOIN "Learner".learners l ON l.id=m.learner_id
        WHERE m.source_kind='learner_activity' AND NOT EXISTS (
            SELECT 1 FROM "Learner".learners other WHERE other.aptem_id=l.aptem_id AND other.id<>l.id))''',
    'activity_ksbs': None,  # Shared canonical projection supplied by table().
    'manual_activity_documents': '"Learner".manual_activity_documents',
    'evidence_content_classification': '"Learner".evidence_content_classification',
    'evidence_overrides': '"Learner".evidence_overrides',
    'evidence_replacements': '"Learner".evidence_replacements',
    'manual_activity_hours_revision': '"Learner".manual_activity_hours_revision',
    'manual_month_finalization_events': '"Learner".manual_month_finalization_events',
    'monthly_log_provisional_rows': '"Learner".monthly_log_provisional_rows',
    'reading_quiz_pairs': 'curriculum.source_reading_quiz_pairs',
}


def enabled():
    return _current.get()


@contextmanager
def learner_journal_reads():
    """Use learner journal sources in an already-authorized shared reader."""
    token = _current.set(True)
    try:
        yield
    finally:
        _current.reset(token)


@contextmanager
def standard_monthly_reads():
    """Pin the retained coach/source projection for background cache builds."""
    token = _current.set(False)
    try:
        yield
    finally:
        _current.reset(token)


def table(name):
    if name == 'activity_ksbs':
        from curriculum_api.source_activity_ksbs import relation
        return relation()
    return TABLES[name] if enabled() or name in ('learner_journal_row_ksbs', 'learner_activity_ksbs') else f'structured_manual_activities.{name}'


def retained_journal_sql(sql):
    """Route the retained-report adapter without changing its coach callers.

    Only the explicitly migrated relations are eligible; values remain bound
    parameters and signatures/ownership queries keep their original tables.
    """
    for name, target in TABLES.items():
        if name == 'activity_ksbs':
            target = table(name)
        elif not enabled() and name not in ('learner_journal_row_ksbs', 'learner_activity_ksbs'):
            continue
        sql = re.sub(r'(?<![\w])"?structured_manual_activities"?\."?'
                     + re.escape(name) + r'"?(?![\w])', lambda _: target, sql)
    return sql


def learner_journal_view(view):
    """Select data after authentication, without changing authorization."""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        account = getattr(request, 'login_account', None)
        coach_context = bool(account and (account.role == 'coach' or
            account.role != 'learner' and (request.GET.get('viewAsCoach')
                or re.search(r'/coach(?:/|$)', getattr(request, 'path', ''))
                or request.GET.get('perspective') == 'coach')))
        use_current = bool(account and not coach_context)
        token = _current.set(use_current)
        try:
            return view(request, *args, **kwargs)
        finally:
            _current.reset(token)
    return wrapped


def monthly_targets(owner_id, query):
    """Current row values, not a sum of historical bulk-change snapshots.

    Bulk items identify changes to journal_row_id/progress_id. The journal
    retains later auditor edits too; skip/unchanged batches add no hours.
    Validate all three ownership links before attributing hours to a learner.
    """
    records = query('''SELECT j.month, sum(j.planned_hours) AS planned
        FROM "Learner".learner_journal_rows j
        JOIN "Learner".learner_activity_sources s ON s.id=j.source_id
          AND s.learner_id=j.learner_id AND s.canonical_progress_id=j.progress_id
          AND s.deleted_at IS NULL
        JOIN "Learner".learner_progress_entries p ON p.id=j.progress_id
          AND p.learner_id=j.learner_id AND p.deleted_at IS NULL
        WHERE j.learner_id=%s AND j.deleted_at IS NULL
        GROUP BY j.month ORDER BY j.month''', [owner_id])
    return {r['month']: float(r['planned']) for r in records if r['planned'] is not None}


def planned_by_progress(owner_id, query):
    return {r['progress_id']: float(r['planned']) for r in query('''
        SELECT j.progress_id,sum(j.planned_hours) AS planned
        FROM "Learner".learner_journal_rows j
        JOIN "Learner".learner_activity_sources s ON s.id=j.source_id
          AND s.learner_id=j.learner_id AND s.canonical_progress_id=j.progress_id
          AND s.deleted_at IS NULL
        JOIN "Learner".learner_progress_entries p ON p.id=j.progress_id
          AND p.learner_id=j.learner_id AND p.deleted_at IS NULL
        WHERE j.learner_id=%s AND j.deleted_at IS NULL
        GROUP BY j.progress_id''', [owner_id]) if r['planned'] is not None}


def monthly_hours(records, targets, allocations):
    """Count each progress allocation once, independently of journal lineage."""
    result = {month: {'planned': value, 'actual': 0.0, 'submitted': 0.0, 'includesHistorical': True,
                      'missingPlannedActivities': 0} for month, value in targets.items()}
    for record in records:
        for part in allocations(record):
            month = part.get('reporting_month')
            if not month:
                continue
            item = result.setdefault(month, {'planned': 0.0, 'actual': 0.0, 'includesHistorical': True,
                'submitted': 0.0, 'missingPlannedActivities': 0})
            value = float(part.get('actual_seconds') or 0) / 3600
            if record.get('accepted') is True:
                item['actual'] += value
            elif str(record.get('activity_status') or '').lower() in {
                    'submitted_for_tutor_review', 'submitted', 'pending_review'}:
                item['submitted'] += value
    for item in result.values():
        item['actual'] = round(item['actual'], 4)
        item['submitted'] = round(item['submitted'], 4)
    return result
