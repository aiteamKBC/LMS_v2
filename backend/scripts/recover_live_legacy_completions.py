"""Recover one learner's verified completions without recreating accepted hours.

Adds missing source catalogue definitions, reuses active canonical records,
preserves deleted history, and removes only explicitly selected false memberships.
Preview and apply use the same live facts and database fingerprint.
"""
import argparse
from collections import defaultdict
from copy import deepcopy
import json

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import repair_legacy_course_catalogue as catalogue
from repair_live_legacy_progress import fetch_courses, verify_identity, export_for, card
from reconcile_aptem_evidence import digest, insert, ids
from reconcile_old_lms_missing_ssot import database_url
from restore_legacy_material_progress import read_state as read_owner, source_instant

RUN_KIND = 'verified-live-completion-recovery-v1'
PUBLIC_FIELDS = ('component_id', 'title', 'post_type', 'component_kind', 'material_type',
                 'section_id', 'section_title', 'section_order', 'component_order')


def read_state(cur, aptem_id):
    state = read_owner(cur, aptem_id, 0, [])
    owner = state['owner']
    if (owner['account_id'] != owner['enrolment_id'] or not owner['email']
            or owner['email'].strip().casefold() != str(owner['account_email']).strip().casefold()
            or str(owner['aptem_id']) != str(owner['account_aptem_id'])):
        raise ValueError('Canonical enrolment identity mismatch.')
    identities = [i for i in state['identities'] if i['source_system'] == 'old_lms' and i['deleted_at'] is None]
    if len(identities) != 1:
        raise ValueError('Expected one active source identity.')
    state['identity'] = identities[0]
    state['owners'] = [owner]
    state['memberships'] = cur.execute('''SELECT * FROM "Learner".learner_source_course_memberships
        WHERE learner_id=%s ORDER BY id''', [owner['id']]).fetchall()
    state['courses'] = cur.execute('SELECT * FROM curriculum.source_courses WHERE id=ANY(%s) AND deleted_at IS NULL ORDER BY id',
        [[m['source_course_id'] for m in state['memberships'] if m['deleted_at'] is None]]).fetchall()
    state['definitions'] = cur.execute('SELECT * FROM curriculum.source_activities WHERE source_course_id=ANY(%s) ORDER BY id',
        [[c['id'] for c in state['courses']]]).fetchall()
    state['source_routes'] = cur.execute('''SELECT a.id,c.source_course_ref FROM curriculum.source_activities a
        JOIN curriculum.source_courses c ON c.id=a.source_course_id AND c.deleted_at IS NULL
        WHERE a.id=ANY(%s) AND a.deleted_at IS NULL ORDER BY a.id''',
        [[s['source_catalog_activity_id'] for s in state['sources'] if s['source_catalog_activity_id']]]).fetchall()
    state['history'] = cur.execute('''SELECT h.* FROM "Learner".learner_progress_historical_components h
        JOIN "Learner".learner_progress_entries p ON p.id=h.progress_id WHERE p.learner_id=%s
        ORDER BY h.progress_id,h.source_row_id''', [owner['id']]).fetchall()
    return state


def views(state, placements=False):
    result = {}
    for course in state['courses']:
        subset = {**state, 'course': course,
                  'definitions': [d for d in state['definitions'] if d['source_course_id'] == course['id']]}
        result[int(course['source_course_ref'])] = catalogue.projections(subset, include_placements=placements)[state['owner']['id']]
    return result


def completed_refs(projection):
    return {i['activity_id'].split(':', 2)[2] for i in projection['items'] if i['completed']}


def activity_kind(ref, fact):
    if ref.startswith('quiz:'):
        return 'quiz'
    kind = {'video': 'video', 'audio': 'audio', 'pdf': 'reading', 'text': 'reading',
            'slides': 'reading', 'assignment': 'assignment'}.get(fact.get('material_type'))
    if not kind:
        raise ValueError('Unsupported source material type.')
    return kind


