"""Preview/apply existing legacy aliases to canonical identities for all learners.

No Django startup, API calls, account-email edits, progress writes or hour changes.
The schema migration and missing identity inserts commit in one transaction.
Conflicts are reported by reason/IDs only; no emails or credentials are printed.
"""
import argparse
from collections import Counter
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api.legacy_identity_aliases import plan_aliases

MIGRATION = '0014_legacy_lms_identity_aliases'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def database_url():
    values = dict(os.environ)
    for line in (Path(__file__).resolve().parents[1] / '.env').read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = (values.get('ENROLMENT_DATABASE_URL') or values.get('Database_url')
           or values.get('DATABASEURL') or values.get('DATABASE_URL'))
    if not url:
        raise ValueError('No configured enrolment database.')
    return url


def read_state(cur):
    return {
        'aliases': cur.execute('''SELECT * FROM "Last_audit".learner_lms_aliases
            ORDER BY aptem_id,lms_learner_id''').fetchall(),
        'learners': cur.execute('''SELECT l.id,l.aptem_id,l.enrolment_id,l.email,
            e.id AS account_id,e."Email" AS account_email,e.aptem_id AS account_aptem_id
            FROM "Learner".learners l
            LEFT JOIN enrolment."Created_users" e ON e.id=l.enrolment_id ORDER BY l.id''').fetchall(),
        'identities': cur.execute('SELECT * FROM "Learner".learner_external_identities ORDER BY id').fetchall(),
    }


def report(plan):
    return {
        'resolutions': dict(Counter(p['resolution'] for p in plan)),
        'learners_receiving_aliases': len({p['learner_id'] for p in plan if p['resolution'] == 'insert'}),
        'review_reasons': dict(Counter(p['reason'] for p in plan if p.get('reason'))),
        'review_records': [{k: p[k] for k in ('aptem_id', 'source_learner_id', 'reason')}
                           for p in plan if p.get('reason')],
    }


def apply_plan(cur, state, plan, fingerprint):
    if not cur.execute('''SELECT 1 FROM django_migrations
            WHERE app='learner_api' AND name='0013_declared_completion' ''').fetchone():
        raise ValueError('Schema migration prerequisite has not been applied.')
    # Retain the unique owner of each active source ID. Only the one-account-
    # per-learner restriction is removed; the ownership index must be present.
    index = cur.execute('''SELECT i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i WHERE i.indexrelid=to_regclass(%s)''',
        ['"Learner".learner_external_identities_source_uniq']).fetchone()
    if (not index or not index['indisunique'] or not index['indisvalid']
            or '(source_system, source_learner_id)' not in index['definition']
            or '(deleted_at IS NULL)' not in index['definition']):
        raise ValueError('Expected unique active source-ownership index is missing.')
    migration = importlib.import_module('learner_api.migrations.' + MIGRATION)
    for statement in migration.STATEMENTS:
        cur.execute(statement)
    changed_payloads = {}
    for item in plan:
        if item['resolution'] not in ('insert', 'add_source_email'):
            continue
        payload = dict(item['source_payload'])
        payload['identity_import'] = {**payload.get('identity_import', {}),
            'source_table': 'Last_audit.learner_lms_aliases', 'version': 1,
            'preview_fingerprint': fingerprint}
        # Serialize legacy timestamps as strings inside the lineage payload.
        payload = json.loads(json.dumps(payload, default=str))
        if item['resolution'] == 'add_source_email':
            cur.execute('''UPDATE "Learner".learner_external_identities SET source_payload=%s
                WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''',
                [Jsonb(payload), item['identity_id'], item['learner_id']])
            if cur.rowcount != 1:
                raise ValueError('Source email owner changed; rolling back.')
            changed_payloads[item['identity_id']] = payload
            continue
        cur.execute('''INSERT INTO "Learner".learner_external_identities
            (learner_id,enrolment_id,source_system,source_learner_id,source_payload,
             first_seen_at,last_seen_at)
            VALUES (%s,%s,'old_lms',%s,%s,now(),now())''',
            [item['learner_id'], item['enrolment_id'], item['source_learner_id'], Jsonb(payload)])
    if not cur.execute('SELECT 1 FROM django_migrations WHERE app=%s AND name=%s',
                       ['learner_api', MIGRATION]).fetchone():
        cur.execute('INSERT INTO django_migrations (app,name,applied) VALUES (%s,%s,now())',
                    ['learner_api', MIGRATION])
    after = read_state(cur)
    # Only the reviewed source-email metadata may change on an existing row.
    # Preserve original payload fields, tombstones, learner and enrolment links.
    previous = {r['id']: {**r, **({'source_payload': changed_payloads[r['id']]}
                    if r['id'] in changed_payloads else {})} for r in state['identities']}
    retained = {r['id']: r for r in after['identities'] if r['id'] in previous}
    if (digest(previous) != digest(retained) or state['learners'] != after['learners']
            or state['aliases'] != after['aliases']):
        raise ValueError('An existing record changed; rolling back.')
    expected = sum(p['resolution'] == 'insert' for p in plan)
    if len(after['identities']) != len(state['identities']) + expected:
        raise ValueError('Inserted identity count differs; rolling back.')
    remaining = plan_aliases(after)
    if any(p['resolution'] in ('insert', 'add_source_email') for p in remaining):
        raise ValueError('Identity coverage verification failed; rolling back.')
    if report(remaining)['review_records'] != report(plan)['review_records']:
        raise ValueError('Unresolved identity set changed; rolling back.')
    return remaining


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-database')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and not (args.expected_database and args.expected_fingerprint):
        parser.error('Apply requires the database and fingerprint from a read-only preview.')
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute('SET LOCAL statement_timeout=20000')
            cur.execute('SET LOCAL lock_timeout=5000')
            database = cur.execute('SELECT current_database() AS name').fetchone()['name']
            if args.apply:
                if database != args.expected_database:
                    raise ValueError('Database differs from reviewed preview.')
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('legacy-lms-identity-aliases'))")
                cur.execute('LOCK TABLE "Learner".learner_external_identities IN SHARE ROW EXCLUSIVE MODE')
                # Hold source ownership stable until verification and commit.
                cur.execute('SELECT aptem_id FROM "Last_audit".learner_lms_aliases FOR SHARE')
                cur.execute('SELECT id FROM "Learner".learners FOR SHARE')
                cur.execute('''SELECT id FROM enrolment."Created_users"
                    WHERE id IN (SELECT enrolment_id FROM "Learner".learners) FOR SHARE''')
            state = read_state(cur)
            plan = plan_aliases(state)
            fingerprint = digest(state)
            output = {'database': database, 'fingerprint': fingerprint, **report(plan)}
            if args.apply:
                if fingerprint != args.expected_fingerprint:
                    raise ValueError('Data changed since preview; preview again before applying.')
                remaining = apply_plan(cur, state, plan, fingerprint)
                output.update(applied=True, verification='passed', remaining=report(remaining))
    print(json.dumps(output, default=str))  # Only report success after commit.


if __name__ == '__main__':
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({'error': str(exc) if isinstance(exc, ValueError) else type(exc).__name__}))
        sys.exit(1)
