"""Group an owned old course with an assigned current module for display only.

No completion equivalence, hours transfer, membership removal or schema change.
Apply requires a read-only preview fingerprint and records the previous payload.
"""
import argparse
import json
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from reconcile_aptem_evidence import digest, insert
from reconcile_old_lms_missing_ssot import database_url


def group_payload(payload, module, plan):
    plan = json.loads(plan) if isinstance(plan, str) else plan
    if not isinstance(plan, list) or module not in {p.get('moduleId') for p in plan if isinstance(p, dict)}:
        raise ValueError('Current module is not in the saved learner plan.')
    payload = json.loads(payload) if isinstance(payload, str) else payload
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise ValueError('Invalid membership payload.')
    previous = payload.get('learning_display_group')
    if previous:
        if (not isinstance(previous, dict) or previous.get('current_module_ref') != module
                or previous.get('completion_equivalence') is not False):
            raise ValueError('Conflicting display group needs separate review.')
        return payload
    return {**payload, 'learning_display_group': {'current_module_ref': module,
        'basis': 'owner-approved-separate-prior-learning', 'completion_equivalence': False}}


def snapshot(cur, aptem_id, course_id, module):
    owners = cur.execute('''SELECT l.id,l.enrolment_id,u."Learning_plan" AS plan
        FROM "Learner".learners l JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE l.aptem_id=%s AND u.aptem_id::text=l.aptem_id::text
          AND lower(l.email)=lower(u."Email")''', [aptem_id]).fetchall()
    if len(owners) != 1:
        raise ValueError('Expected one verified learner owner.')
    owner = owners[0]
    members = cur.execute('''SELECT m.* FROM "Learner".learner_source_course_memberships m
        JOIN curriculum.source_courses c ON c.id=m.source_course_id
        WHERE m.learner_id=%s AND c.source_course_ref=%s AND c.source_system='old_lms'
          AND m.deleted_at IS NULL AND c.deleted_at IS NULL''', [owner['id'], str(course_id)]).fetchall()
    modules = cur.execute('SELECT module_catalogue_id FROM curriculum.modules WHERE module_catalogue_id=%s AND deleted_at IS NULL', [module]).fetchall()
    if len(members) != 1 or len(modules) != 1:
        raise ValueError('Owned previous course or active current module is missing.')
    result = {'owner': owner, 'membership': members[0]}
    for name in ('learner_progress_entries', 'learner_activity_sources', 'learner_activity_reporting_segments', 'learner_source_course_memberships'):
        result[name] = cur.execute(f'SELECT * FROM "Learner".{name} WHERE learner_id=%s ORDER BY id', [owner['id']]).fetchall()
    result['journals'] = cur.execute('SELECT * FROM "Learner".learner_journal_rows WHERE canonical_learner_id=%s ORDER BY id', [owner['id']]).fetchall()
    return result


def run(args):
    with psycopg.connect(database_url(), row_factory=dict_row, connect_timeout=15) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE if args.apply else psycopg.IsolationLevel.REPEATABLE_READ
        cur = conn.cursor()
        cur.execute("SET LOCAL statement_timeout='60s'")
        cur.execute("SET LOCAL lock_timeout='5s'")
        target = digest({'database': conn.info.dbname, 'host': conn.info.host})
        if args.apply and args.expected_target != target:
            raise ValueError('Database target differs from preview.')
        before = snapshot(cur, args.aptem_id, args.course_id, args.module_id)
        if args.apply:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),%s)", [before['owner']['id']])
            cur.execute('SELECT id FROM "Learner".learners WHERE id=%s FOR UPDATE', [before['owner']['id']])
            cur.execute('SELECT id FROM enrolment."Created_users" WHERE id=%s FOR SHARE', [before['owner']['enrolment_id']])
            cur.execute('SELECT module_catalogue_id FROM curriculum.modules WHERE module_catalogue_id=%s FOR SHARE', [args.module_id])
        fingerprint = digest(before)
        if args.apply and args.expected_fingerprint != fingerprint:
            raise ValueError('Learner history or assignment changed since preview.')
        member = before['membership']
        payload = group_payload(member['source_payload'], args.module_id, before['owner']['plan'])
        result = {'target': target, 'fingerprint': fingerprint, 'change_required': payload != member['source_payload'], 'applied': args.apply}
        if not args.apply or not result['change_required']:
            return result
        run_id = insert(cur, 'activity_sync_runs', dict(run_key='previous-learning-display-v1:' + fingerprint,
            run_kind='previous-learning-display-v1', status='running', dry_run=False,
            source_counts=Jsonb({'membership_id': member['id'], 'previous_payload': member['source_payload'], 'new_payload': payload}), result_counts=Jsonb({})))
        cur.execute('UPDATE "Learner".learner_source_course_memberships SET source_payload=%s WHERE id=%s AND learner_id=%s AND deleted_at IS NULL', [Jsonb(payload), member['id'], before['owner']['id']])
        if cur.rowcount != 1:
            raise ValueError('Membership changed concurrently.')
        after = snapshot(cur, args.aptem_id, args.course_id, args.module_id)
        if after['membership']['source_payload'] != payload:
            raise ValueError('Display group was not persisted correctly.')
        after['membership']['source_payload'] = member['source_payload']
        for row in after['learner_source_course_memberships']:
            if row['id'] == member['id']:
                row['source_payload'] = member['source_payload']
        if digest(after) != fingerprint:
            raise ValueError('Historical records or another membership changed.')
        result.update(audit_run=run_id, historical_records_preserved=True)
        cur.execute('UPDATE "Learner".activity_sync_runs SET status=\'completed\',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', [Jsonb(result), run_id])
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--course-id', type=int, required=True)
    parser.add_argument('--module-id', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and (not args.expected_target or not args.expected_fingerprint):
        parser.error('Apply requires preview target and fingerprint.')
    try:
        print(json.dumps(run(args)))
    except Exception as exc:
        print(json.dumps({'error_type': type(exc).__name__, 'detail': str(exc) if isinstance(exc, ValueError) else None}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