def supported_catalogue_addition(fact):
    """A raw post ID alone is not proof of course membership.

    Keep completion recovery possible for verified unsectioned historical work,
    but do not import unstarted site pages or unplaced posts into the denominator.
    Existing definitions are unaffected and require their own scoped review.
    """
    return bool(fact.get('section_id')) or fact.get('completed') is True or fact.get('passed') is True


def make_plan(state, sources, course_ids, remove_memberships):
    for cid in course_ids:
        verify_identity(state, sources[cid])
    courses = {int(c['source_course_ref']): c for c in state['courses']}
    if not set(course_ids) <= courses.keys():
        raise ValueError('Selected course is not assigned to this learner.')
    before = views(state, placements=True)
    simulated = deepcopy(state)
    plan = {'definitions': [], 'sources': [], 'relinks': [], 'progress': [], 'memberships': [], 'before': before}
    next_id = -1
    definitions = {(d['source_course_id'], d['source_activity_id']): d for d in simulated['definitions'] if d['deleted_at'] is None}
    if len(definitions) != sum(d['deleted_at'] is None for d in simulated['definitions']):
        raise ValueError('Duplicate active typed catalogue definition.')
    for cid in course_ids:
        course = courses[cid]
        for ref, fact in sorted(sources[cid]['facts'].items()):
            if (course['id'], ref) in definitions:
                continue
            if not supported_catalogue_addition(fact):
                continue
            definition = dict(id=next_id, source_course_id=course['id'], source_system='old_lms',
                source_activity_id=ref, source_activity_kind=ref.partition(':')[0],
                source_activity_title=fact['title'] or '', source_activity_type=activity_kind(ref, fact),
                source_section_ref=str(fact.get('section_id') or ''), source_section_title=fact.get('section_title') or '',
                source_position=fact.get('component_order'), curriculum_component_ref=None, deleted_at=None,
                source_payload={'live_catalogue_recovery': {k: fact.get(k) for k in PUBLIC_FIELDS}})
            next_id -= 1
            plan['definitions'].append(definition)
            simulated['definitions'].append(definition)
            definitions[(course['id'], ref)] = definition
    projected = views(simulated, placements=True)
    existing = {s['source_activity_id']: s for s in simulated['sources'] if s['source_system'] == 'old_lms' and s['deleted_at'] is None}
    active_progress = {p['id']: p for p in simulated['progress'] if p['deleted_at'] is None}
    next_order = max((p['entry_order'] for p in simulated['progress']), default=0)
    source_courses = defaultdict(set)
    for cid, source in sources.items():
        for ref in source['facts']:
            source_courses[ref].add(cid)

    def add_source(ref, pid, cid, fact, *, lineage=False):
        nonlocal next_id
        if ref in existing:
            if existing[ref]['canonical_progress_id'] != pid:
                raise ValueError('A typed source belongs to another retained progress record.')
            return
        source = dict(id=next_id, learner_id=state['owner']['id'], source_system='old_lms',
            source_activity_id=ref, canonical_progress_id=pid, completed=True, deleted_at=None,
            source_course_ref=str(cid), source_catalog_activity_id=definitions[(courses[cid]['id'], ref)]['id'])
        next_id -= 1
        plan['sources'].append({'row': source, 'fact': fact, 'lineage': lineage})
        simulated['sources'].append(source)
        existing[ref] = source
        simulated['source_routes'].append({'id': source['source_catalog_activity_id'], 'source_course_ref': str(cid)})

    for cid in course_ids:
        expected = {ref for ref, fact in sources[cid]['facts'].items()
                    if fact.get('passed') is True or fact.get('completed') is True}
        for ref in sorted(expected - completed_refs(projected[cid])):
            fact = sources[cid]['facts'][ref]
            source = existing.get(ref)
            pid = source['canonical_progress_id'] if source else None
            if source:
                if pid not in active_progress or not source['completed']:
                    raise ValueError('Existing source requires separate completion/status review.')
                if source_courses[ref] != {cid}:
                    raise ValueError('A shared source component cannot be rehomed by guessing its course.')
            else:
                route = f"la:{cid}:{ref.partition(':')[2]}"
                candidates = {p['id'] for p in active_progress.values()
                    if ((p.get('source_system') == 'old_lms' and p.get('source_activity_id') == ref)
                        or p.get('component_ref') == ref
                        or (ref.startswith('material:')
                            and catalogue.metadata(p.get('source_payload')).get('original_source_ref') == route))}
                candidates.update(j['progress_id'] for j in state['journals']
                                  if ref.startswith('material:') and j['source_ref'] == route and j['progress_id'] in active_progress)
                # Reuse a retained record only inside this course; another course's
                # retired alias establishes completion but cannot duplicate its hours.
                candidates = {pid for pid in candidates if not any(
                    pid in projection['placements'] for other, projection in projected.items() if other != cid)}
                if len(candidates) == 1:
                    pid = next(iter(candidates))
                else:
                    pid = next_id
                    next_id -= 1
                    next_order += 1
                    ended = source_instant(fact['completed_at'], sources[cid]['timezone']) if fact.get('completed_at') else None
                    started = source_instant(fact['started_at'], sources[cid]['timezone']) if fact.get('started_at') else None
                    if started and ended and ended < started:
                        raise ValueError('Source completion precedes its start.')
                    p = dict(id=pid, learner_id=state['owner']['id'], entry_order=next_order, deleted_at=None,
                        source_system='old_lms', source_activity_id=ref, kind=activity_kind(ref, fact),
                        component_ref=ref, component_title=fact['title'] or '',
                        activity_status='passed' if ref.startswith('quiz:') else 'completed',
                        passed=fact.get('passed') if ref.startswith('quiz:') else None,
                        accepted=False, actual_seconds=None, started_at=started, submitted_at=ended,
                        source_payload={'live_completion_recovery': {'course_id': cid, 'component': fact,
                            'source_identity_id': state['identity']['id'], 'actual_time_review_required': True,
                            'retained_source_ids': [s['id'] for s in state['sources'] if s['source_activity_id'] == ref]}})
                    plan['progress'].append({'row': p, 'course_id': cid})
                    simulated['progress'].append(p)
                    active_progress[pid] = p
            # Explicit links override journal placement, so retain every existing
            # placement before introducing any new source route on this record.
            for other, projection in projected.items():
                for primary in projection['placements'].get(pid, []):
                    if other != cid:
                        if other not in remove_memberships:
                            raise ValueError('Rehoming would alter another assigned course.')
                        continue
                    add_source(primary, pid, cid, sources[cid]['facts'].get(primary, {}), lineage=True)
            if source:
                original = next(s for s in state['sources'] if s['id'] == source['id'])
                replacement = definitions[(courses[cid]['id'], ref)]['id']
                plan['relinks'].append({'source_id': source['id'], 'course_id': cid, 'catalogue_id': replacement,
                    'previous_course_ref': original['source_course_ref'],
                    'previous_catalogue_id': original['source_catalog_activity_id'], 'fact': fact})
                source.update(source_course_ref=str(cid), source_catalog_activity_id=replacement)
                simulated['source_routes'].append({'id': replacement, 'source_course_ref': str(cid)})
            else:
                add_source(ref, pid, cid, fact)
    for cid in remove_memberships:
        if cid in sources:
            raise ValueError('Cannot remove a verified source enrolment.')
        course = courses.get(cid)
        if not course:
            continue
        active_ids = {d['id'] for d in simulated['definitions'] if d['source_course_id'] == course['id'] and d['deleted_at'] is None}
        if any(s['deleted_at'] is None and s['source_catalog_activity_id'] in active_ids for s in simulated['sources']):
            raise ValueError('False membership still has unresolved active source records.')
        matches = [m for m in simulated['memberships'] if m['source_course_id'] == course['id'] and m['deleted_at'] is None]
        if len(matches) != 1:
            raise ValueError('Membership is ambiguous.')
        plan['memberships'].append(matches[0]['id'])
        simulated['courses'] = [c for c in simulated['courses'] if c['id'] != course['id']]
    plan['after'] = views(simulated)
    for cid, projection in before.items():
        if cid in remove_memberships:
            continue
        expected = completed_refs(projection)
        if cid in course_ids:
            expected |= {r for r, f in sources[cid]['facts'].items() if f.get('completed') is True or f.get('passed') is True}
        if completed_refs(plan['after'][cid]) != expected:
            raise ValueError('Simulation changed completion outside verified source facts.')
    return plan


