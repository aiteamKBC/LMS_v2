"""Check the Aptem import with SELECT fixtures and EXPLAIN, never executing writes.

Run from the repository root:
    backend/venv/Scripts/python.exe backend/scripts/verify_aptem_placement_sql.py

Uses the configured database only inside a transaction enforced READ ONLY by
PostgreSQL. Fixtures are JSON CTEs: no test tables, migrations or DDL are used.
"""

import os
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb


ROOT = Path(__file__).resolve().parents[2]
SQL_DIR = ROOT / 'backend' / 'sql'
PREVIEW = SQL_DIR / '2026-09-11_aptem_programme_placements_preview.sql'
APPLY = SQL_DIR / '2026-09-11_aptem_programme_placements_apply.sql'

FIXTURES = {
    'source': ('"LMS"."Aptem_users"', '"ID" bigint, "FullName" text, "Email" text, '
               '"Start-Date" date, "Program Name" text, "OwnerName" text, "Group" text'),
    'programmes': ('curriculum.programmes', 'programme_id text, name text, status text, '
                   'is_archived boolean, deleted_at timestamptz'),
    'cohorts': ('curriculum.cohorts', 'cohort_id text, cohort_name text, programme_id text, '
                'start_date date, status text, deleted_at timestamptz, is_programme_deleted boolean'),
    'groups': ('curriculum.groups', 'group_id text, group_name text, cohort_id text, '
               'programme_id text, deleted_at timestamptz, is_programme_deleted boolean'),
    'enrolment': ('enrolment."Created_users"', 'id bigint, "Email" text, "Programme" text, '
                  '"Cohort" text, "Group" text'),
    'learners': ('"Learner".learners', 'id bigint, email text, programme text, programme_id text, '
                 'cohort text, cohort_id text, group_name text, group_id text'),
}


def connect_read_only():
    values = dict(os.environ)
    env_path = ROOT / 'backend' / '.env'
    if env_path.exists():
        for line in env_path.read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = next((values[key] for key in ('DATABASE_URL', 'DATABASEURL', 'Database_url')
                if values.get(key)), None)
    if not url:
        raise SystemExit('A PostgreSQL database URL is required for read-only checks.')
    conn = psycopg.connect(url, connect_timeout=10)
    conn.read_only = True
    with conn.cursor() as cur:
        cur.execute('SHOW transaction_read_only')
        assert cur.fetchone()[0] == 'on'
        cur.execute('SET LOCAL statement_timeout = 30000')
    return conn


def base_data():
    data = {name: [] for name in FIXTURES}
    data['source'] = [{
        'ID': 1, 'FullName': 'Fixture Learner', 'Email': ' Learner+tag@Example.com ',
        'Start-Date': '2025-01-31', 'Program Name': 'Level 4 Marketing Executive',
        'OwnerName': 'Fixture Owner', 'Group': ' G1 – Mixed CASE | Friday ',
    }]
    data['programmes'] = [{
        'programme_id': 'PROG-ME', 'name': 'Marketing Executive Level 4',
        'status': 'active', 'is_archived': False,
    }]
    data['enrolment'] = [{'id': 11, 'Email': 'learner+tag@example.com'}]
    data['learners'] = [{'id': 22, 'email': 'LEARNER+TAG@example.com'}]
    return data


def cohort(cohort_id='EXISTING-C', name='February 2025'):
    return {'cohort_id': cohort_id, 'cohort_name': name, 'programme_id': 'PROG-ME',
            'start_date': '2025-02-01', 'status': 'planned', 'is_programme_deleted': False}


def group(group_id='EXISTING-G', cohort_id='EXISTING-C'):
    return {'group_id': group_id, 'group_name': base_data()['source'][0]['Group'],
            'cohort_id': cohort_id, 'programme_id': 'PROG-ME', 'is_programme_deleted': False}


