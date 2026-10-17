"""Refresh only a course's original schedule/upload metadata from its linked LMS.

Preview is read-only. Apply is fingerprinted, audited and preserves the learner
ledger. No course memberships, completions, materials, meetings or hours change.
"""
import argparse
import gzip
import json
import urllib.request

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from reconcile_aptem_evidence import digest, insert
from reconcile_old_lms_missing_ssot import database_url, env_values
from restore_legacy_material_progress import SameOrigin, source_instant

RUN_KIND = 'verified-source-course-schedule-v1'


def fetch_schedule(user_id, course_id):
    request = urllib.request.Request(
        'https://kentbusinesscollege.org/wp-json/custom/v1/courses-progress'
        f'?user_id={user_id}&course_id={course_id}&include_answers=false&include_other_modules=false',
        headers={'X-KBC-API-Key': env_values()['KBC_LMS_API_KEY'],
                 'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
    with urllib.request.build_opener(SameOrigin()).open(request, timeout=45) as response:
        stream = gzip.GzipFile(fileobj=response) if response.headers.get('Content-Encoding') == 'gzip' else response
        raw = stream.read(80 * 1024 * 1024 + 1)
    if len(raw) > 80 * 1024 * 1024:
        raise ValueError('Source response exceeds limit.')
    rows = json.loads(raw)
    if (not isinstance(rows, list) or len(rows) != 1
            or rows[0].get('user_id') != user_id or rows[0].get('course_id') != course_id):
        raise ValueError('Source account/course mismatch.')
    result = {}
    for collection, kind in (('materials', 'material'), ('quizzes', 'quiz')):
        for item in rows[0][collection]:
            ident = item['component_id']
            if not isinstance(ident, int) or ident <= 0:
                raise ValueError('Invalid component identity.')
            ref = f'{kind}:{ident}'
            if ref in result:
                raise ValueError('Duplicate typed component.')
            at = source_instant(item['created_at'], rows[0]['timezone']) if item.get('created_at') else None
            result[ref] = {'source_section_ref': str(item.get('section_id') or ''),
                           'source_section_title': item.get('section_title') or '',
                           'created_at_utc': at.isoformat() if at else None}
    return result


def read_state(cur, args):
    courses = cur.execute('''SELECT c.* FROM curriculum.source_courses c
        WHERE c.source_system='old_lms' AND c.source_course_ref=%s AND c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM "Learner".learner_source_course_memberships m
            JOIN "Learner".learners l ON l.id=m.learner_id
            JOIN "Learner".learner_external_identities i ON i.learner_id=l.id
            WHERE m.source_course_id=c.id AND m.deleted_at IS NULL AND l.aptem_id=%s
              AND i.source_system='old_lms' AND i.source_learner_id=%s AND i.deleted_at IS NULL)''',
        [str(args.course_id), args.aptem_id, str(args.source_user_id)]).fetchall()
    if len(courses) != 1:
        raise ValueError('Course/source identity is not uniquely assigned to the selected learner.')
    course = courses[0]
    memberships = cur.execute('''SELECT * FROM "Learner".learner_source_course_memberships
        WHERE source_course_id=%s AND deleted_at IS NULL ORDER BY id''', [course['id']]).fetchall()
    catalogue = cur.execute('''SELECT * FROM curriculum.source_activities
        WHERE source_course_id=%s AND deleted_at IS NULL ORDER BY id''', [course['id']]).fetchall()
    learner_ids = sorted({m['learner_id'] for m in memberships})
    ledger = {}
    for table in ('learner_progress_entries', 'learner_activity_sources', 'learner_activity_reporting_segments'):
        ledger[table] = cur.execute(f'''SELECT count(*) AS count,
            md5(string_agg(md5(row_to_json(r)::text),'' ORDER BY id)) AS fingerprint
            FROM "Learner".{table} r WHERE learner_id=ANY(%s)''', [learner_ids]).fetchone()
    return {'course': course, 'catalogue': catalogue, 'memberships': memberships, 'ledger': ledger}


def make_plan(state, schedule):
    plan = []
    for row in state['catalogue']:
        ref = row['source_activity_id']
        if ref not in schedule:
            raise ValueError('Active catalogue item is absent from the owned source course.')
        fact = schedule[ref]
        payload = row['source_payload']
        if not isinstance(payload, dict):
            raise ValueError('Catalogue payload is not an object.')
        fields = {key: fact[key] for key in ('source_section_ref', 'source_section_title')}
        old = {key: row[key] for key in fields}
        old['created_at_utc'] = payload.get('created_at_utc')
        created = fact['created_at_utc'] or old['created_at_utc']
        if fields != {key: row[key] for key in fields} or created != old['created_at_utc']:
            plan.append({'id': row['id'], 'fields': fields, 'created_at_utc': created, 'previous': old})
    return plan


def verify(before, after, plan, run_id):
    for key in ('course', 'memberships', 'ledger'):
        if before[key] != after[key]:
            raise ValueError('Course ownership or learner records changed.')
    old = {r['id']: r for r in before['catalogue']}
    if old.keys() != {r['id'] for r in after['catalogue']}:
        raise ValueError('Catalogue membership changed.')
    changes = {p['id']: p for p in plan}
    for actual in after['catalogue']:
        expected = dict(old[actual['id']])
        if actual['id'] in changes:
            change = changes[actual['id']]
            expected.update(change['fields'])
            expected['source_payload'] = {**expected['source_payload'],
                'created_at_utc': change['created_at_utc'],
                'course_schedule_recovery': {'run_id': run_id, 'course_id': before['course']['source_course_ref'],
                    'basis': 'linked-course-live-source-metadata', 'previous': change['previous']}}
        if actual != expected:
            raise ValueError('Catalogue changed beyond the approved schedule fields.')


def run(args):
    schedule = fetch_schedule(args.source_user_id, args.course_id)
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE if args.apply else psycopg.IsolationLevel.REPEATABLE_READ
        cur = conn.cursor()
        cur.execute("SET LOCAL statement_timeout='60s'")
        cur.execute("SET LOCAL lock_timeout='5s'")
        target = digest({'database': conn.info.dbname, 'host': conn.info.host})
        if args.apply and target != args.expected_target:
            raise ValueError('Database differs from preview.')
        state = read_state(cur, args)
        plan = make_plan(state, schedule)
        fingerprint = digest({'state': state, 'schedule': schedule})
        output = {'database': conn.info.dbname, 'target': target, 'fingerprint': fingerprint,
                  'catalogue_items': len(state['catalogue']), 'schedule_updates': len(plan),
                  'members_checked': len({m['learner_id'] for m in state['memberships']})}
        if args.apply:
            if fingerprint != args.expected_fingerprint:
                raise ValueError('State changed since preview.')
            if not plan:
                return {**output, 'already_correct': True}
            cur.execute('SELECT id FROM curriculum.source_courses WHERE id=%s FOR UPDATE', [state['course']['id']])
            audit_run = insert(cur, 'activity_sync_runs', {'run_key': RUN_KIND + ':' + fingerprint,
                'run_kind': RUN_KIND, 'status': 'running', 'dry_run': False,
                'source_counts': Jsonb({'course_id': args.course_id}), 'result_counts': Jsonb(output)})
            for change in plan:
                payload = {'created_at_utc': change['created_at_utc'],
                    'course_schedule_recovery': {'run_id': audit_run, 'course_id': state['course']['source_course_ref'],
                        'basis': 'linked-course-live-source-metadata', 'previous': change['previous']}}
                cur.execute('''UPDATE curriculum.source_activities SET source_section_ref=%s,
                    source_section_title=%s,source_payload=source_payload||%s::jsonb
                    WHERE id=%s AND source_course_id=%s AND deleted_at IS NULL''',
                    [change['fields']['source_section_ref'], change['fields']['source_section_title'],
                     Jsonb(payload), change['id'], state['course']['id']])
                if cur.rowcount != 1:
                    raise ValueError('Catalogue target changed during refresh.')
            after = read_state(cur, args)
            verify(state, after, plan, audit_run)
            if make_plan(after, schedule):
                raise ValueError('Schedule refresh is not idempotent.')
            output.update(applied=True, audit_run=audit_run, learner_records_unchanged=True, idempotent=True)
            cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
                updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(output), audit_run])
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('aptem-id', 'source-user-id', 'course-id'):
        parser.add_argument('--' + name, type=int, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and (not args.expected_target or not args.expected_fingerprint):
        parser.error('Apply requires a preview target and fingerprint.')
    try:
        print(json.dumps(run(args), default=str))
    except Exception as exc:
        print(json.dumps({'error_type': type(exc).__name__, 'detail': str(exc) if isinstance(exc, ValueError) else None,
                          'sqlstate': getattr(exc, 'sqlstate', None), 'http_status': getattr(exc, 'code', None)}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
