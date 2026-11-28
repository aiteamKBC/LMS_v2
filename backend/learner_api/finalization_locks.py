"""Canonical month lock protocol shared with the database migration.

Acquire the complete scope before snapshots/row locks; the caller owns the
transaction. Locks wait like the installed triggers; on timeout/deadlock retry the WHOLE transaction,
including authorization, scopes and snapshot reads. Never retry just a write.
No Django dependency: repair commands use this same protocol.
"""
import re
from collections.abc import Mapping

LOCK_SQL = """SELECT pg_advisory_xact_lock(hashtextextended(
    'canonical-journal-finalization:' || %s::bigint::text || ':' || %s::text, 0))"""

ISOLATION_SQL = "SELECT current_setting('transaction_isolation') AS isolation"


def _require_read_committed(isolation):
    if isolation != 'read committed':
        raise ValueError('Month writes require READ COMMITTED and fresh reads after locking.')


def normalized(scopes):
    result = set()
    for learner_id, month in scopes:
        if type(learner_id) is not int or learner_id <= 0:
            raise ValueError('Canonical learner ID is required for month locking.')
        if not isinstance(month, str) or not re.fullmatch(r'[0-9]{4}-(0[1-9]|1[0-2])', month):
            raise ValueError('A YYYY-MM month is required for month locking.')
        result.add((learner_id, month))
    return sorted(result)


def lock_scopes(cursor, scopes):
    scopes = normalized(scopes)
    if scopes:
        cursor.execute(ISOLATION_SQL)
        row = cursor.fetchone()
        _require_read_committed(row['isolation'] if isinstance(row, Mapping) else row[0])
    for scope in scopes:
        cursor.execute(LOCK_SQL, list(scope))


def lock_query(query, scopes, *, vendor):
    scopes = normalized(scopes)
    if vendor == 'postgresql':
        if scopes:
            _require_read_committed(query(ISOLATION_SQL, [])[0]['isolation'])
        for scope in scopes:
            query(LOCK_SQL, list(scope))


def signed_scopes(cursor, scopes):
    """Read existing closure sources AFTER the caller acquires canonical locks."""
    scopes = normalized(scopes)
    if not scopes:
        return set()
    cursor.execute('''WITH scopes AS (
        SELECT * FROM unnest(%s::bigint[],%s::text[]) AS v(learner_id,report_month))
        SELECT s.learner_id,s.report_month FROM scopes s JOIN "Learner".learners l ON l.id=s.learner_id
        WHERE EXISTS(SELECT 1 FROM "Learner".learner_monthly_targets t WHERE t.learner_id=s.learner_id
            AND t.report_month=s.report_month AND t.month_status IN ('partially_signed','locked'))
        OR EXISTS(SELECT 1 FROM "Learner".learner_monthly_signatures t WHERE t.learner_id=s.learner_id
            AND t.report_month=s.report_month AND t.review_confirmed IS TRUE)
        OR EXISTS(SELECT 1 FROM "Learner".monthly_audit_signoffs t WHERE t.learner_id=l.aptem_id::text
            AND t.report_month=s.report_month AND t.review_confirmed IS TRUE)
        OR EXISTS(SELECT 1 FROM "Audit".monthly_audit_signoffs t WHERE t.learner_id=l.aptem_id::text
            AND t.report_month=s.report_month AND t.review_confirmed IS TRUE)''',
        [[s[0] for s in scopes], [s[1] for s in scopes]])
    return set(cursor.fetchall())
