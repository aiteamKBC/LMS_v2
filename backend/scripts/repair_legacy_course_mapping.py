"""Relink one verified legacy course to its explicitly selected replacement.

Preview by default; apply requires the database and state fingerprints. Only
course display/mapping metadata changes. All member records and assignments are
checked before commit. No Django startup, meetings, emails or progress writes.
"""
import argparse
from copy import deepcopy
import gzip
from html import unescape
import json
import re
import urllib.request

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import repair_legacy_course_catalogue as catalogue
from reconcile_aptem_evidence import digest, insert
from reconcile_old_lms_missing_ssot import database_url, env_values
from restore_legacy_material_progress import SameOrigin

RUN_KIND = 'verified-source-course-replacement-v1'


def source_metadata(args):
    request = urllib.request.Request(
        'https://kentbusinesscollege.org/wp-json/custom/v1/courses-progress'
        f'?user_id={args.source_user_id}&course_id={args.course_id}'
        '&include_answers=false&include_other_modules=false',
        headers={'X-KBC-API-Key': env_values()['KBC_LMS_API_KEY'],
                 'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
    with urllib.request.build_opener(SameOrigin()).open(request, timeout=45) as response:
        stream = gzip.GzipFile(fileobj=response) if response.headers.get('Content-Encoding') == 'gzip' else response
        raw = stream.read(80 * 1024 * 1024 + 1)
    if len(raw) > 80 * 1024 * 1024:
        raise ValueError('Source response exceeds limit.')
    rows = json.loads(raw)
    if (not isinstance(rows, list) or len(rows) != 1
            or rows[0].get('user_id') != args.source_user_id
            or rows[0].get('course_id') != args.course_id):
        raise ValueError('Source account/course mismatch.')
    return {key: rows[0].get(key) for key in ('course', 'email', 'course_status')}


def read_state(cur, args):
    state = catalogue.read_state(cur, args.course_id, args.aptem_id, catalogue_only=True,
        verified_export={'course_id': args.course_id, 'source_user_id': args.source_user_id})
    state['modules'] = cur.execute('''SELECT * FROM curriculum.modules
        WHERE module_catalogue_id=ANY(%s) ORDER BY module_catalogue_id''',
        [[args.from_module, args.to_module]]).fetchall()
    learner_ids = [o['id'] for o in state['owners']]
    state['plans'] = cur.execute('''SELECT id,"Learning_plan","Training_plan" FROM enrolment."Created_users"
        WHERE id=ANY(%s) ORDER BY id''', [[o['enrolment_id'] for o in state['owners']]]).fetchall()
    state['preserved'] = {}
    for table, field in (
        ('learner_progress_entries', 'learner_id'), ('learner_activity_sources', 'learner_id'),
        ('learner_activity_reporting_segments', 'learner_id'), ('learner_journal_rows', 'canonical_learner_id'),
        ('learner_source_course_memberships', 'learner_id'), ('learner_training_plan_modules', 'learner_id'),
    ):
        state['preserved'][table] = cur.execute(f'''SELECT count(*) AS count,
            md5(string_agg(md5(row_to_json(r)::text),'' ORDER BY id)) AS fingerprint
            FROM "Learner".{table} r WHERE {field}=ANY(%s)''', [learner_ids]).fetchone()
    state['other_courses'] = cur.execute('''SELECT count(*) AS count,
        md5(string_agg(md5(row_to_json(r)::text),'' ORDER BY id)) AS fingerprint
        FROM curriculum.source_courses r WHERE id<>%s''', [state['course']['id']]).fetchone()
    return state


def replacement(state, source, args):
    modules = {m['module_catalogue_id']: m for m in state['modules']}
    old, new = modules[args.from_module], modules[args.to_module]
    if old['deleted_at'] is None or new['deleted_at'] is not None:
        raise ValueError('Expected an archived source module and a live replacement.')
    if old['programme_id'] != new['programme_id'] or old['group_id'] != new['group_id']:
        raise ValueError('Replacement must belong to the same programme and group.')
    # IDs are explicit: title equivalence is an additional check, never a match
    # strategy. The MSP abbreviation is the only permitted title difference.
    def title(value):
        return re.sub(r'\W+', '', unescape(str(value or '')).casefold().replace('(msp)', ''))
    if not title(source['course']) or not (title(old['title']) == title(new['title']) == title(source['course'])):
        raise ValueError('Explicit modules do not match the verified source title.')
    payload = state['identity']['source_payload']
    saved_email = payload.get('source_email') or payload.get('learner_email')
    if not saved_email or saved_email.strip().casefold() != str(source['email'] or '').strip().casefold():
        raise ValueError('Live source identity differs from the verified linked account.')
    plan = next(p for p in state['plans'] if p['id'] == state['owner']['enrolment_id'])
    saved = plan['Training_plan'] if isinstance(plan['Training_plan'], list) else catalogue.decoded(plan['Learning_plan'])
    if args.to_module not in {m.get('moduleId') for m in saved or []}:
        raise ValueError('The selected learner is not assigned the replacement.')
    fields = {'curriculum_module_ref': args.to_module, 'source_course_title': new['title'],
              'mapping_method': 'verified_source_replacement', 'mapping_status': 'matched'}
    if all(state['course'][key] == value for key, value in fields.items()):
        return {}
    if state['course']['curriculum_module_ref'] != args.from_module:
        raise ValueError('Course mapping changed; review its current identity.')
    return fields


def run(args):
    source = source_metadata(args)
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE if args.apply else psycopg.IsolationLevel.REPEATABLE_READ
        cur = conn.cursor()
        cur.execute("SET LOCAL statement_timeout='60s'")
        cur.execute("SET LOCAL lock_timeout='5s'")
        target = digest({'database': conn.info.dbname, 'host': conn.info.host})
        if args.apply and target != args.expected_target:
            raise ValueError('Database differs from preview.')
        before = read_state(cur, args)
        fields = replacement(before, source, args)
        fingerprint = digest({'state': before, 'source': source, 'fields': fields})
        output = {'database': conn.info.dbname, 'target': target, 'fingerprint': fingerprint,
                  'members_checked': len(before['owners']), 'course_id': args.course_id,
                  'from_module': args.from_module, 'to_module': args.to_module,
                  'title': source['course'], 'mapping_changes': bool(fields)}
        original = catalogue.projections(before, include_placements=False)
        proposed = {**before, 'course': {**before['course'], **fields}}
        projected = catalogue.projections(proposed, include_placements=False)
        # Only the displayed course title may differ, including for other members.
        expected = deepcopy(original)
        for projection in expected.values():
            for item in projection['items']:
                item['group_name'] = proposed['course']['source_course_title']
        if digest(projected) != digest(expected):
            raise ValueError('Replacement would alter progress, hours or activity identities.')
        learner = projected[before['owner']['id']]
        output['learner_progress'] = {'completed': sum(i['completed'] for i in learner['items']),
            'total': len(learner['items']), 'accepted_hours': learner['accepted_hours']}
        if not args.apply or not fields:
            return output
        if fingerprint != args.expected_fingerprint:
            raise ValueError('State changed since preview.')
        cur.execute('SELECT id FROM curriculum.source_courses WHERE id=%s FOR UPDATE', [before['course']['id']])
        previous = {k: before['course'][k] for k in (*fields, 'mapped_at', 'mapped_by', 'source_payload')}
        audit = insert(cur, 'activity_sync_runs', {'run_key': RUN_KIND + ':' + fingerprint,
            'run_kind': RUN_KIND, 'status': 'running', 'dry_run': False,
            'source_counts': Jsonb({'course_id': args.course_id,
                                  'previous': json.loads(json.dumps(previous, default=str))}),
            'result_counts': Jsonb(output)})
        recovery = {'verified_replacement': {'run_id': audit, 'previous_module': args.from_module,
            'module_id': args.to_module, 'source_title': source['course']}}
        actual = cur.execute('''UPDATE curriculum.source_courses
            SET curriculum_module_ref=%s,source_course_title=%s,mapping_method=%s,mapping_status=%s,
                mapped_at=now(),mapped_by=%s,source_payload=source_payload||%s::jsonb
            WHERE id=%s AND curriculum_module_ref=%s AND deleted_at IS NULL RETURNING *''',
            [fields['curriculum_module_ref'], fields['source_course_title'], fields['mapping_method'],
             fields['mapping_status'], RUN_KIND, Jsonb(recovery), before['course']['id'], args.from_module]).fetchone()
        if actual is None:
            raise ValueError('Course mapping changed during repair.')
        expected_course = {**before['course'], **fields, 'mapped_at': actual['mapped_at'], 'mapped_by': RUN_KIND,
                           'source_payload': {**before['course']['source_payload'], **recovery}}
        after = read_state(cur, args)
        if after != {**before, 'course': expected_course}:
            raise ValueError('Unexpected change to member records, assignments or catalogue.')
        if catalogue.projections(after, include_placements=False) != projected or replacement(after, source, args):
            raise ValueError('Committed projection or idempotence verification failed.')
        output.update(applied=True, audit_run=audit, member_records_preserved=True, idempotent=True)
        cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
            updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(output), audit])
        return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('aptem-id', 'source-user-id', 'course-id'):
        parser.add_argument('--' + name, type=int, required=True)
    for name in ('from-module', 'to-module'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and (not args.expected_target or not args.expected_fingerprint):
        parser.error('Apply requires the preview target and fingerprint.')
    try:
        print(json.dumps(run(args), default=str))
    except Exception as exc:
        print(json.dumps({'error_type': type(exc).__name__,
                          'detail': str(exc) if isinstance(exc, ValueError) else None,
                          'sqlstate': getattr(exc, 'sqlstate', None)}))
        raise SystemExit(1)
