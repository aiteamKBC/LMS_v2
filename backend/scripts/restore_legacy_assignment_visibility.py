"""Preview/apply an explicit historical-upload selection without altering source work.

Preview is read-only. Apply requires the database host/name and fingerprint from
that preview, plus the reviewed legacy_assignment_visibility.sql registry.
Output contains counts and digests, never names, files, answers or credentials.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

import psycopg
from psycopg.rows import dict_row


REGISTRY = '"Learner".legacy_assignment_visibility'


def digest(value):
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


def connection_options():
    values = dict(os.environ)
    for line in (Path(__file__).resolve().parents[1] / '.env').read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values.setdefault(key.strip(), value.strip().strip('\"').strip("'"))
    url = next((values[key] for key in ('ENROLMENT_DATABASE_URL', 'Database_url', 'DATABASEURL', 'DATABASE_URL')
                if values.get(key)), None)
    if not url:
        raise ValueError('Enrolment database configuration is missing.')
    parsed = urlparse(url)
    return dict(host=parsed.hostname, port=parsed.port or 5432, dbname=parsed.path.lstrip('/'),
                user=unquote(parsed.username or ''), password=unquote(parsed.password or ''),
                sslmode='require', connect_timeout=15, row_factory=dict_row)


def validate_selection(rows, evidence_ids, aptem_id):
    if not evidence_ids or len(evidence_ids) != len(set(evidence_ids)):
        raise ValueError('Select distinct evidence IDs explicitly.')
    if {int(row['evidence_id']) for row in rows} != set(evidence_ids) or len(rows) != len(evidence_ids):
        raise ValueError('A selected source upload is missing or belongs to another learner.')
    for row in rows:
        if (int(row['learner_id']) != aptem_id or row['submitted_by_id'] != aptem_id
                or row['evidence_kind'] != 'File' or not str(row['file_blob'] or '').strip()
                or not row['component_id'] or not row['submission_date']
                or 'assignment' not in (row['component_name'] or '').lower()):
            raise ValueError('Selected evidence is not a verified learner-uploaded assignment.')


def protected_state(cur, profile_id, enrolment_id, aptem_id):
    queries = (
        ('evidence', 'SELECT * FROM fetching_evidence.evidence_items WHERE learner_id=%s ORDER BY evidence_id', [aptem_id]),
        ('progress', 'SELECT * FROM "Learner".learner_progress_entries WHERE learner_id=%s ORDER BY id', [profile_id]),
        ('submissions', 'SELECT * FROM "Learner".learning_reflection_submissions WHERE learner_id=%s ORDER BY id', [str(enrolment_id)]),
        ('plan', 'SELECT "Learning_plan", "Training_plan" FROM enrolment."Created_users" WHERE id=%s', [enrolment_id]),
    )
    return {label: digest(cur.execute(sql, params).fetchall()) for label, sql, params in queries}


def restore(cur, rows, enrolment_id, aptem_id, actor, reason, fingerprint):
    inserted = 0
    for row in rows:
        # Preserve any existing restoration and revocation; never overwrite it.
        existing = cur.execute(f'''SELECT component_id,revoked_at FROM {REGISTRY}
            WHERE enrolment_id=%s AND aptem_id=%s AND evidence_id=%s FOR UPDATE''',
            [enrolment_id, aptem_id, row['evidence_id']]).fetchone()
        if existing:
            if existing['component_id'] != row['component_id'] or existing['revoked_at'] is not None:
                raise ValueError('A prior restoration conflicts with this selection; review it first.')
            continue
        cur.execute(f'''INSERT INTO {REGISTRY}
            (enrolment_id,aptem_id,evidence_id,component_id,restored_by,reason,source_fingerprint)
            VALUES (%s,%s,%s,%s,%s,%s,%s)''',
            [enrolment_id, aptem_id, row['evidence_id'], row['component_id'], actor, reason, fingerprint])
        inserted += 1
    return inserted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile-id', type=int, required=True)
    parser.add_argument('--enrolment-id', type=int, required=True)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--evidence-id', type=int, action='append', required=True)
    parser.add_argument('--actor', required=True)
    parser.add_argument('--reason', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-host')
    parser.add_argument('--expected-database')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and not all((args.expected_host, args.expected_database, args.expected_fingerprint)):
        parser.error('--apply requires the reviewed host, database and fingerprint')
    if not args.actor.strip() or not args.reason.strip():
        parser.error('Actor and reason must not be blank')
    options = connection_options()
    if args.apply and (options['host'] != args.expected_host or options['dbname'] != args.expected_database):
        raise ValueError('Configured target differs from the reviewed database.')
    with psycopg.connect(**options) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout='30s'")
            cur.execute("SET LOCAL lock_timeout='5s'")
            database = cur.execute('SELECT current_database() AS name').fetchone()['name']
            identity = cur.execute('''SELECT l.id FROM "Learner".learners l
                JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
                JOIN "LMS"."Aptem_users" a ON a."ID"::text=btrim(u.aptem_id)
                WHERE l.id=%s AND u.id=%s AND a."ID"=%s AND l.aptem_id::text=a."ID"::text
                  AND lower(btrim(u."Learner_type")) IN ('commercial','apprenticeship')
                  AND nullif(lower(btrim(u."Email")),'')=lower(btrim(a."Email"))
                  AND lower(btrim(l.email))=lower(btrim(a."Email"))''',
                [args.profile_id, args.enrolment_id, args.aptem_id]).fetchall()
            if len(identity) != 1:
                raise ValueError('Profile, enrolment and source identity do not agree.')
            if args.apply:
                cur.execute('SELECT id FROM "Learner".learners WHERE id=%s FOR UPDATE', [args.profile_id])
            registry = bool(cur.execute('SELECT to_regclass(%s) AS registry', [REGISTRY]).fetchone()['registry'])
            rows = cur.execute('''SELECT * FROM fetching_evidence.evidence_items
                WHERE learner_id=%s AND evidence_id=ANY(%s) ORDER BY evidence_id'''
                + (' FOR SHARE' if args.apply else ''), [args.aptem_id, args.evidence_id]).fetchall()
            validate_selection(rows, args.evidence_id, args.aptem_id)
            existing = cur.execute(f'''SELECT * FROM {REGISTRY}
                WHERE enrolment_id=%s AND aptem_id=%s AND evidence_id=ANY(%s) ORDER BY evidence_id''',
                [args.enrolment_id, args.aptem_id, args.evidence_id]).fetchall() if registry else []
            before = protected_state(cur, args.profile_id, args.enrolment_id, args.aptem_id)
            fingerprint = digest(dict(host=options['host'], database=database, identity=identity,
                                      sources=rows, existing=existing, protected=before,
                                      actor=args.actor, reason=args.reason))
            report = dict(host=options['host'], database=database, fingerprint=fingerprint,
                          registry_installed=registry, selected_uploads=len(rows),
                          source_components=len({row['component_id'] for row in rows}),
                          original_statuses=dict(Counter(row['evidence_status'] for row in rows)),
                          existing_restorations=len(existing), applied=False)
            if args.apply:
                if database != args.expected_database or fingerprint != args.expected_fingerprint:
                    raise ValueError('Reviewed selection changed; preview again.')
                if not registry:
                    raise ValueError('Install the reviewed visibility registry before applying.')
                report['inserted'] = restore(cur, rows, args.enrolment_id, args.aptem_id,
                                             args.actor, args.reason, fingerprint)
                if protected_state(cur, args.profile_id, args.enrolment_id, args.aptem_id) != before:
                    raise ValueError('Source work, progress, plan or native submissions changed; rolled back.')
                count = cur.execute(f'''SELECT count(*) AS count FROM {REGISTRY}
                    WHERE enrolment_id=%s AND aptem_id=%s AND evidence_id=ANY(%s) AND revoked_at IS NULL''',
                    [args.enrolment_id, args.aptem_id, args.evidence_id]).fetchone()['count']
                if count != len(rows):
                    raise ValueError('Restoration verification failed; rolled back.')
                report.update(applied=True, protected_records_unchanged=True)
        # Emit success only after the transaction actually commits.
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({'error': str(exc) if isinstance(exc, ValueError) else type(exc).__name__}))
        raise SystemExit(1)
