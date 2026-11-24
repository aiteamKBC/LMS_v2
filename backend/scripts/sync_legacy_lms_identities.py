"""Verify legacy LMS aliases against the canonical source-alias table.

This command is deliberately read-only. Historical ``learner_profile_id=NULL``
rows remain valid evidence, but never authorize or identify a current learner.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

import psycopg
from psycopg.rows import dict_row


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
    aliases = cur.execute('''SELECT aptem_id,canonical_lms_id,lms_learner_id,
        aptem_email,lms_email,is_primary,match_basis,first_seen,last_seen,learner_profile_id
        FROM "Last_audit".learner_lms_aliases
        ORDER BY aptem_id,lms_learner_id''').fetchall()
    # One authoritative table remains. Retain the report's source projection
    # for callers without pretending a second copy is being verified.
    source = [{key: value for key, value in row.items() if key != 'learner_profile_id'}
              for row in aliases]
    linked = cur.execute('''SELECT alias.aptem_id,alias.lms_learner_id,
        alias.learner_profile_id,learner.aptem_id AS learner_aptem_id
        FROM "Last_audit".learner_lms_aliases alias
        LEFT JOIN "Learner".learners learner ON learner.id=alias.learner_profile_id
        WHERE alias.learner_profile_id IS NOT NULL
        ORDER BY alias.aptem_id,alias.lms_learner_id''').fetchall()
    return {'source': source, 'aliases': aliases, 'linked': linked}


def verify(state):
    source_by_key = {(row['aptem_id'], row['lms_learner_id']): row for row in state['source']}
    aliases_by_key = {(row['aptem_id'], row['lms_learner_id']): row for row in state['aliases']}
    missing = sorted(set(source_by_key) - set(aliases_by_key))
    extra = sorted(set(aliases_by_key) - set(source_by_key))
    compared_fields = (
        'canonical_lms_id', 'aptem_email', 'lms_email', 'is_primary',
        'match_basis', 'first_seen', 'last_seen',
    )
    mismatched = sorted(
        key for key in set(source_by_key) & set(aliases_by_key)
        if any(source_by_key[key].get(field) != aliases_by_key[key].get(field)
               for field in compared_fields)
    )
    linked_mismatches = sorted(
        (row['aptem_id'], row['lms_learner_id'], row['learner_profile_id'])
        for row in state['linked']
        if row['learner_aptem_id'] is None or row['learner_aptem_id'] != row['aptem_id']
    )
    historical = sum(row['learner_profile_id'] is None for row in state['aliases'])
    return {
        'source_records': len(state['source']),
        'canonical_records': len(state['aliases']),
        'historical_records': historical,
        'linked_records': len(state['aliases']) - historical,
        # Compatibility counters: read_state now projects the same authoritative
        # rows, so copy-comparison counters are zero; ownership is checked below.
        'source_only_records': len(missing),
        'canonical_orphan_records': len(extra),
        'metadata_mismatch_records': len(mismatched),
        'linked_aptem_mismatch_records': len(linked_mismatches),
        'consistent': not (extra or mismatched or linked_mismatches),
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.apply:
        parser.error('Apply mode is retired; this verifier is read-only.')
    return args


def main(argv=None):
    parse_args(argv)
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute('SET LOCAL statement_timeout=20000')
            database = cur.execute('SELECT current_database() AS name').fetchone()['name']
            state = read_state(cur)
            output = {'database': database, 'fingerprint': digest(state), **verify(state)}
    print(json.dumps(output, default=str))
    return output


if __name__ == '__main__':
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({'error': str(exc) if isinstance(exc, ValueError) else type(exc).__name__}))
        sys.exit(1)
