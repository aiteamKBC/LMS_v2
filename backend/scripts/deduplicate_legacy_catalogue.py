"""Pure, evidence-based plans for legacy catalogue cleanup.

This module does not connect to a database. Plans preserve original records and
allocate their hours once per course. The caller must verify the current source
inventory, apply the links before retiring definitions, and verify projections.
"""
from collections import defaultdict
from copy import deepcopy
import json

import reconcile_legacy_learning as repair


def routes(items):
    result = defaultdict(set)
    for item in items:
        _, course, ref = item['activity_id'].split(':', 2)
        for ident in item['record_ids']:
            result[int(ident)].add((course, ref))
    return result


def cards(items):
    result = {}
    for item in items:
        card = result.setdefault(str(item['group_id']), {'total': 0, 'completed': 0, 'hours': 0})
        card['total'] += 1
        card['completed'] += bool(item['completed'])
        card['hours'] += item['actual']
    return result


def prospective_definitions(definitions, duplicates):
    retired = {item['id'] for item in duplicates}
    return [{**item, 'deleted_at': 'verified-cleanup-preview'} if item['id'] in retired else item
            for item in definitions]


def lineage_plan(state, courses, definitions, duplicates, scope):
    """Retain every existing placement, mapping only proven wrong-kind pairs.

    Adding an explicit source suppresses journal fallback in the reader, so all
    placements of a touched record are retained, including other owned courses.
    Never steal an occupied source key from another progress record.
    """
    before, original = repair.projected_items(state, courses, definitions, scope,
                                              owned_only=True, include_routes=True)
    replacements = {(item['course_ref'], item['wrong_ref']):
                    (item['course_ref'], item['verified_ref']) for item in duplicates}
    desired = {pid: {replacements.get(route, route) for route in placements}
               for pid, placements in original.items()}
    final_defs = prospective_definitions(definitions, duplicates)
    by_course = {c['id']: c['source_course_ref'] for c in courses if c['deleted_at'] is None}
    by_route = {(by_course[d['source_course_id']], d['source_activity_id']): d
                for d in final_defs if d['deleted_at'] is None and d['source_course_id'] in by_course}
    simulated = deepcopy(state)
    existing = {s['source_activity_id']: s for s in state['sources']
                if s['source_system'] == 'old_lms' and s['deleted_at'] is None}
    progress = {p['id']: p for p in state['progress'] if p['deleted_at'] is None}
    links = []
    next_id = -1
    for _ in range(3):
        after, actual = repair.projected_items(simulated, courses, final_defs, scope,
                                               owned_only=True, include_routes=True)
        missing = [(pid, route) for pid, needed in desired.items()
                   for route in sorted(needed - actual.get(pid, set()))]
        if not missing:
            verify_preserved(before, after, replacements)
            return {'links': links, 'before': cards(before), 'after': cards(after)}, simulated
        for pid, (course, ref) in missing:
            definition = by_route.get((course, ref))
            if definition is None:
                raise ValueError('A retained placement has no active replacement.')
            keys = (f'course:{course}:{ref}', ref)
            key = next((key for key in keys if key not in existing), None)
            if key is None:
                raise ValueError('Both typed source identities belong to retained records.')
            record = progress[pid]
            linked = [s for s in simulated['sources'] if s['canonical_progress_id'] == pid
                      and s['deleted_at'] is None]
            values = {k: record[k] for k in ('learner_id', 'enrolment_id', 'programme_id', 'aptem_id')
                      if k in record}
            values.update(source_system='old_lms', source_activity_id=key,
                canonical_activity_key=record.get('canonical_activity_key'),
                canonical_progress_id=pid, source_course_ref=course,
                source_catalog_activity_id=definition['id'],
                activity_type=definition['source_activity_type'],
                title=definition['source_activity_title'], activity_status=record.get('activity_status'),
                completed=scope['counts_as_completed']({**record, 'sources': linked}),
                accepted=False, actual_seconds=None, actual_basis='verified-catalogue-lineage-only')
            links.append(values)
            simulated['sources'].append({**values, 'id': next_id, 'deleted_at': None,
                                         '_row_hash': repair.digest(values)})
            existing[key] = simulated['sources'][-1]
            next_id -= 1
    raise ValueError('Lineage reconciliation did not converge.')


def verify_preserved(before, after, replacements):
    expected = {(str(item['group_id']), item['activity_id'].split(':', 2)[2])
                for item in before if item['completed']}
    expected = {replacements.get(key, key) for key in expected}
    actual = {(str(item['group_id']), item['activity_id'].split(':', 2)[2])
              for item in after if item['completed']}
    if not expected <= actual:
        raise ValueError('A retained completion would disappear.')
    old, new = cards(before), cards(after)
    for course, card in old.items():
        if abs(card['hours'] - new.get(course, {}).get('hours', 0)) > 0.000001:
            raise ValueError('Accepted course hours would change.')


def catalogue_scope_plan(state, verified, courses, definitions, scope):
    """Exclude only unrecorded extras absent from this learner's verified source.

    Native assignments and shared definitions remain intact. Existing explicit
    exclusions are retained; recorded results are never hidden by this plan.
    """
    items = repair.projected_items(state, courses, definitions, scope, owned_only=True)
    extra = defaultdict(set)
    for item in items:
        _, course, ref = item['activity_id'].split(':', 2)
        if (course in verified and ref not in verified[course]['facts']
                and not item['has_result'] and not item['completed'] and not item['actual']):
            extra[course].add(ref)
    by_id = {c['id']: c for c in courses}
    updates = []
    for member in state['memberships']:
        if member['deleted_at'] is not None or member['source_relationship'] != 'historical':
            continue
        course = by_id[member['source_course_id']]['source_course_ref']
        if not extra[course]:
            continue
        previous = member.get('verified_catalogue_scope') or {}
        previous = json.loads(previous) if isinstance(previous, str) else previous
        excluded = set(previous.get('excluded_activity_refs', [])) | extra[course]
        updates.append({'id': member['id'], 'course_ref': course,
            'new_exclusions': sorted(extra[course]), 'previous': previous,
            'scope': {**previous, 'version': 1, 'basis': 'verified-legacy-account-inventory',
                      'course_ref': course, 'excluded_activity_refs': sorted(excluded)}})
    return updates
