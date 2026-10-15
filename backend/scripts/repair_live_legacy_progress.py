"""Scoped, fingerprinted recovery using the linked account's live LMS facts.

No Django startup, schema changes, emails or quiz answers. Preview is read-only.
Catalogue repair only collapses proven typed duplicates, preserving ambiguous
lineage and all historical records. Learner recovery never awards study hours.
"""
import argparse
import gzip
import json
import urllib.request

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import repair_legacy_course_catalogue as catalogue
from reconcile_aptem_evidence import digest, insert, ids
from reconcile_old_lms_missing_ssot import database_url, env_values
from restore_legacy_material_progress import SameOrigin, source_instant

RUN_KIND = 'verified-live-legacy-progress-v1'
FIELDS = ('component_id', 'title', 'post_type', 'component_kind', 'material_type',
          'section_id', 'section_title', 'section_order', 'component_order',
          'completed', 'started_at', 'completed_at', 'passed', 'attempts_count',
          'best_score_percent', 'last_status')


def fetch_courses(user_id):
    request = urllib.request.Request(
        'https://kentbusinesscollege.org/wp-json/custom/v1/courses-progress'
        f'?user_id={user_id}&include_answers=false&include_other_modules=false',
        headers={'X-KBC-API-Key': env_values()['KBC_LMS_API_KEY'],
                 'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
    with urllib.request.build_opener(SameOrigin()).open(request, timeout=45) as response:
        stream = gzip.GzipFile(fileobj=response) if response.headers.get('Content-Encoding') == 'gzip' else response
        raw = stream.read(80 * 1024 * 1024 + 1)
    if len(raw) > 80 * 1024 * 1024:
        raise ValueError('Source response exceeds limit.')
    rows = json.loads(raw)
    if not isinstance(rows, list) or not rows or any(c.get('user_id') != user_id for c in rows):
        raise ValueError('Source learner mismatch.')
    result = {}
    for row in rows:
        course_id = int(row['course_id'])
        if course_id in result:
            raise ValueError('Duplicate source course.')
        facts = {}
        for key, prefix in [('materials', 'material'), ('quizzes', 'quiz')]:
            if not isinstance(row.get(key), list):
                raise ValueError('Missing source components.')
            for item in row[key]:
                ident = item.get('component_id')
                if not isinstance(ident, int) or ident <= 0:
                    raise ValueError('Invalid component identity.')
                ref = f'{prefix}:{ident}'
                if ref in facts:
                    raise ValueError('Duplicate typed component.')
                facts[ref] = {k: item.get(k) for k in FIELDS}
        result[course_id] = {'course_id': course_id, 'source_user_id': user_id,
                            'email': row.get('email'), 'timezone': row.get('timezone'), 'facts': facts}
    return result


def export_for(course):
    # Only supported post types can establish a duplicate. Unmatched and native
    # content is preserved by catalogue_only; pages never become invented lessons.
    materials = [{**fact, 'source_component_id': fact['component_id']}
                 for fact in course['facts'].values()
                 if fact['post_type'] in ('stm-lessons', 'stm-quizzes')]
    return {'course_id': course['course_id'], 'source_user_id': course['source_user_id'],
            'curriculum': {'sections': [{'materials': materials}]}}


def verify_identity(state, source):
    saved = state['identity']['source_payload']
    email = saved.get('source_email') or saved.get('learner_email')
    if (not email or str(source['email']).strip().casefold() != email.strip().casefold()
            or str(source['source_user_id']) != str(state['identity']['source_learner_id'])):
        raise ValueError('Live account identity differs from the saved identity.')


def card(projection):
    total = len(projection['items'])
    done = sum(bool(i['completed']) for i in projection['items'])
    return {'completed': done, 'total': total, 'percent': round(100 * done / total, 2) if total else 0,
            'accepted_hours': projection['accepted_hours']}


def run_catalogue(args, sources):
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE if args.apply else psycopg.IsolationLevel.REPEATABLE_READ
        cur = conn.cursor()
        cur.execute("SET LOCAL statement_timeout='60s'")
        cur.execute("SET LOCAL lock_timeout='5s'")
        target = digest({'database': conn.info.dbname, 'host': conn.info.host})
        if args.apply and args.expected_target != target:
            raise ValueError('Database target differs from the preview.')
        states, plans = {}, {}
        for course_id in args.course_ids:
            source = sources[course_id]
            state = catalogue.read_state(cur, course_id, args.aptem_id, catalogue_only=True,
                                         verified_export=export_for(source))
            verify_identity(state, source)
            states[course_id] = state
        if args.apply:
            owner_ids = sorted({o['id'] for state in states.values() for o in state['owners']})
            cur.execute('SELECT id FROM curriculum.source_courses WHERE id=ANY(%s) ORDER BY id FOR UPDATE',
                        [[s['course']['id'] for s in states.values()]])
            cur.execute("""SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),id::integer)
                FROM unnest(%s::bigint[]) owner(id) ORDER BY id""", [owner_ids])
            cur.execute('SELECT id FROM "Learner".learners WHERE id=ANY(%s) ORDER BY id FOR UPDATE', [owner_ids])
        for course_id, state in states.items():
            plans[course_id] = catalogue.plan_repair(state, [], [], catalogue_only=True)
        fingerprint = digest(states)
        if args.apply and fingerprint != args.expected_fingerprint:
            raise ValueError('State changed since preview.')
        output = {'database': conn.info.dbname, 'target': target, 'fingerprint': fingerprint,
                  'stage': 'catalogue', 'courses': {}}
        for course_id, state in states.items():
            plan = plans[course_id]
            details = {'before': card(plan['before'][state['owner']['id']]),
                       'archive_duplicates': len(plan['archive']), 'lineage_links': len(plan['links']),
                       'members_checked': len(state['owners'])}
            output['courses'][course_id] = details
            if args.apply and (plan['archive'] or plan['links']):
                run = catalogue.apply_plan(cur, state, plan, digest(state))
                after = catalogue.read_state(cur, course_id, args.aptem_id, catalogue_only=True,
                                             verified_export=export_for(sources[course_id]))
                projected = catalogue.verify(state, after, plan)
                pending = catalogue.plan_repair(after, [], [], catalogue_only=True)
                if pending['archive'] or pending['links']:
                    raise ValueError('Catalogue repair is not idempotent.')
                details.update(after=card(projected[state['owner']['id']]), audit_run=run,
                               all_members_verified=True, historical_records_unchanged=True, idempotent=True)
                cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',
                    finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(details), run])
        output['applied'] = args.apply
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--source-user-id', type=int, required=True)
    parser.add_argument('--course-ids', type=ids, required=True)
    parser.add_argument('--stage', choices=['catalogue'], default='catalogue')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and (not args.expected_target or not args.expected_fingerprint):
        parser.error('Apply requires the preview target and fingerprint.')
    try:
        sources = fetch_courses(args.source_user_id)
        if not set(args.course_ids) <= sources.keys():
            raise ValueError('Selected course is not in the linked source enrolments.')
        print(json.dumps(run_catalogue(args, sources), default=str))
    except Exception as exc:
        # Driver/HTTP errors can include credentials or personal response bodies.
        print(json.dumps({'error_type': type(exc).__name__,
                          'detail': str(exc) if isinstance(exc, ValueError) else None,
                          'sqlstate': getattr(exc, 'sqlstate', None),
                          'http_status': getattr(exc, 'code', None)}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
