"""Preview/apply one exported course's typed catalogue and selected completions.

Uses retained MBA snapshots only; no HTTP, Django startup, or schema changes.
Archives catalogue rows, adds explicit lineage to existing progress, and leaves
historical progress/hours intact. Apply requires the preview's target/fingerprint.
"""
import argparse
from collections import defaultdict
from datetime import datetime
import json
import re
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from reconcile_aptem_evidence import digest, ids, insert
from reconcile_old_lms_missing_ssot import database_url

ROOT = Path(__file__).resolve().parents[1]
RUN_KIND = 'retained-course-catalogue-repair-v1'


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def metadata(value):
    value = decoded(value)
    return value if isinstance(value, dict) else {}


def typed_ref(item):
    kind = item.get('component_kind')
    post_type = item.get('post_type')
    if kind not in ('lesson', 'quiz') or post_type != {
            'lesson': 'stm-lessons', 'quiz': 'stm-quizzes'}[kind]:
        raise ValueError('Export has an unverified component kind.')
    ident = str(item.get('source_component_id') or '')
    if not ident.isdigit() or int(ident) <= 0:
        raise ValueError('Export needs an explicit source component ID.')
    return ('material:' if kind == 'lesson' else 'quiz:') + ident


def catalogue_plan(definitions, export, removals, *, preserve_unmatched=False, preserve_refs=()):
    expected = {}
    for section in export['sections']:
        for item in section.get('materials', []):
            try:
                ref = typed_ref(item)
            except ValueError:
                if preserve_unmatched:
                    continue
                raise
            if ref in expected:
                raise ValueError('Export contains duplicate typed components.')
            expected[ref] = item
    if not expected or set(removals) & set(expected):
        raise ValueError('Removal conflicts with the retained curriculum.')
    live = [d for d in definitions if d['deleted_at'] is None]
    by_ref = {d['source_activity_id']: d for d in live}
    if len(by_ref) != len(live) or (not preserve_unmatched and not set(expected) <= set(by_ref)):
        raise ValueError('Owned catalogue is ambiguous or missing exported items.')
    if preserve_unmatched:
        # A partial/older export cannot authorize deleting later content or
        # creating missing components. Only collapse proven, present pairs.
        expected = {ref: item for ref, item in expected.items() if ref in by_ref}
        verified_refs = set(expected)
        for ref, definition in by_ref.items():
            other = ('quiz:' if ref.startswith('material:') else 'material:') + ref.partition(':')[2]
            if (ref in preserve_refs or definition.get('curriculum_component_ref')
                    or other not in verified_refs):
                expected.setdefault(ref, definition)
    archive, replacements = [], {}
    for ref, definition in by_ref.items():
        if ref in expected:
            continue
        other = ('quiz:' if ref.startswith('material:') else 'material:') + ref.partition(':')[2]
        if ref not in removals and other not in expected:
            raise ValueError('Unrecognised extra activity needs an explicit decision.')
        if definition.get('curriculum_component_ref'):
            raise ValueError('An extra activity has a native component; review its callers.')
        archive.append(definition['id'])
        if ref not in removals:
            replacements[ref] = other
    return expected, sorted(archive), replacements


