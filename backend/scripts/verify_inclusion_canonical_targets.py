"""Validate installed canonical inclusion views using SELECT-only Development queries.

No view creation, migration execution, data writes, or learner data output.
"""
import argparse
import json
import math
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

import psycopg


BACKEND = Path(__file__).resolve().parents[1]
VIEW_NAMES = ('inclusion_plan_months', 'inclusion_time_progress')


def installed_views(conn):
    views = {}
    for name in VIEW_NAMES:
        definition = conn.execute(
            'SELECT pg_get_viewdef(%s::regclass, true)',
            [f'kbc_quality_reporting.{name}'],
        ).fetchone()[0]
        assert 'source_lms_learners' not in definition.lower(), f'{name}: obsolete dependency'
        views[name] = definition.rstrip().rstrip(';')
    return views


def connect_development():
    values = dict(os.environ)
    for line in (BACKEND / '.env').read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.strip().startswith('#'):
            key, value = line.split('=', 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = values['NEW_ENDPOINT_URL']
    parsed = urlsplit(url)
    if (parsed.hostname != 'ep-odd-grass-ab4t9q2o-pooler.eu-west-2.aws.neon.tech'
            or parsed.path != '/neondb'):
        raise RuntimeError('Connection is not the approved Development endpoint.')
    conn = psycopg.connect(url, connect_timeout=12)
    conn.read_only = True
    try:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        conn.execute('SET LOCAL statement_timeout=60000')
        identity = conn.execute(
            "SELECT current_database(),current_setting('neon.branch_id',true),"
            "current_setting('transaction_read_only')"
        ).fetchone()
        if identity != ('neondb', 'br-raspy-sky-abvs8lq9', 'on'):
            raise RuntimeError('Development identity/read-only verification failed.')
        return conn
    except BaseException:
        conn.rollback()
        conn.close()
        raise


def read_report(conn, name, expected_contract, key_size):
    cursor = conn.execute(f'SELECT * FROM kbc_quality_reporting.{name}')
    assert [(col.name, col.type_code) for col in cursor.description] == expected_contract, \
        f'{name}: output column/type contract changed'
    rows = cursor.fetchall()
    assert len({row[:key_size] for row in rows}) == len(rows), f'{name}: duplicate identity keys'
    return rows


def same_hours(actual, expected):
    if actual is None or expected is None:
        return actual is expected
    return math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-8)


def verify(conn, historical_cases=()):
    installed_views(conn)
    planned = read_report(conn, 'inclusion_plan_months', [
        ('lms_id', 25), ('month', 25), ('expected', 701),
        ('target_basis', 25), ('target_updated_at', 1184)], 2)
    progress_rows = read_report(conn, 'inclusion_time_progress', [
        ('learner_id', 25), ('time_actual_hours', 701), ('time_planned_to_date_hours', 701),
        ('time_total_planned_hours', 701), ('time_progress_pct', 701),
        ('time_total_progress_pct', 701), ('time_as_of', 25), ('time_basis', 25),
        ('time_plan_updated_at', 1184), ('time_actual_updated_at', 1184),
        ('time_total_plan_updated_at', 1184)], 1)
    # Independent aggregation includes former programmes and profiles. Ambiguous
    # identity/month ownership must stay unresolved rather than choosing a row.
    targets = conn.execute('''SELECT l.id::text,t.report_month,t.target_hours::double precision
        FROM "Learner".learner_monthly_targets t
        JOIN "Learner".learners l ON l.id=t.learner_id
        WHERE l.aptem_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "Learner".learners other
            WHERE other.aptem_id=l.aptem_id AND other.id<>l.id)''').fetchall()
    grouped = {}
    for learner, month, hours in targets:
        if month and re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
            grouped.setdefault((learner, month), []).append(hours)
    expected_values = {key: values[0] if len(values) == 1 and values[0] is not None
                       and values[0] >= 0 else None for key, values in grouped.items()}
    installed_values = {(row[0], row[1]): row[2] for row in planned}
    assert installed_values == expected_values, 'Canonical monthly values or membership differ'
    roster_rows = conn.execute(
        'SELECT learner_id,lms_id FROM kbc_quality_reporting.inclusion_roster_v2').fetchall()
    roster = dict(roster_rows)
    assert len(roster) == len(roster_rows), 'Duplicate roster identities'
    assert {row[0] for row in progress_rows} == roster.keys(), 'Progress roster coverage differs'
    boundary, as_of = conn.execute("""SELECT
        to_char(now() AT TIME ZONE 'Europe/London','YYYY-MM'),
        (date_trunc('month',now() AT TIME ZONE 'Europe/London')-interval '1 day')::date::text""").fetchone()
    actuals = dict(conn.execute('''SELECT lms_id,sum(actual)
        FROM kbc_quality_reporting.inclusion_time_monthly WHERE month < %s GROUP BY lms_id''',
        [boundary]).fetchall())
    totals = {(learner, aptem): hours for learner, aptem, hours in conn.execute(
        'SELECT id::text,aptem_id::text,planned_hours::double precision FROM "Learner".learners')}
    for row in progress_rows:
        learner = roster[row[0]]
        due = [hours for (owner, month), hours in expected_values.items()
               if owner == learner and month < boundary]
        expected_due = sum(due) if due and all(value is not None for value in due) else None
        expected_due = expected_due if expected_due is not None and expected_due > 0 else None
        total = totals.get((learner, row[0]))
        total = total if total is not None and total > 0 else None
        actual = actuals.get(learner)
        expected = (actual, expected_due, total,
                    100 * actual / expected_due if actual is not None and expected_due else None,
                    100 * actual / total if actual is not None and total else None)
        assert all(same_hours(value, wanted) for value, wanted in zip(row[1:6], expected)), \
            'Progress hours or percentages differ from canonical sources'
        assert row[6] == as_of, 'Reporting boundary differs'
    reports = {
        'installed_view_contracts_valid': True,
        'canonical_months_verified': len(installed_values),
        'progress_rows_verified': len(progress_rows),
        'canonical_hours_and_percentages_match': True,
    }
    cases = []
    for name, required_months in historical_cases:
        rows = conn.execute('''SELECT l.id::text,t.report_month,t.target_hours::double precision
            FROM "Learner".learners l JOIN "Learner".learner_monthly_targets t ON t.learner_id=l.id
            WHERE lower(l.full_name)=lower(%s) AND t.programme_id IS DISTINCT FROM l.programme_id''',
            [name]).fetchall()
        assert len(rows) == required_months
        assert all((learner, month) in installed_values and installed_values[(learner, month)] == hours for learner, month, hours in rows)
        cases.append({'historical_months': len(rows), 'preserved': True})
    reports['historical_cases'] = cases
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--historical-case', action='append', default=[], metavar='NAME=MONTHS')
    args = parser.parse_args()
    cases = [(value.rsplit('=', 1)[0], int(value.rsplit('=', 1)[1])) for value in args.historical_case]
    conn = connect_development()
    try:
        print(json.dumps(verify(conn, cases), indent=2, sort_keys=True))
    finally:
        conn.rollback()
        conn.close()


if __name__ == '__main__':
    main()