def main():
    preview = PREVIEW.read_text(encoding='utf-8')
    common = 'WITH\n' + preview.split('WITH\n', 1)[1].split('-- RESULT', 1)[0].rstrip()
    apply_sql = APPLY.read_text(encoding='utf-8')
    statement = 'WITH\n' + apply_sql.split('WITH\n', 1)[1].split('\nCOMMIT;', 1)[0]
    assert statement.startswith(common + '\n,'), 'Preview and apply logic differ.'
    fixture_query = common
    ctes = []
    for name, (table, columns) in FIXTURES.items():
        fixture_query = fixture_query.replace(table, 'fixture_' + name)
        ctes.append(f'fixture_{name} AS (SELECT * FROM jsonb_to_recordset(%s::jsonb) AS x({columns}))')
    fixture_query = fixture_query.replace('WITH\n', 'WITH\n' + ',\n'.join(ctes) + ',\n', 1)
    fixture_query += '\nSELECT to_jsonb(r) FROM review r ORDER BY aptem_id'

    checks = []
    with connect_read_only() as conn, conn.cursor() as cur:
        def review(data):
            cur.execute(fixture_query, tuple(Jsonb(data[name]) for name in FIXTURES))
            return [row[0] for row in cur.fetchall()]

        def check(label, condition):
            assert condition, label
            checks.append(label)

        data = base_data()
        row = review(data)[0]
        check('January 31 -> February 1; source names and literal group preserved',
              str(row['cohort_start']) == '2025-02-01' and row['cohort_name'] == 'Feb 2025'
              and row['group_name'] == data['source'][0]['Group']
              and row['full_name'] == 'Fixture Learner' and row['owner_name'] == 'Fixture Owner')
        check('Case/space-normalized email updates each destination independently',
              row['enrolment_assignment'] == row['learner_assignment'] == 'will_update'
              and row['enrolment_id'] == 11 and row['learner_id'] == 22)

        for start, expected in [('2025-12-31', '2026-01-01'), ('2024-02-29', '2024-03-01')]:
            data = base_data()
            data['source'][0]['Start-Date'] = start
            check(f'Date boundary {start}', str(review(data)[0]['cohort_start']) == expected)

        data = base_data()
        data['source'][0]['Program Name'] = 'Marketing Executive Level 4 - Oct 2026'
        check('Start-Date controls the month even when programme intake disagrees',
              review(data)[0]['cohort_name'] == 'Feb 2025')

        for field, value, issue in [
            ('Program Name', None, 'missing_programme_name'),
            ('Program Name', 'Level 4 Market Research Executive', 'programme_not_found'),
            ('Start-Date', None, 'missing_or_nonfinite_start_date'),
            ('Start-Date', 'infinity', 'missing_or_nonfinite_start_date'),
            ('Email', ' ', 'missing_email'), ('Group', ' ', 'missing_group'),
            ('Group', 'x' * 501, 'group_name_too_long'),
        ]:
            data = base_data()
            data['source'][0][field] = value
            check(f'Skips {issue}', review(data)[0]['placement_issue'] == issue)

        data = base_data()
        data['programmes'][0]['is_archived'] = True
        check('Archived programmes excluded', review(data)[0]['placement_issue'] == 'programme_not_found')
        data = base_data()
        data['programmes'].append({**data['programmes'][0], 'programme_id': 'PROG-DUP'})
        check('Duplicate programme names do not choose an arbitrary ID',
              review(data)[0]['placement_issue'] == 'ambiguous_programme')

        data = base_data()
        data['source'].append({**data['source'][0], 'ID': 2, 'Email': 'learner+tag@example.com'})
        check('Duplicate source emails are all skipped',
              all(r['placement_issue'] == 'duplicate_source_email' for r in review(data)))

        for target, status in [('enrolment', 'enrolment_assignment'), ('learners', 'learner_assignment')]:
            data = base_data()
            data[target].append({**data[target][0], 'id': 99})
            result = review(data)[0]
            other = 'learner_assignment' if target == 'enrolment' else 'enrolment_assignment'
            check(f'Duplicate {target} email affects only that destination',
                  result[status] == 'ambiguous_target_email' and result[other] == 'will_update')
            data[target] = []
            result = review(data)[0]
            check(f'Missing {target} email affects only that destination',
                  result[status] == 'email_not_found' and result[other] == 'will_update')

        data = base_data()
        data['source'].append({**data['source'][0], 'ID': 2, 'Email': 'second@example.com'})
        result = review(data)
        check('Same programme/month/group shares one cohort and group',
              result[0]['cohort_id'] == result[1]['cohort_id']
              and result[0]['group_id'] == result[1]['group_id'])
        data['source'][1]['Start-Date'] = '2025-02-01'
        result = review(data)
        check('The same group name in different months has separate IDs',
              result[0]['cohort_id'] != result[1]['cohort_id']
              and result[0]['group_id'] != result[1]['group_id'])
        data['source'][1]['Start-Date'] = '2025-01-31'
        data['source'][1]['Program Name'] = 'Marketing Manager Level 6'
        data['programmes'].append({**data['programmes'][0], 'programme_id': 'PROG-MM',
                                   'name': 'Marketing Manager Level 6'})
        result = review(data)
        check('The same month/group in different programmes has separate IDs',
              result[0]['cohort_id'] != result[1]['cohort_id']
              and result[0]['group_id'] != result[1]['group_id'])

        data = base_data()
        data['cohorts'] = [cohort()]
        data['groups'] = [group()]
        result = review(data)[0]
        check('Existing full-month cohort and exact group IDs are reused',
              result['cohort_id'] == 'EXISTING-C' and result['group_id'] == 'EXISTING-G'
              and not result['would_create_cohort'] and not result['would_create_group'])
        data['cohorts'].append(cohort('DUP-C', 'Feb 2025'))
        check('Ambiguous cohort is skipped', review(data)[0]['placement_issue'] == 'ambiguous_existing_cohort')
        data['cohorts'] = [cohort()]
        data['groups'].append(group('DUP-G'))
        check('Ambiguous group is skipped', review(data)[0]['placement_issue'] == 'ambiguous_existing_group')
        data['groups'] = [group()]
        data['groups'][0]['programme_id'] = 'WRONG'
        check('Existing group cannot cross programmes',
              review(data)[0]['placement_issue'] == 'existing_group_programme_conflict')
        data['groups'] = []
        data['cohorts'][0]['start_date'] = '2024-02-01'
        check('Existing cohort date conflict is skipped',
              review(data)[0]['placement_issue'] == 'existing_cohort_start_month_conflict')

        data = base_data()
        data['cohorts'] = [{**cohort(), 'deleted_at': '2026-01-01T00:00:00Z'}]
        check('Archived cohort is never reused', review(data)[0]['would_create_cohort'])
        initial = review(base_data())[0]
        data['cohorts'][0]['cohort_id'] = initial['cohort_id']
        check('Archived deterministic cohort ID is reported, never restored',
              review(data)[0]['placement_issue'] == 'cohort_id_already_used_or_archived')
        data = base_data()
        data['groups'] = [{**group(initial['group_id'], initial['cohort_id']),
                           'deleted_at': '2026-01-01T00:00:00Z'}]
        check('Archived deterministic group ID is reported, never restored',
              review(data)[0]['placement_issue'] == 'group_id_already_used_or_archived')

        data = base_data()
        data['cohorts'] = [cohort(initial['cohort_id'], 'Feb 2025')]
        data['groups'] = [group(initial['group_id'], initial['cohort_id'])]
        data['enrolment'][0].update({'Programme': 'Marketing Executive Level 4',
                                     'Cohort': 'Feb 2025', 'Group': initial['group_name']})
        data['learners'][0].update({'programme': 'Marketing Executive Level 4', 'programme_id': 'PROG-ME',
                                    'cohort': 'Feb 2025', 'cohort_id': initial['cohort_id'],
                                    'group_name': initial['group_name'], 'group_id': initial['group_id']})
        result = review(data)[0]
        check('Re-running against the completed placement is a no-op',
              result['enrolment_assignment'] == result['learner_assignment'] == 'already_assigned'
              and not result['would_create_cohort'] and not result['would_create_group'])

        # EXPLAIN without ANALYZE only plans the write statement. PostgreSQL's
        # transaction remains READ ONLY; INSERT/UPDATE are NEVER executed here.
        cur.execute('EXPLAIN (FORMAT JSON) ' + statement)
        check('Complete import passes PostgreSQL planning without execution', bool(cur.fetchone()[0]))
        cur.execute('SHOW transaction_read_only')
        check('All checks stayed in a READ ONLY transaction', cur.fetchone()[0] == 'on')
        conn.rollback()

    print(f'{len(checks)} read-only checks passed. No database changes executed.')
    for label in checks:
        print(f'  PASS: {label}')


if __name__ == '__main__':
    main()