def read_state(cur, course_id, aptem_id, *, catalogue_only=False, verified_export=None):
    courses = cur.execute('''SELECT * FROM curriculum.source_courses
        WHERE source_system='old_lms' AND source_course_ref=%s AND deleted_at IS NULL''',
        [str(course_id)]).fetchall()
    if len(courses) != 1:
        raise ValueError('Expected one source course.')
    course = courses[0]
    memberships = cur.execute('''SELECT * FROM "Learner".learner_source_course_memberships
        WHERE source_course_id=%s AND deleted_at IS NULL ORDER BY id''', [course['id']]).fetchall()
    learner_ids = sorted({m['learner_id'] for m in memberships})
    owners = cur.execute('''SELECT l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.email,
        e."Email" AS account_email,e.aptem_id AS account_aptem_id,e.id AS account_id
        FROM "Learner".learners l LEFT JOIN enrolment."Created_users" e ON e.id=l.enrolment_id
        WHERE l.id=ANY(%s) ORDER BY l.id''', [learner_ids]).fetchall()
    targets = [o for o in owners if o['aptem_id'] == aptem_id]
    if len(targets) != 1:
        raise ValueError('Selected learner must belong to the course.')
    owner = targets[0]
    if (owner['account_id'] != owner['enrolment_id'] or not owner['email']
            or owner['email'].strip().casefold() != str(owner['account_email']).strip().casefold()
            or str(owner['account_aptem_id']) != str(owner['aptem_id'])):
        raise ValueError('Selected enrolment identity is not verified.')
    export = verified_export or cur.execute('SELECT * FROM "MBA".course_curriculum WHERE course_id=%s', [course_id]).fetchone()
    if not export:
        raise ValueError('No retained curriculum export.')
    state = dict(course=course, memberships=memberships, owners=owners, owner=owner, export=export)
    state['definitions'] = cur.execute('SELECT * FROM curriculum.source_activities WHERE source_course_id=%s ORDER BY id', [course['id']]).fetchall()
    progress_ids = None
    if catalogue_only:
        # Keep every record that can project into this course, including retired
        # journal aliases. Load its other sources too, so foreign routes remain
        # authoritative. Avoid loading every member's entire evidence history.
        progress_ids = [r['id'] for r in cur.execute('''SELECT p.id
            FROM "Learner".learner_progress_entries p WHERE p.learner_id=ANY(%s)
            AND (p.source_payload->>'original_source_ref' LIKE %s
                OR EXISTS (SELECT 1 FROM "Learner".learner_activity_sources s
                    JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id
                    WHERE s.canonical_progress_id=p.id AND s.learner_id=p.learner_id AND a.source_course_id=%s)
                OR EXISTS (SELECT 1 FROM "Learner".learner_journal_rows j
                    WHERE j.progress_id=p.id AND j.canonical_learner_id=p.learner_id
                        AND j.source_ref LIKE %s)) ORDER BY p.id''',
            [learner_ids, f'la:{course_id}:%', course['id'], f'la:{course_id}:%']).fetchall()]
        state['accepted_totals'] = cur.execute('''SELECT learner_id,sum(coalesce(actual_seconds,0)) AS seconds
            FROM "Learner".learner_progress_entries WHERE learner_id=ANY(%s)
            AND deleted_at IS NULL AND accepted=true GROUP BY learner_id ORDER BY learner_id''', [learner_ids]).fetchall()
    for key, table in [('progress', 'learner_progress_entries'), ('sources', 'learner_activity_sources'),
                       ('segments', 'learner_activity_reporting_segments'), ('identities', 'learner_external_identities')]:
        condition, params = 'learner_id=ANY(%s)', [learner_ids]
        if progress_ids is not None and key in ('progress', 'segments'):
            condition += ' AND ' + ('id' if key == 'progress' else 'progress_id') + '=ANY(%s)'
            params.append(progress_ids)
        elif progress_ids is not None and key == 'sources':
            condition += ' AND (canonical_progress_id=ANY(%s) OR (source_system=\'old_lms\' AND source_activity_id=ANY(%s)))'
            params.extend([progress_ids, [d['source_activity_id'] for d in state['definitions']]])
        state[key] = cur.execute(f'SELECT * FROM "Learner".{table} WHERE {condition} ORDER BY id', params).fetchall()
    condition, params = 'canonical_learner_id=ANY(%s)', [learner_ids]
    if progress_ids is not None:
        condition += ' AND (progress_id=ANY(%s) OR source_ref LIKE %s)'
        params.extend([progress_ids, f'la:{course_id}:%'])
    state['journals'] = cur.execute(f'SELECT * FROM "Learner".learner_journal_rows WHERE {condition} ORDER BY id', params).fetchall()
    state['source_routes'] = cur.execute('''SELECT a.id,c.source_course_ref
        FROM curriculum.source_activities a
        JOIN curriculum.source_courses c ON c.id=a.source_course_id AND c.deleted_at IS NULL
        WHERE a.id=ANY(%s) AND a.deleted_at IS NULL ORDER BY a.id''',
        [sorted({s['source_catalog_activity_id'] for s in state['sources'] if s['source_catalog_activity_id'] is not None})]).fetchall()
    identities = [i for i in state['identities'] if i['learner_id'] == owner['id']
                  and i['source_system'] == 'old_lms' and i['deleted_at'] is None]
    if len(identities) != 1:
        raise ValueError('Selected learner needs one verified source identity.')
    identity = identities[0]
    state['identity'] = identity
    if verified_export and (not catalogue_only
            or str(verified_export['source_user_id']) != str(identity['source_learner_id'])
            or verified_export['course_id'] != course_id):
        raise ValueError('Live curriculum must match the selected source account/course.')
    state['snapshot'] = cur.execute('''SELECT p.*,s.email AS source_email
        FROM "MBA".student_progress p JOIN "MBA".students s ON s.user_id=p.user_id
        WHERE p.user_id=%s AND p.course_id=%s''', [int(identity['source_learner_id']), course_id]).fetchone()
    email = metadata(identity['source_payload']).get('source_email') or metadata(identity['source_payload']).get('learner_email')
    if ((not state['snapshot'] and not catalogue_only) or not email or
            (state['snapshot'] and state['snapshot']['source_email'].strip().casefold() != email.strip().casefold())):
        raise ValueError('Retained source identity does not match.')
    return state


