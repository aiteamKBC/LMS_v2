"""Restore only missing quiz pass flags from verified, course-owned live evidence.

Preview is read-only. Apply requires matching database/state/source fingerprints.
No scores, answers, attempts, hours, catalogue or source history are rewritten.
"""
import argparse
import json

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import repair_legacy_course_catalogue as catalogue
from reconcile_aptem_evidence import digest, ids, insert
from reconcile_old_lms_missing_ssot import database_url
from repair_live_legacy_progress import fetch_courses, export_for, verify_identity

RUN_KIND = 'verified-legacy-quiz-pass-flags-v1'


def plan_flags(state, source):
    verify_identity(state, source)
    if str(source['course_id']) != str(state['course']['source_course_ref']):
        raise ValueError('Source course mismatch.')
    definitions = {d['id']: d for d in state['definitions'] if d['deleted_at'] is None}
    routes = {}
    for link in state['sources']:
        definition = definitions.get(link.get('source_catalog_activity_id'))
        if (link.get('deleted_at') is not None or link.get('learner_id') != state['owner']['id']
                or link.get('source_system') != 'old_lms' or not definition):
            continue
        ref = definition['source_activity_id']
        if ref.startswith('quiz:') and link['source_activity_id'] == ref:
            routes.setdefault(link['canonical_progress_id'], set()).add(ref)
    updates, conflicts = [], []
    for row in state['progress']:
        if (row['learner_id'] != state['owner']['id'] or row.get('deleted_at') is not None
                or row.get('kind') != 'quiz' or row.get('source_system') != 'old_lms'
                or row.get('passed') is not None or row['id'] not in routes):
            continue
        refs = routes[row['id']]
        if len(refs) != 1:
            conflicts.append(row['id'])
            continue
        ref = next(iter(refs))
        fact = source['facts'].get(ref, {})
        if row.get('activity_status') == 'passed' and fact.get('passed') is True:
            updates.append({'id': row['id'], 'source_ref': ref})
        else:
            conflicts.append(row['id'])
    return {'updates': updates, 'unresolved': conflicts}


def verify_preserved(before, after, changed):
    if set(before) != set(after):
        raise ValueError('Historical progress rows changed.')
    for ident, original in before.items():
        expected = {**original, 'passed': True} if ident in changed else original
        if after[ident] != expected:
            raise ValueError('A field other than the verified missing pass flag changed.')


def run(args, sources):
    with psycopg.connect(database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE if args.apply else psycopg.IsolationLevel.REPEATABLE_READ
        cur = conn.cursor()
        cur.execute("SET LOCAL statement_timeout='60s'")
        cur.execute("SET LOCAL lock_timeout='5s'")
        target = digest({'database': conn.info.dbname, 'host': conn.info.host})
        if args.apply and args.expected_target != target:
            raise ValueError('Database target differs from preview.')
        states = {cid: catalogue.read_state(cur, cid, args.aptem_id, catalogue_only=True,
                  verified_export=export_for(sources[cid])) for cid in args.course_ids}
        owners = sorted({s['owner']['id'] for s in states.values()})
        if args.apply:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),id::integer) FROM unnest(%s::bigint[]) owner(id) ORDER BY id", [owners])
            cur.execute('SELECT id FROM "Learner".learners WHERE id=ANY(%s) ORDER BY id FOR UPDATE', [owners])
        plans = {cid: plan_flags(state, sources[cid]) for cid, state in states.items()}
        fingerprint = digest({'states': states, 'sources': {cid: sources[cid] for cid in args.course_ids}})
        if args.apply and args.expected_fingerprint != fingerprint:
            raise ValueError('Evidence or database state changed since preview.')
        result = {'target': target, 'fingerprint': fingerprint, 'applied': args.apply,
                  'courses': {cid: {'restore_pass_flags': len(p['updates']), 'unresolved': len(p['unresolved'])} for cid, p in plans.items()}}
        changes = {item['id']: item for plan in plans.values() for item in plan['updates']}
        if not args.apply or not changes:
            return result
        before = {p['id']: p for s in states.values() for p in s['progress']}
        run_id = insert(cur, 'activity_sync_runs', dict(run_key=RUN_KIND + ':' + fingerprint,
            run_kind=RUN_KIND, status='running', dry_run=False,
            source_counts=Jsonb({'source_fingerprint': digest(sources), 'changes': list(changes.values()), 'previous_passed': None}),
            result_counts=Jsonb({})))
        cur.execute('UPDATE "Learner".learner_progress_entries SET passed=true WHERE id=ANY(%s) AND learner_id=ANY(%s) AND passed IS NULL AND deleted_at IS NULL', [sorted(changes), owners])
        if cur.rowcount != len(changes):
            raise ValueError('Concurrent pass flag change.')
        refreshed = {cid: catalogue.read_state(cur, cid, args.aptem_id, catalogue_only=True,
                    verified_export=export_for(sources[cid])) for cid in args.course_ids}
        after = {p['id']: p for s in refreshed.values() for p in s['progress']}
        verify_preserved(before, after, set(changes))
        for cid, state in refreshed.items():
            for key in state:
                if key != 'progress' and state[key] != states[cid][key]:
                    raise ValueError('Related source history or hours changed.')
            if plan_flags(state, sources[cid])['updates']:
                raise ValueError('Repair is not idempotent.')
        result.update(audit_run=run_id, historical_fields_preserved=True, idempotent=True)
        cur.execute('UPDATE "Learner".activity_sync_runs SET status=\'completed\',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', [Jsonb(result), run_id])
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--source-user-id', type=int, required=True)
    parser.add_argument('--course-ids', type=ids, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and (not args.expected_target or not args.expected_fingerprint):
        parser.error('Apply requires preview target and fingerprint.')
    try:
        sources = fetch_courses(args.source_user_id)
        if not set(args.course_ids) <= sources.keys():
            raise ValueError('Selected course is not owned by the source account.')
        print(json.dumps(run(args, sources)))
    except Exception as exc:
        print(json.dumps({'error_type': type(exc).__name__, 'detail': str(exc) if isinstance(exc, ValueError) else None}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
