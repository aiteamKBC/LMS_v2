"""Recover verified original post dates for undated historical learning activities.

Preview is read-only. Apply needs its database and plan fingerprints. Only
catalogue schedule metadata changes; completion, hours and memberships do not.
Source snapshots must pass the existing account-identity and freshness checks.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from psycopg.types.json import Jsonb
import reconcile_legacy_learning as r
from learner_api.course_catalogue_display import catalogue_display_context, read_export_placements

VERSION = 'verified-legacy-undated-recovery-v1'


def schedule_evidence(verified):
    evidence = defaultdict(dict)
    for courses in verified.values():
        for cid, course in courses.items():
            for ref, fact in course['facts'].items():
                source = course.get('evidence', {}).get(ref, {})
                upload = r.original_upload_metadata(fact, source.get('timezone', course.get('timezone')))
                value = {**upload, 'source_section_ref': str(fact.get('section_id') or ''),
                         'source_section_title': fact.get('section_title') or ''}
                evidence[(str(cid), ref)][r.digest(value)] = value
    return {key: list(values.values()) for key, values in evidence.items()}


def make_plan(definitions, exports, evidence):
    before = catalogue_display_context(definitions, exports)
    candidates, proposed = {}, []
    for row in before:
        candidate = {**row, 'source_payload': dict(row.get('source_payload') or {})}
        if row['_display_schedule']['month'] == 'undated' and row['_display_schedule']['date_source'] not in {'introduction', 'extra_activity'}:
            facts = evidence.get((str(row['source_course_ref']), row['source_activity_id']), [])
            dates = {f['created_at_utc'] for f in facts if f.get('created_at_utc')}
            if len(dates) == 1:
                candidate['source_payload']['created_at_utc'] = next(iter(dates))
            for field in ('source_section_ref', 'source_section_title'):
                values = {fact[field] for fact in facts if fact.get(field)}
                if not candidate.get(field) and len(values) == 1:
                    candidate[field] = next(iter(values))
            candidates[row['id']] = candidate
        proposed.append(candidate)
    after = catalogue_display_context(proposed, exports)
    by_id = {row['id']: row for row in before}
    plan = []
    for row in after:
        old = by_id[row['id']]
        if row['id'] not in candidates or row['_display_schedule']['month'] == 'undated':
            continue
        # Do not write a speculative partial fix: the actual reader must resolve
        # a calendar month with the verified metadata before anything is saved.
        selected = candidates[row['id']]
        changes = {key: selected.get(key) for key in ('source_section_ref', 'source_section_title')
                   if selected.get(key) != old.get(key)}
        upload = selected['source_payload'].get('created_at_utc')
        if upload != old['source_payload'].get('created_at_utc'):
            changes['created_at_utc'] = upload
        if changes:
            plan.append({'id': row['id'], 'course_ref': str(row['source_course_ref']),
                'source_course_id': row['source_course_id'], 'activity_ref': row['source_activity_id'],
                'row_hash': old.get('_row_hash'), 'changes': changes,
                'previous': {key: old['source_payload'].get(key) if key == 'created_at_utc' else old.get(key) for key in changes},
                'schedule': row['_display_schedule']})
    return plan


def read_catalogue(conn, learner_ids):
    definitions = conn.execute('''SELECT a.id,a.source_course_id,c.source_course_ref,a.source_activity_id,
        a.source_activity_title,a.source_section_ref,a.source_section_title,a.source_position,
        jsonb_build_object('created_at',a.source_payload->'created_at',
          'created_at_utc',a.source_payload->'created_at_utc','section_title',a.source_payload->'section_title',
          'activity_id',a.source_payload->'activity_id','parent_activity_id',a.source_payload->'parent_activity_id',
          'quiz_id',a.source_payload->'quiz_id') AS source_payload,
        md5(row_to_json(a)::text) AS _row_hash,
        md5((to_jsonb(a)-'source_payload'-'source_section_ref'-'source_section_title')::text) AS _retained_hash,
        md5((a.source_payload-'created_at_utc'-'undated_schedule_recovery')::text) AS _payload_hash
        FROM curriculum.source_activities a JOIN curriculum.source_courses c ON c.id=a.source_course_id
        WHERE a.source_system='old_lms' AND a.deleted_at IS NULL AND c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM "Learner".learner_source_course_memberships m
          WHERE m.source_course_id=c.id AND m.deleted_at IS NULL AND m.learner_id=ANY(%s)) ORDER BY a.id''',
        [learner_ids]).fetchall()
    courses = list({d['source_course_ref']: {'source_course_ref': d['source_course_ref']} for d in definitions}.values())
    exports = read_export_placements(lambda sql, params: conn.execute(sql, params).fetchall(), courses)
    return definitions, exports


def ledger_signature(conn, learners):
    tables = ('learner_progress_entries', 'learner_activity_sources',
              'learner_activity_reporting_segments', 'learner_source_course_memberships')
    result = {}
    with conn.pipeline():
        queries = {table: conn.execute(f'''SELECT count(*) AS count,
            md5(string_agg(md5(row_to_json(r)::text),'' ORDER BY id)) AS fingerprint
            FROM "Learner".{table} r WHERE learner_id=ANY(%s)''', [learners]) for table in tables}
    for table, query in queries.items():
        result[table] = query.fetchone()
    return result


def verify_rows(before, after, plan):
    changes = {p['id']: p for p in plan}
    if {r['id'] for r in before} != {r['id'] for r in after}:
        raise ValueError('Catalogue identities changed.')
    old = {r['id']: r for r in before}
    for row in after:
        previous = old[row['id']]
        if row['id'] not in changes:
            if row['_row_hash'] != previous['_row_hash']:
                raise ValueError('Unselected catalogue definition changed.')
            continue
        if any(row[key] != previous[key] for key in ('_retained_hash', '_payload_hash')):
            raise ValueError('Unrelated catalogue fields or content changed.')
        for field, value in changes[row['id']]['changes'].items():
            if (row['source_payload'].get(field) if field == 'created_at_utc' else row.get(field)) != value:
                raise ValueError('Saved schedule differs from preview.')


def run(args):
    directory = Path(args.snapshot_dir)
    url, _ = r.configuration(args.env_file)
    with r.connect(url, write=args.apply) as conn:
        target = r.target_fingerprint(conn)
        if args.apply and target != args.expected_target:
            raise ValueError('Database differs from preview.')
        owners, invalid = r.read_owners(conn.cursor())
        if invalid:
            raise ValueError('Learner identities require review.')
        definitions, exports = read_catalogue(conn, list(owners))
        r.emit({'stage': 'dates_source_verification', 'database': conn.info.dbname,
                'learners': len(owners), 'catalogue_definitions': len(definitions)})
        verified, unavailable = r.verified_sources(owners, directory, target)
        if unavailable:
            raise ValueError('Fresh verified source snapshots are required for every owner.')
        evidence = schedule_evidence(verified)
        plan = make_plan(definitions, exports, evidence)
        fingerprint = r.digest({'target': target, 'definitions': definitions, 'exports': exports,
                               'plan': plan, 'evidence': sorted((str(key), value) for key, value in evidence.items())})
        result = {'target': target, 'fingerprint': fingerprint, 'learners_checked': len(owners),
                  'updates': len(plan), 'courses': len({p['course_ref'] for p in plan}),
                  'destination_months': dict(Counter(p['schedule']['month'] for p in plan))}
        if args.apply:
            if fingerprint != args.expected_fingerprint:
                raise ValueError('Source or catalogue changed since preview.')
            if plan:
                affected = conn.execute('''SELECT DISTINCT learner_id FROM "Learner".learner_source_course_memberships
                    WHERE source_course_id=ANY(%s) AND deleted_at IS NULL''',
                    [sorted({p['source_course_id'] for p in plan})]).fetchall()
                learners = [row['learner_id'] for row in affected]
                ledger = ledger_signature(conn, learners)
                r.emit({'stage': 'dates_apply', 'updates': len(plan), 'members_checked': len(learners)})
                run_id = r.insert(conn.cursor(), 'activity_sync_runs', {'run_key': VERSION + ':' + fingerprint,
                    'run_kind': VERSION, 'status': 'running', 'dry_run': False, 'result_counts': Jsonb(result)})
                with conn.pipeline():
                    writes = []
                    for change in plan:
                        values = change['changes']
                        payload = {'undated_schedule_recovery': {'run_id': run_id,
                            'basis': 'verified-original-post-metadata', 'previous': change['previous']}}
                        if 'created_at_utc' in values:
                            payload['created_at_utc'] = values['created_at_utc']
                        writes.append(conn.execute('''UPDATE curriculum.source_activities a
                            SET source_payload=source_payload||%s::jsonb,
                                source_section_ref=COALESCE(%s,source_section_ref),
                                source_section_title=COALESCE(%s,source_section_title)
                            WHERE id=%s AND source_course_id=%s AND deleted_at IS NULL
                              AND md5(row_to_json(a)::text)=%s''',
                            [Jsonb(payload),values.get('source_section_ref'),values.get('source_section_title'),
                             change['id'],change['source_course_id'],change['row_hash']]))
                if any(query.rowcount != 1 for query in writes):
                    raise ValueError('Catalogue changed during recovery.')
                after, after_exports = read_catalogue(conn, list(owners))
                verify_rows(definitions, after, plan)
                if exports != after_exports or ledger != ledger_signature(conn, learners):
                    raise ValueError('Original exports, learner completion, hours or memberships changed.')
                if make_plan(after, after_exports, evidence):
                    raise ValueError('Date recovery did not converge.')
                result.update(applied=True, audit_run=run_id, learner_ledger_unchanged=True,
                              idempotent=True, members_checked=len(learners))
                conn.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
                    updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result),run_id])
        report = {'result': result, 'plan': plan}
    # Never report a committed write until the transaction context has exited.
    Path(args.output).write_text(json.dumps(report, default=str, indent=2), encoding='utf-8')
    r.emit(result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='backend/.env')
    parser.add_argument('--snapshot-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and (not args.expected_target or not args.expected_fingerprint):
        parser.error('Apply requires the preview target and fingerprint.')
    try:
        run(args)
    except Exception as exc:
        r.emit({'error_type': type(exc).__name__, 'detail': str(exc) if isinstance(exc, ValueError) else None,
                'sqlstate': getattr(exc, 'sqlstate', None)})
        raise SystemExit(1)