def projections(state, *, include_placements=True):
    # Run the existing pure catalogue reader through its established no-startup
    # adapter. Hydrate its source/journal/segment inputs without a Django server.
    sys.path.insert(0, str(ROOT))
    from learner_api.test_canonical_learning_no_db import adapter
    scope = adapter(None)
    definitions = {d['id']: d for d in state['definitions'] if d['deleted_at'] is None}
    course = state['course']
    catalogue = [{**d, 'source_course_ref': course['source_course_ref'],
                  'source_course_title': course['source_course_title'],
                  'curriculum_module_ref': course['curriculum_module_ref'],
                  'position': d['source_position']} for d in definitions.values()]
    sources, journals, segments = defaultdict(list), defaultdict(list), defaultdict(list)
    routes = {r['id']: r['source_course_ref'] for r in state['source_routes']}
    active_sources = {}
    for source in state['sources']:
        if source['deleted_at'] is not None:
            continue
        active_sources[source['id']] = source
        # Keep an existing explicit route to another course authoritative too.
        sources[source['canonical_progress_id']].append({**source,
            'source_course_ref': routes.get(source['source_catalog_activity_id'])})
    progress = {p['id']: p for p in state['progress'] if p['deleted_at'] is None}
    for j in state['journals']:
        source, record = active_sources.get(j['source_id']), progress.get(j['progress_id'])
        if (j['deleted_at'] is None and source and record
                and j['canonical_learner_id'] == record['learner_id'] == source['learner_id']
                and source['canonical_progress_id'] == record['id']):
            journals[record['id']].append(j)
    for segment in state['segments']:
        if segment['progress_id'] in progress and segment['learner_id'] == progress[segment['progress_id']]['learner_id']:
            segments[segment['progress_id']].append(segment)
    by_owner = defaultdict(list)
    for p in progress.values():
        owned_sources = [s for s in sources[p['id']] if s['learner_id'] == p['learner_id']]
        by_owner[p['learner_id']].append({**p, 'sources': owned_sources, 'journal_routes': journals[p['id']],
            'segments': segments[p['id']], 'ksbs': [], 'completed': scope['counts_as_completed']({**p, 'sources': owned_sources})})
    result = {}
    for owner in state['owners']:
        items, subjects, _ = scope['recorded_course_items']([course], catalogue, by_owner[owner['id']], include_catalogue=True)
        placements = {}
        for record in (by_owner[owner['id']] if include_placements else []):
            ref = str(course['source_course_ref'])
            if not (any(str(s.get('source_course_ref')) == ref for s in record['sources'])
                    or any(str(j.get('group_id')) == ref for j in record['journal_routes'])
                    or str(metadata(record['source_payload']).get('original_source_ref', '')).startswith(f'la:{ref}:')):
                continue
            single, _, _ = scope['recorded_course_items']([course], catalogue, [record], include_catalogue=True)
            placed = [i['activity_id'].split(':', 2)[2] for i in single if i['has_result']]
            if placed:
                placements[record['id']] = placed
        result[owner['id']] = dict(items=items, accepted_hours=subjects[0]['accepted_hours'], placements=placements)
    return result