def summary(plan):
    return {'catalogue_definitions_to_add': len(plan['definitions']), 'sources_to_relink': len(plan['relinks']),
            'completion_links_to_add': len(plan['sources']), 'completion_records_to_add': len(plan['progress']),
            'false_memberships_to_archive': len(plan['memberships']), 'added_accepted_seconds': 0,
            'before': {cid: card(p) for cid, p in plan['before'].items()},
            'after': {cid: card(p) for cid, p in plan['after'].items()}}


def insert_catalogue(cur, table, values):
    from psycopg import sql
    return cur.execute(sql.SQL('INSERT INTO curriculum.{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, values)),
        sql.SQL(',').join(sql.Placeholder() for _ in values)), list(values.values())).fetchone()['id']


def apply_plan(cur, state, plan, fingerprint):
    owner = state['owner']
    run = insert(cur, 'activity_sync_runs', {'run_key': RUN_KIND + ':' + fingerprint, 'run_kind': RUN_KIND,
        'status': 'running', 'dry_run': False, 'source_counts': Jsonb({'source_identity_id': state['identity']['id']}),
        'result_counts': Jsonb(summary(plan))})
    catalogue_ids, progress_ids = {}, {}
    courses = {int(c['source_course_ref']): c for c in state['courses']}
    for definition in plan['definitions']:
        values = {k: v for k, v in definition.items() if k not in ('id', 'deleted_at')}
        values['source_payload'] = Jsonb({**values['source_payload'], 'recovery_run_id': run})
        values['mapping_method'] = 'verified-live-source-course'
        if definition['source_activity_kind'] == 'material':
            material_id = int(definition['source_activity_id'].partition(':')[2])
            if cur.execute('SELECT material_id FROM curriculum.source_materials WHERE material_id=%s', [material_id]).fetchone():
                values['source_material_id'] = material_id
        catalogue_ids[definition['id']] = insert_catalogue(cur, 'source_activities', values)
    scope = {k: owner[k] for k in ('enrolment_id', 'programme_id', 'aptem_id')}
    for item in plan['progress']:
        p, course = item['row'], courses[item['course_id']]
        values = {k: v for k, v in p.items() if k not in ('id', 'deleted_at')}
        values.update(scope, component_type=p['kind'], module_ref=course['curriculum_module_ref'],
            module_title=course['source_course_title'], actual_basis='live-source:completion-confirmed-time-unverified',
            canonical_activity_key=f"old_lms:{owner['id']}:{item['course_id']}:{p['source_activity_id']}:recovery",
            source_payload=Jsonb({**p['source_payload'], 'recovery_run_id': run}), sync_run_id=run)
        progress_ids[p['id']] = insert(cur, 'learner_progress_entries', values)
    originals = {p['id']: p for p in state['progress']}
    new_progress = {p['row']['id']: p['row'] for p in plan['progress']}
    for item in plan['sources']:
        s = item['row']
        p = originals.get(s['canonical_progress_id']) or new_progress[s['canonical_progress_id']]
        payload = {'live_completion_recovery': {'run_id': run, 'component': item['fact'],
            'source_identity_id': state['identity']['id'], 'lineage_only': item['lineage'], 'actual_time_review_required': True}}
        insert(cur, 'learner_activity_sources', {**scope,
            **{k: v for k, v in s.items() if k not in ('id', 'deleted_at')},
            'canonical_progress_id': progress_ids.get(s['canonical_progress_id'], s['canonical_progress_id']),
            'source_catalog_activity_id': catalogue_ids.get(s['source_catalog_activity_id'], s['source_catalog_activity_id']),
            'canonical_activity_key': p.get('canonical_activity_key') or f"recovered:{run}:{s['source_activity_id']}",
            'activity_type': p['kind'], 'title': item['fact'].get('title') or p.get('component_title') or '',
            'activity_status': 'passed' if s['source_activity_id'].startswith('quiz:') else 'completed',
            'accepted': False, 'actual_seconds': None, 'actual_basis': 'completion-lineage-only',
            'source_payload': Jsonb(payload), 'source_fingerprint': digest(payload), 'sync_run_id': run})
    for relink in plan['relinks']:
        evidence = {'run_id': run, 'previous_course_ref': relink['previous_course_ref'],
                    'previous_catalogue_id': relink['previous_catalogue_id'], 'verified_component': relink['fact']}
        cur.execute('''UPDATE "Learner".learner_activity_sources SET source_course_ref=%s,
            source_catalog_activity_id=%s,source_payload=source_payload||%s::jsonb
            WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''',
            [str(relink['course_id']), catalogue_ids.get(relink['catalogue_id'], relink['catalogue_id']),
             Jsonb({'verified_course_relink': evidence}), relink['source_id'], owner['id']])
        if cur.rowcount != 1:
            raise ValueError('Source changed during recovery.')
    for membership_id in plan['memberships']:
        cur.execute('''UPDATE "Learner".learner_source_course_memberships SET deleted_at=now(),
            source_payload=source_payload||%s::jsonb WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''',
            [Jsonb({'verified_membership_repair': {'run_id': run, 'reason': 'misrouted-source-activities'}}), membership_id, owner['id']])
        if cur.rowcount != 1:
            raise ValueError('Membership changed during recovery.')
    return run, catalogue_ids


