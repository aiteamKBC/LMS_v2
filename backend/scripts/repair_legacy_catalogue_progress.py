"""Fingerprint-checked legacy progress repair, preserving historical records.

Preview first. Apply reconciles one learner per transaction; shared duplicate
definitions are retired separately, only after every learner projection verifies.
Private manifests must be stored in a git-ignored directory. No Django startup,
schema changes, meeting calls, mail, or accepted-time creation.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
import json
from pathlib import Path

import reconcile_legacy_learning as r
import deduplicate_legacy_catalogue as d
from psycopg.types.json import Jsonb

VERSION = 'verified-legacy-catalogue-progress-v2'


def simulate_memberships(state, members, courses):
    result = deepcopy(state)
    for member in result['memberships']:
        if member['id'] in members['archive']:
            member['deleted_at'] = 'preview'
    for index, item in enumerate(members['add'], 1):
        result['memberships'].append({'id': -index, 'source_course_id': item['course_id'],
            'source_relationship': 'historical', 'deleted_at': None})
    return result


def simulate_completions(state, completion):
    result = deepcopy(state)
    next_source = min([s['id'] for s in result['sources']] + [0]) - 1
    for index, item in enumerate(completion['add'], 1):
        pid = item.get('existing_progress_id')
        status = 'passed' if item['activity_ref'].startswith('quiz:') else 'completed'
        if pid is None:
            pid = -index
            result['progress'].append({'id': pid, 'learner_id': state['owner']['id'],
                'entry_order': item['entry_order'], 'accepted': False, 'actual_seconds': None,
                'activity_status': status, 'deleted_at': None})
        result['sources'].append({'id': next_source, 'learner_id': state['owner']['id'],
            'source_system': 'old_lms', 'source_activity_id': item.get('source_ref', item['activity_ref']),
            'source_catalog_activity_id': item['definition_id'], 'canonical_progress_id': pid,
            'source_course_ref': item['course_ref'], 'completed': True, 'activity_status': status,
            'accepted': False, 'actual_seconds': None, 'deleted_at': None})
        next_source -= 1
    for item in completion['update']:
        source = next(s for s in result['sources'] if s['id'] == item['id'])
        source.update(source_catalog_activity_id=item['definition_id'], source_course_ref=item['course_ref'],
            completed=True, activity_status='passed' if item['activity_ref'].startswith('quiz:') else 'completed')
    return result


def plan_owner(state, verified, courses, definitions, duplicates, scope):
    lineage, simulated = d.lineage_plan(state, courses, definitions, duplicates, scope)
    members = r.membership_plan(state['owner'], verified, courses, state['memberships'])
    simulated = simulate_memberships(simulated, members, courses)
    final_defs = d.prospective_definitions(definitions, duplicates)
    completion = r.completion_plan(simulated, verified, courses, final_defs, scope, course_scoped=True)
    # A planned lineage row can itself carry newly verified completion. Merge
    # that evidence into its insert, never issue UPDATE against a preview ID.
    for update in [item for item in completion['update'] if item['id'] < 0]:
        source = next(s for s in simulated['sources'] if s['id'] == update['id'])
        link = next(s for s in lineage['links'] if s['source_activity_id'] == source['source_activity_id'])
        status = 'passed' if update['activity_ref'].startswith('quiz:') else 'completed'
        link.update(completed=True, activity_status=status, completion_evidence=update['evidence'])
        source.update(completed=True, activity_status=status)
    completion['update'] = [item for item in completion['update'] if item['id'] >= 0]
    simulated = simulate_completions(simulated, completion)
    scopes = d.catalogue_scope_plan(simulated, verified, courses, final_defs, scope)
    for update in scopes:
        next(m for m in simulated['memberships'] if m['id'] == update['id'])['verified_catalogue_scope'] = update['scope']
    items = r.projected_items(simulated, courses, final_defs, scope, owned_only=True)
    before = r.projected_items(state, courses, definitions, scope, owned_only=True)
    retained = {str(i['group_id']) for i in items}
    replacements = {(i['course_ref'], i['wrong_ref']): (i['course_ref'], i['verified_ref']) for i in duplicates}
    d.verify_preserved([i for i in before if str(i['group_id']) in retained], items, replacements)
    plan = {'lineage': lineage['links'], 'members': members, 'completion': completion,
            'scopes': scopes, 'before': d.cards(before), 'after': d.cards(items)}
    counts = {'lineage_links': len(plan['lineage']), 'completions_added': len(completion['add']),
        'completions_relinked': len(completion['update']), 'memberships_added': len(members['add']),
        'memberships_archived': len(members['archive']), 'identities_repaired': len(members['repair_identity']),
        'course_scopes': len(scopes), 'unrecorded_extras_excluded': sum(len(s['new_exclusions']) for s in scopes),
        'lineage_completions_recovered': sum('completion_evidence' in link for link in lineage['links']),
        'blocked': len(members['blocked']) + len(completion['blocked'])}
    return plan, counts


def apply_plan(cur, state, plan, run):
    from psycopg import sql
    owner = state['owner']
    r.apply_memberships(cur, owner, plan['members'], run)
    with cur.connection.pipeline():
        for link in plan['lineage']:
            evidence = {'run_id': run, 'basis': 'verified-opposite-kind-catalogue-replacement',
                        'retained_progress_id': link['canonical_progress_id']}
            if 'completion_evidence' in link:
                evidence['verified_completion'] = link['completion_evidence']
            values = {k:v for k,v in link.items() if k != 'completion_evidence'}
            values.update(sync_run_id=run, source_fingerprint=r.digest(evidence),
                          source_payload=Jsonb({'catalogue_cleanup': evidence}))
            cur.connection.execute(sql.SQL('INSERT INTO "Learner".learner_activity_sources ({}) VALUES ({})').format(
                sql.SQL(',').join(map(sql.Identifier,values)),
                sql.SQL(',').join(sql.Placeholder() for _ in values)),list(values.values()))
    r.apply_completions(cur, owner, plan['completion'], run)
    for update in plan['scopes']:
        if update['id'] < 0:
            raise ValueError('A newly created membership needs a fresh scoped preview.')
        cur.execute('''UPDATE "Learner".learner_source_course_memberships
            SET source_payload=source_payload||%s::jsonb WHERE id=%s AND learner_id=%s
            AND deleted_at IS NULL AND source_relationship='historical' ''',
            [Jsonb({'verified_catalogue_scope': {**update['scope'], 'audit_run': run}}), update['id'], owner['id']])
        if cur.rowcount != 1:
            raise ValueError('Historical membership scope changed during repair.')


def verify_written(before, after, plan, verified, courses, definitions, duplicates, scope):
    old_progress = {p['id']: p['_row_hash'] for p in before['progress']}
    old_sources = {s['id']: s for s in before['sources']}
    updated = {s['id'] for s in plan['completion']['update']}
    for key in ('progress', 'journals', 'segments', 'modules'):
        old = {p['id']: p['_row_hash'] for p in before[key]}
        new = {p['id']: p['_row_hash'] for p in after[key] if p['id'] in old}
        if old != new or (key != 'progress' and len(before[key]) != len(after[key])):
            raise ValueError('Historical records, hours, or native assignments changed.')
    for source in after['sources']:
        old = old_sources.get(source['id'])
        if old and source['id'] not in updated and source['_row_hash'] != old['_row_hash']:
            raise ValueError('An original source changed outside the plan.')
        if old and source['id'] in updated:
            allowed = {'source_course_ref', 'source_catalog_activity_id', 'completed', 'activity_status', '_row_hash'}
            if {k:v for k,v in source.items() if k not in allowed} != {k:v for k,v in old.items() if k not in allowed}:
                raise ValueError('Source ownership or hours changed.')
        if not old and (source['accepted'] or source['actual_seconds'] is not None):
            raise ValueError('An added source must not create accepted time.')
    added = [p for p in after['progress'] if p['id'] not in old_progress]
    if (len(added) != sum(i.get('existing_progress_id') is None for i in plan['completion']['add'])
            or any(p['accepted'] or p['actual_seconds'] is not None for p in added)):
        raise ValueError('Unexpected new progress or accepted time.')
    if len(after['sources']) != len(before['sources']) + len(plan['lineage']) + len(plan['completion']['add']):
        raise ValueError('Unexpected source row count.')
    allowed_members = set(plan['members']['archive']) | {i['id'] for i in plan['members']['repair_identity']} | {i['id'] for i in plan['scopes']}
    old_members = {m['id']:m for m in before['memberships']}
    for member in after['memberships']:
        old = old_members.get(member['id'])
        if old and member['id'] not in allowed_members and old['_row_hash'] != member['_row_hash']:
            raise ValueError('An unrelated membership changed.')
    pending = r.membership_plan(after['owner'], verified, courses, after['memberships'])
    if any(pending[k] for k in ('add', 'archive', 'repair_identity')):
        raise ValueError('Membership reconciliation did not verify.')
    final_defs = d.prospective_definitions(definitions, duplicates)
    actual = d.cards(r.projected_items(after, courses, final_defs, scope, owned_only=True))
    for cid, expected in plan['after'].items():
        card = actual.get(cid)
        if (card is None or card['total'] != expected['total'] or card['completed'] != expected['completed']
                or abs(card['hours']-expected['hours']) > 0.000001):
            raise ValueError('Final learner projection differs from its preview.')
    if set(actual) != set(plan['after']):
        raise ValueError('Unexpected course visibility.')
    return actual


def run(args):
    directory = Path(args.snapshot_dir)
    url,_ = r.configuration(args.env_file)
    with r.connect(url) as conn:
        target = r.target_fingerprint(conn)
        owners,invalid = r.read_owners(conn.cursor())
        courses,definitions = r.read_catalogue(conn.cursor())
    verified,unavailable = r.verified_sources(owners,directory,target)
    if invalid or unavailable:
        raise ValueError('Every linked source account must be freshly verified.')
    catalogue = r.catalogue_plan(verified,courses,definitions)
    if catalogue['courses'] or catalogue['definitions'] or catalogue['blocked']:
        raise ValueError('Restore the verified catalogue before this repair.')
    duplicates = catalogue['archive']
    scope = r.projection_scope()
    selected = {k:v for k,v in owners.items() if not args.learner_ids or k in args.learner_ids}
    selected, output_name = r.learner_partition(selected, 'catalogue-progress', args.partition, args.partitions)
    manifest = directory/'catalogue-progress-preview.json'
    expected = json.loads(manifest.read_text()) if args.apply else None
    catalogue_hash = r.digest({'courses':courses,'definitions':definitions,'duplicates':duplicates})
    if args.apply and (target != args.expected_target or expected['fingerprint'] != args.expected_fingerprint
            or expected['catalogue_hash'] != catalogue_hash):
        raise ValueError('Database/catalogue/manifest changed since preview.')
    reports, summary = {}, Counter()
    r.emit({'stage':'repair_start','mode':'apply' if args.apply else 'preview','learners':len(selected),
            'database':'neondb','target':target,'duplicate_definitions':len(duplicates)})
    def read(owner):
        with r.connect(url) as conn:
            return r.read_state(conn.cursor(),owner)
    def previews():
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures={pool.submit(read,o):ident for ident,o in selected.items()}
            for future in as_completed(futures):
                yield futures[future],future.result()
    stream = ((ident,None) for ident in selected) if args.apply else previews()
    writer = r.psycopg.connect(url,connect_timeout=10,row_factory=r.dict_row,autocommit=True) if args.apply else None
    if writer:
        writer.isolation_level=r.psycopg.IsolationLevel.REPEATABLE_READ
    try:
        for ident,prefetched in stream:
            with r.learner_transaction(writer) as conn:
                cur=conn.cursor() if conn else None
                if cur:
                    cur.execute("SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),%s)",[ident])
                    cur.execute('SELECT id FROM "Learner".learners WHERE id=%s FOR UPDATE',[ident])
                state=r.read_state(cur,owners[ident]) if cur else prefetched
                plan,counts=plan_owner(state,verified[ident],courses,definitions,duplicates,scope)
                fingerprint=r.digest({'state':state,'source':verified[ident],'plan':plan})
                actions=sum(v for k,v in counts.items() if k not in ('blocked','unrecorded_extras_excluded'))
                report={'fingerprint':fingerprint,'counts':counts,'before':plan['before'],'after':plan['after']}
                if args.apply and actions:
                    if counts['blocked'] or expected['learners'].get(str(ident),{}).get('fingerprint') != fingerprint:
                        raise ValueError('Learner evidence changed or has unresolved items; refresh preview.')
                    current_owners,_=r.read_owners(cur)
                    if current_owners.get(ident) != owners[ident]:
                        raise ValueError('Learner identity changed since preview.')
                    cur.execute('SELECT id FROM "Learner".learner_activity_sources WHERE learner_id=%s ORDER BY id FOR UPDATE',[ident])
                    cur.execute('SELECT id FROM "Learner".learner_source_course_memberships WHERE learner_id=%s ORDER BY id FOR UPDATE',[ident])
                    audit=r.insert(cur,'activity_sync_runs',{'run_key':VERSION+':'+fingerprint,
                        'run_kind':VERSION,'status':'running','dry_run':False,
                        'source_counts':Jsonb({'learner_id':ident,'source_digest':r.digest(verified[ident])}),
                        'result_counts':Jsonb(counts)})
                    apply_plan(cur,state,plan,audit)
                    after=r.read_state(cur,owners[ident])
                    report['after']=verify_written(state,after,plan,verified[ident],courses,definitions,duplicates,scope)
                    report['scope_changes']=plan['scopes']
                    report.update(audit_run=audit,applied=True,historical_records_preserved=True,added_accepted_seconds=0)
                    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
                        updated_at=now(),result_counts=%s WHERE id=%s''',[Jsonb(report),audit])
                reports[ident]=report
                summary.update(counts);summary['learners_checked']+=1;summary['learners_with_changes']+=bool(actions)
            output={'target':target,'catalogue_hash':catalogue_hash,'summary':dict(summary),'learners':reports}
            output['fingerprint']=r.digest(output)
            path=directory/(output_name+('-applied.json' if args.apply else '-preview.json'))
            path.write_text(json.dumps(output,default=str),encoding='utf8')
            if len(reports)%10==0:r.emit({'stage':'repair_progress',**summary})
    finally:
        if writer:writer.close()
    r.emit({'stage':'repair_complete','target':target,'fingerprint':output['fingerprint'],**summary})


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file',required=True)
    parser.add_argument('--snapshot-dir',required=True)
    parser.add_argument('--learner-ids',type=lambda s:{int(x) for x in s.split(',')})
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    parser.add_argument('--partitions',type=int,default=1)
    parser.add_argument('--partition',type=int,default=0)
    args=parser.parse_args()
    if args.apply and (not args.expected_target or not args.expected_fingerprint):
        parser.error('Apply needs the reviewed preview target and fingerprint.')
    if not args.apply and (args.partitions != 1 or args.partition != 0):
        parser.error('Create one complete preview before applying disjoint learner partitions.')
    try:run(args)
    except Exception as error:
        r.emit({'stage':'failed','error_type':type(error).__name__,
            'reason':str(error) if isinstance(error,ValueError) else None,
            'sqlstate':getattr(error,'sqlstate',None)})
        raise SystemExit(1)