def plan_repair(state, removals, restore_ids, *, catalogue_only=False):
    export = decoded(state['export']['curriculum'])
    expected, archive, replacements = catalogue_plan(state['definitions'], export, removals,
        preserve_unmatched=catalogue_only)
    definitions = {d['source_activity_id']: d for d in state['definitions'] if d['deleted_at'] is None}
    progress = {p['id']: p for p in state['progress']}
    existing = {(s['learner_id'], s['source_system'], s['source_activity_id']): s
                for s in state['sources'] if s['deleted_at'] is None}
    before = projections(state)
    if catalogue_only:
        if removals or restore_ids:
            raise ValueError('Catalogue-only mode cannot remove unmatched content or restore completions.')
        # Global legacy source keys sometimes belong to another course or a
        # different retained record. Preserve that pair pending reconciliation.
        preserve_refs, claims = set(), defaultdict(set)
        for learner_id, projection in before.items():
            for pid, refs in projection['placements'].items():
                if not any(ref in replacements for ref in refs):
                    continue
                for ref in refs:
                    target = replacements.get(ref, ref)
                    linked = existing.get((learner_id, 'old_lms', target))
                    claims[(learner_id, target)].add(pid)
                    if linked and (linked['canonical_progress_id'] != pid
                            or linked['source_catalog_activity_id'] != definitions[target]['id']):
                        preserve_refs.update(r for r in refs if r in replacements)
        for learner_id, projection in before.items():
            for pid, refs in projection['placements'].items():
                if any(len(claims[(learner_id, replacements.get(ref, ref))]) > 1 for ref in refs):
                    preserve_refs.update(r for r in refs if r in replacements)
        expected, archive, replacements = catalogue_plan(state['definitions'], export, [],
            preserve_unmatched=True, preserve_refs=preserve_refs)
    links = []
    for learner_id, projection in before.items():
        for pid, refs in projection['placements'].items():
            if not any(ref in replacements for ref in refs):
                continue
            for ref in refs:
                target = replacements.get(ref, ref)
                if target not in expected:
                    continue
                linked = existing.get((learner_id, 'old_lms', target))
                if linked and linked['canonical_progress_id'] != pid:
                    raise ValueError('Typed destination already has a source; do not duplicate it.')
                if not linked:
                    links.append({'progress_id': pid, 'learner_id': learner_id,
                                  'old_ref': ref, 'new_ref': target, 'catalogue_id': definitions[target]['id']})
    if len({(x['learner_id'], x['new_ref']) for x in links}) != len(links):
        raise ValueError('More than one record claims a typed destination.')
    owner = state['owner']
    snapshot = {typed_ref(c): c for c in decoded(state['snapshot']['component_progress'])} if restore_ids else {}
    restores = []
    for ident in restore_ids:
        ref = f'material:{ident}'
        if ref not in expected or ref not in snapshot:
            raise ValueError('Selected restoration is absent from an owned snapshot.')
        old = existing.get((owner['id'], 'old_lms', ref))
        if old:
            p = progress.get(old['canonical_progress_id'])
            if old['completed'] and p and p['deleted_at'] is None and old['source_catalog_activity_id'] == definitions[ref]['id']:
                continue
            raise ValueError('Existing material completion needs separate reconciliation.')
        route = f"la:{state['course']['source_course_ref']}:{ident}"
        if any(p['learner_id'] == owner['id'] and (
                metadata(p['source_payload']).get('original_source_ref') == route or p['component_ref'] in (ref, route)) for p in state['progress']):
            raise ValueError('Historical progress already covers the selected material.')
        journals = [j for j in state['journals']
                    if j['canonical_learner_id'] == owner['id'] and j['source_ref'] == route]
        retained_progress = None
        retained_history_id = None
        if journals:
            # A retired journal alias can point to a retained merged record.
            # Reuse that record; keep its primary placement and counted hours.
            candidates = {j['progress_id'] for j in journals}
            if len(candidates) != 1:
                raise ValueError('Historical journal has ambiguous progress links.')
            retained_progress = progress.get(next(iter(candidates)))
            by_source = {s['id']: s for s in state['sources']}
            if (not retained_progress or retained_progress['deleted_at'] is not None
                    or retained_progress['learner_id'] != owner['id']):
                raise ValueError('Historical journal progress is unavailable.')
            for journal in journals:
                source = by_source.get(journal['source_id'])
                if (not source or source['deleted_at'] is not None or source['learner_id'] != owner['id']
                        or source['canonical_progress_id'] != retained_progress['id']):
                    raise ValueError('Historical journal source ownership is invalid.')
            primary = before[owner['id']]['placements'].get(retained_progress['id'], [])
            if not primary:
                historical_route = re.fullmatch(r'la:(\d+):(\d+)',
                    str(metadata(retained_progress['source_payload']).get('original_source_ref') or ''))
                if not historical_route or historical_route[1] == str(state['course']['source_course_ref']):
                    raise ValueError('Merged progress has no current course placement.')
                # A retired alias merged into another course cannot carry this
                # course's completion without also allocating its accepted hours.
                # Retain that history and recover only the evidenced completion.
                retained_history_id = retained_progress['id']
                retained_progress = None
            for prior in primary:
                target = replacements.get(prior, prior)
                if target not in expected:
                    raise ValueError('Merged primary placement would be removed.')
                linked = existing.get((owner['id'], 'old_lms', target))
                if linked and linked['canonical_progress_id'] != retained_progress['id']:
                    raise ValueError('Merged primary placement conflicts with another source.')
                if not linked and not any(x['progress_id'] == retained_progress['id'] and x['new_ref'] == target for x in links):
                    links.append({'progress_id': retained_progress['id'], 'learner_id': owner['id'],
                                  'old_ref': prior, 'new_ref': target, 'catalogue_id': definitions[target]['id']})
        component = snapshot[ref]
        saved = component['progress']
        if saved.get('completed') is not True:
            raise ValueError('Snapshot does not confirm completion.')
        start = datetime.fromisoformat(saved['started_at_utc'].replace('Z', '+00:00'))
        end = datetime.fromisoformat(saved['completed_at_utc'].replace('Z', '+00:00'))
        if not start.tzinfo or not end.tzinfo or end < start:
            raise ValueError('Completion needs valid UTC timestamps.')
        if component.get('material_type') not in ('pdf', 'text', 'slides'):
            raise ValueError('This recovery supports completed readings only.')
        restores.append(dict(ref=ref, definition=definitions[ref], component=component, start=start, end=end,
                             progress_id=retained_progress['id'] if retained_progress else None,
                             retained_history_id=retained_history_id))
    return dict(archive=archive, replacements=replacements, links=links, restores=restores,
                expected=expected, before=before)