def verify(before, after, plan):
    for key in ('progress', 'journals', 'segments', 'identities', 'history'):
        original = {r.get('id', (r.get('progress_id'), r.get('source_row_id'))): r for r in before[key]}
        retained = {r.get('id', (r.get('progress_id'), r.get('source_row_id'))): r for r in after[key]
                    if r.get('id', (r.get('progress_id'), r.get('source_row_id'))) in original}
        if original != retained:
            raise ValueError(f'Historical {key} changed.')
    relink_ids = {r['source_id'] for r in plan['relinks']}
    old = {s['id']: s for s in before['sources']}
    for s in after['sources']:
        if s['id'] not in old:
            continue
        if s['id'] in relink_ids:
            allowed = {'source_course_ref', 'source_catalog_activity_id', 'source_payload'}
            if {k: v for k, v in s.items() if k not in allowed} != {k: v for k, v in old[s['id']].items() if k not in allowed}:
                raise ValueError('Source evidence changed beyond routing.')
        elif s != old[s['id']]:
            raise ValueError('Unrelated source changed.')
    if len(after['progress']) != len(before['progress']) + len(plan['progress']):
        raise ValueError('Unexpected progress count.')
    if len(after['sources']) != len(before['sources']) + len(plan['sources']):
        raise ValueError('Unexpected source count.')
    old_memberships = {m['id']: m for m in before['memberships']}
    if set(old_memberships) != {m['id'] for m in after['memberships']}:
        raise ValueError('Membership history was not retained.')
    for membership in after['memberships']:
        prior = old_memberships[membership['id']]
        if membership['id'] in plan['memberships']:
            if membership['deleted_at'] is None:
                raise ValueError('False membership was not archived.')
            retained = {k: v for k, v in membership.items() if k not in ('source_payload', 'deleted_at')}
            if retained != {k: v for k, v in prior.items() if k not in ('source_payload', 'deleted_at')}:
                raise ValueError('Membership changed beyond the scoped archive.')
        elif membership != prior:
            raise ValueError('Unrelated membership changed.')
    if catalogue.hours(before) != catalogue.hours(after):
        raise ValueError('Accepted time changed.')
    actual = views(after)
    if set(actual) != set(plan['after']):
        raise ValueError('Unexpected course membership change.')
    for cid, expected in plan['after'].items():
        if (completed_refs(actual[cid]) != completed_refs(expected)
                or card(actual[cid]) != card(expected)):
            raise ValueError('Actual progress differs from preview.')
    return actual


