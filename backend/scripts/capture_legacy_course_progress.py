"""Capture one learner's old course percentages without changing learning credit.

Preview is read-only. Apply needs the preview's database fingerprint. Existing
references remain immutable; no hours, completion, transfers or schema are edited.
Only aggregate results are printed; source identities and credentials stay in memory.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
from math import isfinite
import sys
from pathlib import Path
import urllib.request

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api.legacy_course_progress import public_reference
from reconcile_old_lms_missing_ssot import database_url, env_values
from restore_legacy_material_progress import ENDPOINT, SameOrigin


def fetch_percentages(source_id, expected_email):
    request = urllib.request.Request(
        f'{ENDPOINT}?user_id={source_id}&include_answers=false&include_other_modules=false',
        headers={'X-KBC-API-Key': env_values()['KBC_LMS_API_KEY'],
                 'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
    with urllib.request.build_opener(SameOrigin()).open(request, timeout=45) as response:
        stream = gzip.GzipFile(fileobj=response) if response.headers.get('Content-Encoding') == 'gzip' else response
        raw = stream.read(80 * 1024 * 1024 + 1)
    if len(raw) > 80 * 1024 * 1024:
        raise ValueError('Source response exceeds limit.')
    return verified_percentages(json.loads(raw), source_id, expected_email)


def verified_percentages(rows, source_id, expected_email):
    if not isinstance(rows, list) or not rows or not expected_email:
        raise ValueError('An owned source course inventory is required.')
    result = {}
    for row in rows:
        if (not isinstance(row, dict) or row.get('user_id') != source_id
                or str(row.get('email') or '').strip().casefold() != expected_email.strip().casefold()):
            raise ValueError('Source account identity mismatch.')
        course, percent = row.get('course_id'), row.get('progress')
        if type(course) is not int or course <= 0 or str(course) in result:
            raise ValueError('Ambiguous source course identity.')
        if type(percent) not in (int, float) or not isfinite(percent) or not 0 <= percent <= 100:
            raise ValueError('A source course percentage is unavailable or invalid.')
        result[str(course)] = percent
    return result


def plan_references(owner, memberships, percentages, captured_at):
    plan = []
    for member in memberships:
        ref = str(member['source_course_ref'])
        if (str(member['source_learner_id']) != str(owner['source_learner_id'])
                or member['enrolment_id'] != owner['enrolment_id'] or ref not in percentages):
            raise ValueError('The owned course membership does not match the source account.')
        existing = member['source_payload'].get('legacy_course_progress')
        if 'legacy_course_progress' in member['source_payload']:
            if public_reference(existing, owner, member) is None:
                raise ValueError('An existing historical reference needs review.')
            continue
        snapshot = {'version': 1, 'basis': 'old_lms:course_progress',
                    'learner_id': owner['id'], 'enrolment_id': owner['enrolment_id'],
                    'source_learner_id': str(owner['source_learner_id']), 'source_course_ref': ref,
                    'percent': percentages[ref], 'captured_at': captured_at}
        if public_reference(snapshot, owner, member) is None:
            raise ValueError('Invalid historical reference.')
        plan.append((member['id'], snapshot))
    return plan


def run(enrolment_id, *, apply=False, expected_target=None):
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not apply
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        target = hashlib.sha256(f'{conn.info.host}/{conn.info.dbname}'.encode()).hexdigest()
        if apply and target != expected_target:
            raise ValueError('Database target differs from the reviewed preview.')
        cur = conn.cursor()
        cur.execute("SET LOCAL statement_timeout='20s'")
        cur.execute("SET LOCAL lock_timeout='5s'")
        owners = cur.execute('''SELECT l.id,l.enrolment_id,l.aptem_id,
            i.source_learner_id,coalesce(nullif(i.source_payload->>'source_email',''),
                i.source_payload->>'learner_email') AS source_email
            FROM "Learner".learners l JOIN enrolment."Created_users" e ON e.id=l.enrolment_id
            JOIN "Learner".learner_external_identities i ON i.learner_id=l.id
                AND i.source_system='old_lms' AND i.deleted_at IS NULL
            WHERE l.enrolment_id=%s AND l.aptem_id::text=e.aptem_id::text
              AND lower(trim(l.email))=lower(trim(e."Email"))''', [enrolment_id]).fetchall()
        if len(owners) != 1:
            raise ValueError('Expected one verified learner and source identity.')
        owner = owners[0]
        memberships = cur.execute('''SELECT m.id,m.enrolment_id,m.source_learner_id,
            coalesce(m.source_payload,'{}'::jsonb) AS source_payload,c.source_course_ref
            FROM "Learner".learner_source_course_memberships m
            JOIN curriculum.source_courses c ON c.id=m.source_course_id
            WHERE m.learner_id=%s AND m.deleted_at IS NULL AND c.deleted_at IS NULL
              AND c.source_system='old_lms' AND m.source_relationship='historical'
            ORDER BY m.id''' + (' FOR UPDATE OF m' if apply else ''), [owner['id']]).fetchall()
        if not memberships or any(not isinstance(m['source_payload'], dict) for m in memberships):
            raise ValueError('Verified historical course memberships are required.')
        percentages = fetch_percentages(int(owner['source_learner_id']), owner['source_email'])
        plan = plan_references(owner, memberships, percentages, datetime.now(timezone.utc).isoformat())
        if apply:
            for ident, snapshot in plan:
                cur.execute('''UPDATE "Learner".learner_source_course_memberships
                    SET source_payload=coalesce(source_payload,'{}'::jsonb)
                        || jsonb_build_object('legacy_course_progress',%s::jsonb)
                    WHERE id=%s AND learner_id=%s AND enrolment_id=%s AND deleted_at IS NULL
                      AND NOT (coalesce(source_payload,'{}'::jsonb) ? 'legacy_course_progress')
                    RETURNING source_payload->'legacy_course_progress' AS snapshot''',
                    [Jsonb(snapshot), ident, owner['id'], enrolment_id])
                saved = cur.fetchone()
                if not saved or saved['snapshot'] != snapshot:
                    raise ValueError('Historical reference verification failed; transaction rolled back.')
        return {'database_target': target, 'mode': 'applied' if apply else 'preview',
                'owned_courses': len(memberships), 'references_added': len(plan),
                'existing_references_preserved': len(memberships) - len(plan)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--enrolment-id', type=int, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.enrolment_id, apply=args.apply, expected_target=args.expected_target)))
    except Exception as error:
        print(json.dumps({'error_type': type(error).__name__,
                          'detail': str(error) if isinstance(error, ValueError) else None}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