def hours(state):
    totals = defaultdict(int)
    for p in state['progress']:
        if p['deleted_at'] is None and p['accepted']:
            totals[p['learner_id']] += p['actual_seconds'] or 0
    return dict(totals)


def apply_plan(cur, state, plan, fingerprint):
    run = insert(cur, 'activity_sync_runs', dict(run_key=RUN_KIND + ':' + fingerprint,
        run_kind=RUN_KIND, status='running', dry_run=False,
        source_counts=Jsonb({'course_id': state['course']['source_course_ref'],
                            'export_fingerprint': digest(state['export']), 'archived_catalogue_ids': plan['archive']}),
        result_counts=Jsonb({})))
    by_progress = {p['id']: p for p in state['progress']}
    for link in plan['links']:
        p = by_progress[link['progress_id']]
        payload = {'catalogue_repair': {'run_id': run, 'previous_catalogue_ref': link['old_ref'],
                   'original_source_ref': metadata(p['source_payload']).get('original_source_ref'),
                   'basis': 'retained-course-export-typed-component', 'progress_id': p['id']}}
        insert(cur, 'learner_activity_sources', dict(learner_id=p['learner_id'], enrolment_id=p['enrolment_id'],
            programme_id=p['programme_id'], aptem_id=p['aptem_id'], source_system='old_lms',
            source_activity_id=link['new_ref'], canonical_activity_key=p['canonical_activity_key'],
            activity_type='quiz' if link['new_ref'].startswith('quiz:') else 'reading',
            title=p['component_title'], activity_status=p['activity_status'],
            completed=p['accepted'] or str(p['activity_status']).lower() in {'complete', 'completed', 'passed', 'accepted'},
            accepted=False, actual_seconds=None, actual_basis='catalogue-lineage-only',
            source_payload=Jsonb(payload), source_fingerprint=digest(payload), sync_run_id=run,
            canonical_progress_id=p['id'], source_course_ref=state['course']['source_course_ref'],
            source_catalog_activity_id=link['catalogue_id']))
    owner = state['owner']
    next_order = max((p['entry_order'] for p in state['progress'] if p['learner_id'] == owner['id']), default=0)
    for item in plan['restores']:
        next_order += 1
        route = f"la:{state['course']['source_course_ref']}:{item['ref'].partition(':')[2]}"
        payload = {'original_source_ref': route, 'retained_completion_recovery': {
            'source_table': 'MBA.student_progress', 'source_identity_id': state['identity']['id'],
            'snapshot_synced_at': str(state['snapshot']['synced_at']), 'component': item['component'],
            'retained_history_progress_id': item.get('retained_history_id'),
            'actual_time_review_required': True,
            'timing_note': 'Calendar elapsed time is not verified study time.'}}
        common = dict(learner_id=owner['id'], enrolment_id=owner['enrolment_id'],
            programme_id=owner['programme_id'], aptem_id=owner['aptem_id'], source_system='old_lms',
            source_activity_id=item['ref'], canonical_activity_key=f"old_lms:{owner['id']}:{state['course']['source_course_ref']}:{item['ref']}",
            activity_status='completed', accepted=False, actual_seconds=None,
            actual_basis='retained-snapshot:completion-confirmed-time-unverified',
            reporting_started_at=item['end'], reporting_ended_at=item['end'],
            reporting_month=item['end'].astimezone(ZoneInfo('Europe/London')).strftime('%Y-%m'),
            source_payload=Jsonb(payload), sync_run_id=run)
        pid = item['progress_id']
        if pid is None:
            pid = insert(cur, 'learner_progress_entries', {**common, 'entry_order': next_order,
                'kind': 'reading', 'component_type': 'reading', 'component_ref': item['ref'],
                'component_title': item['component']['title'], 'module_ref': state['course']['curriculum_module_ref'],
                'module_title': state['course']['source_course_title'], 'started_at': item['start'], 'submitted_at': item['end']})
        else:
            common['canonical_activity_key'] = by_progress[pid]['canonical_activity_key']
        insert(cur, 'learner_activity_sources', {**common, 'activity_type': 'reading',
            'title': item['component']['title'], 'completed': True, 'canonical_progress_id': pid,
            'source_started_at': item['start'], 'source_ended_at': item['end'],
            'source_course_ref': state['course']['source_course_ref'], 'source_catalog_activity_id': item['definition']['id'],
            'source_fingerprint': digest(payload)})
    if plan['archive']:
        cur.execute('''UPDATE curriculum.source_activities SET deleted_at=now()
            WHERE source_course_id=%s AND id=ANY(%s) AND deleted_at IS NULL''', [state['course']['id'], plan['archive']])
        if cur.rowcount != len(plan['archive']):
            raise ValueError('Catalogue changed during repair.')
    return run