def run(args, sources):
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE if args.apply else psycopg.IsolationLevel.REPEATABLE_READ
        cur = conn.cursor()
        cur.execute("SET LOCAL statement_timeout='60s'")
        cur.execute("SET LOCAL lock_timeout='5s'")
        target = digest({'database': conn.info.dbname, 'host': conn.info.host})
        if args.apply and args.expected_target != target:
            raise ValueError('Database target differs from preview.')
        state = read_state(cur, args.aptem_id)
        plan = make_plan(state, sources, args.course_ids, args.remove_memberships)
        fingerprint = digest({'state': state, 'facts': {cid: sources[cid]['facts'] for cid in args.course_ids}})
        output = {'database': conn.info.dbname, 'target': target, 'fingerprint': fingerprint, **summary(plan)}
        if args.apply:
            if fingerprint != args.expected_fingerprint:
                raise ValueError('State changed since preview.')
            course_ids = [c['id'] for c in state['courses'] if int(c['source_course_ref']) in args.course_ids]
            cur.execute('SELECT id FROM curriculum.source_courses WHERE id=ANY(%s) ORDER BY id FOR UPDATE', [course_ids])
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),%s)", [state['owner']['id']])
            cur.execute('SELECT id FROM "Learner".learners WHERE id=%s FOR UPDATE', [state['owner']['id']])
            # Shared catalogue additions must not lose any other member's existing
            # completion or mutate their progress, evidence, source links or hours.
            shared = {cid: catalogue.read_state(cur, cid, args.aptem_id, catalogue_only=True,
                verified_export=export_for(sources[cid])) for cid in args.course_ids}
            shared_views = {cid: catalogue.projections(s, include_placements=False) for cid, s in shared.items()}
            audit_run, added = apply_plan(cur, state, plan, fingerprint)
            after = read_state(cur, args.aptem_id)
            actual = verify(state, after, plan)
            checked = 0
            for cid, original in shared.items():
                final = catalogue.read_state(cur, cid, args.aptem_id, catalogue_only=True, verified_export=export_for(sources[cid]))
                for key in ('progress', 'sources', 'segments', 'journals', 'identities'):
                    def others(rows):
                        return {r['id']: r for r in rows if r.get('learner_id', r.get('canonical_learner_id')) != state['owner']['id']}
                    # New catalogue definitions may expose existing records that
                    # the original course-scoped reader did not need to load.
                    old_rows, new_rows = others(original[key]), others(final[key])
                    if any(new_rows.get(rid) != row for rid, row in old_rows.items()):
                        raise ValueError('Another learner\'s evidence changed.')
                if original['accepted_totals'] != final['accepted_totals']:
                    raise ValueError('A learner\'s accepted totals changed.')
                projected = catalogue.projections(final, include_placements=False)
                for owner_id, prior in shared_views[cid].items():
                    if owner_id == state['owner']['id']:
                        continue
                    if not completed_refs(prior) <= completed_refs(projected[owner_id]):
                        raise ValueError('Another learner lost a completion.')
                    checked += 1
            pending = make_plan(after, sources, args.course_ids, args.remove_memberships)
            if any(pending[key] for key in ('definitions', 'sources', 'relinks', 'progress', 'memberships')):
                raise ValueError('Recovery is not idempotent.')
            output.update(applied=True, audit_run=audit_run, historical_records_preserved=True,
                          accepted_seconds_preserved=True, other_memberships_checked=checked, idempotent=True)
            cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
                updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(output), audit_run])
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--source-user-id', type=int, required=True)
    parser.add_argument('--course-ids', type=ids, required=True)
    parser.add_argument('--remove-memberships', type=ids, default=[])
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and (not args.expected_target or not args.expected_fingerprint):
        parser.error('Apply requires preview target and fingerprint.')
    try:
        print(json.dumps(run(args, fetch_courses(args.source_user_id)), default=str))
    except Exception as exc:
        print(json.dumps({'error_type': type(exc).__name__, 'detail': str(exc) if isinstance(exc, ValueError) else None,
                          'sqlstate': getattr(exc, 'sqlstate', None), 'http_status': getattr(exc, 'code', None)}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