def verify(before, after, plan):
    catalogue = {d['id']: d for d in after['definitions']}
    if set(catalogue) != {d['id'] for d in before['definitions']}:
        raise ValueError('Catalogue records were added or physically removed.')
    for original in before['definitions']:
        retained = dict(catalogue[original['id']])
        if original['id'] in plan['archive']:
            if retained['deleted_at'] is None:
                raise ValueError('Selected catalogue record was not archived.')
            retained['deleted_at'] = original['deleted_at']
        if retained != original:
            raise ValueError('Existing catalogue evidence changed.')
    for name in ('progress', 'sources', 'segments', 'journals', 'identities'):
        originals = {r['id']: r for r in before[name]}
        retained = {r['id']: r for r in after[name] if r['id'] in originals}
        if digest(originals) != digest(retained):
            raise ValueError(f'Existing {name} changed; rollback required.')
    for name in ('course', 'memberships', 'owners', 'export', 'snapshot'):
        if digest(before[name]) != digest(after[name]):
            raise ValueError('Course ownership or retained evidence changed.')
    if hours(before) != hours(after):
        raise ValueError('Accepted hours changed.')
    if before.get('accepted_totals') != after.get('accepted_totals'):
        raise ValueError('Learner-wide accepted totals changed.')
    if len(after['progress']) != len(before['progress']) + sum(r['progress_id'] is None for r in plan['restores']):
        raise ValueError('Unexpected progress record count.')
    if len(after['sources']) != len(before['sources']) + len(plan['links']) + len(plan['restores']):
        raise ValueError('Unexpected source record count.')
    projected = projections(after)
    for owner_id, old in plan['before'].items():
        expected = set()
        for item in old['items']:
            ref = item['activity_id'].split(':', 2)[2]
            if item['completed'] and (ref in plan['expected'] or ref in plan['replacements']):
                expected.add(plan['replacements'].get(ref, ref))
        if owner_id == before['owner']['id']:
            expected.update(item['ref'] for item in plan['restores'])
        actual = {item['activity_id'].split(':', 2)[2] for item in projected[owner_id]['items'] if item['completed']}
        if actual != expected or len(projected[owner_id]['items']) != len(plan['expected']):
            raise ValueError('A learner completion changed unexpectedly.')
        removed_hours = sum(i['actual'] for i in old['items']
            if i['activity_id'].split(':', 2)[2] not in plan['expected']
            and i['activity_id'].split(':', 2)[2] not in plan['replacements'])
        if abs(projected[owner_id]['accepted_hours'] - (old['accepted_hours'] - removed_hours)) > 0.000002:
            raise ValueError('Course hours changed beyond explicitly removed content.')
    return projected


def run(args):
    catalogue_only = getattr(args, 'catalogue_only', False)
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE if args.apply else psycopg.IsolationLevel.REPEATABLE_READ
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout='60s'")
            cur.execute("SET LOCAL lock_timeout='5s'")
            database = cur.execute('SELECT current_database() AS name').fetchone()['name']
            if args.apply and (database != args.expected_database or conn.info.host != args.expected_host):
                raise ValueError('Database target differs from the preview.')
            state = read_state(cur, args.course_id, args.aptem_id, catalogue_only=catalogue_only)
            if args.apply:
                cur.execute('SELECT id FROM curriculum.source_courses WHERE id=%s FOR UPDATE', [state['course']['id']])
                owner_ids = sorted(o['id'] for o in state['owners'])
                cur.execute("""SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),id::integer)
                    FROM unnest(%s::bigint[]) owner(id) ORDER BY id""", [owner_ids])
                cur.execute('SELECT id FROM "Learner".learners WHERE id=ANY(%s) ORDER BY id FOR UPDATE', [owner_ids])
            plan = plan_repair(state, args.remove_activity, args.restore_material_ids, catalogue_only=catalogue_only)
            fingerprint = digest(state)
            projection = plan['before'][state['owner']['id']]
            output = dict(database=database, host=conn.info.host, fingerprint=fingerprint,
                catalogue_before=len(projection['items']), catalogue_after=len(plan['expected']),
                catalogue_to_archive=len(plan['archive']), lineage_links_to_add=len(plan['links']),
                completions_to_restore=len(plan['restores']), enrolled_learners=len(state['owners']),
                new_progress_records=sum(r['progress_id'] is None for r in plan['restores']),
                completed_before=sum(i['completed'] for i in projection['items']),
                accepted_hours_before=projection['accepted_hours'])
            if args.apply:
                if fingerprint != args.expected_fingerprint:
                    raise ValueError('State changed after preview; preview again.')
                if plan['archive'] or plan['links'] or plan['restores']:
                    sync_run = apply_plan(cur, state, plan, fingerprint)
                    after = read_state(cur, args.course_id, args.aptem_id, catalogue_only=catalogue_only)
                    projected = verify(state, after, plan)
                    pending = plan_repair(after, args.remove_activity, args.restore_material_ids, catalogue_only=catalogue_only)
                    if pending['archive'] or pending['links'] or pending['restores']:
                        raise ValueError('Repair is not idempotent.')
                    final = projected[state['owner']['id']]
                    completed = sum(i['completed'] for i in final['items'])
                    output.update(applied=True, verification='passed', completed_after=completed,
                        percent_after=round(completed / len(final['items']) * 100, 2),
                        accepted_hours_after=final['accepted_hours'], existing_records_preserved=True,
                        accepted_seconds_preserved=True, idempotent=True, sync_run_id=sync_run)
                    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',
                        finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(output), sync_run])
                else:
                    output.update(applied=False, already_repaired=True)
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--course-id', type=int, required=True)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--restore-material-ids', type=ids, default=[])
    parser.add_argument('--remove-activity', action='append', default=[])
    parser.add_argument('--catalogue-only', action='store_true',
        help='Collapse proven unambiguous pairs only; preserve unmatched/native content and all saved progress.')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-database')
    parser.add_argument('--expected-host')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and not all((args.expected_database, args.expected_host, args.expected_fingerprint)):
        parser.error('Apply requires the database, host and fingerprint from the preview.')
    print(json.dumps(run(args), default=str))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, psycopg.Error, OSError) as error:
        print(json.dumps({'error': str(error) if isinstance(error, ValueError) else type(error).__name__}))
        sys.exit(1)
