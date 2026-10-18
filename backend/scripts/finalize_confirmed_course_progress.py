"""Apply explicitly confirmed completion and verified dates for one learner.

Preview is read-only. Completion confirmation does not fabricate a completion
timestamp, quiz score, or accepted hours. Month repairs use saved source dates.
Rollback of catalogue additions is limited to unused rows from a selected run.
"""
import argparse
from collections import defaultdict
from copy import deepcopy
import json
import sys
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import repair_legacy_course_catalogue as catalogue
from reconcile_aptem_evidence import digest, insert, ids
from reconcile_old_lms_missing_ssot import database_url

RUN_KIND = 'confirmed-course-completion-and-months-v1'
UK = ZoneInfo('Europe/London')
DATE_FIELDS = ('reporting_month', 'reporting_started_at', 'reporting_ended_at')


def read_state(cur, args):
    state = catalogue.read_state(cur, args.course_id, args.aptem_id, catalogue_only=True)
    sys.path.insert(0, str(catalogue.ROOT))
    from learner_api.course_catalogue_display import catalogue_display_context, read_export_placements
    course = state['course']
    definitions = [{**d, 'source_course_ref': course['source_course_ref'],
                    'source_course_title': course['source_course_title'],
                    'curriculum_module_ref': course['curriculum_module_ref']} for d in state['definitions']]
    exports = read_export_placements(lambda sql, params: cur.execute(sql, params).fetchall(), [course])
    state['definitions'] = catalogue_display_context(definitions, exports)
    state['last_order'] = cur.execute('SELECT coalesce(max(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s',
                                    [state['owner']['id']]).fetchone()['n']
    state['dependencies'] = cur.execute('''SELECT a.id,
        (SELECT count(*) FROM "Learner".learner_activity_sources s WHERE s.source_catalog_activity_id=a.id) AS source_links,
        (SELECT count(*) FROM curriculum.historical_components h WHERE h.source_catalog_activity_id=a.id) AS history_links
        FROM curriculum.source_activities a WHERE a.source_course_id=%s AND a.source_activity_id=ANY(%s) ORDER BY a.id''',
        [course['id'], [f'material:{i}' for i in args.rollback_material_ids]]).fetchall()
    return state


def monthly(projection):
    months = defaultdict(lambda: {'completed': 0, 'total': 0})
    for item in projection['items']:
        group = months[item.get('month') or 'undated']
        group['total'] += 1
        group['completed'] += bool(item['completed'])
    return dict(sorted(months.items()))


def completion_set(projection):
    return {i['activity_id'] for i in projection['items'] if i['completed']}


def make_plan(state, args):
    if not args.confirmation_note.strip():
        raise ValueError('An explicit completion confirmation note is required.')
    owner = state['owner']
    course = state['course']
    before = catalogue.projections(state, include_placements=False)
    simulated = deepcopy(state)
    definitions = {d['source_activity_id']: d for d in state['definitions'] if d['deleted_at'] is None}
    progress = {p['id']: p for p in state['progress'] if p['learner_id'] == owner['id'] and p['deleted_at'] is None}
    sources = {s['source_activity_id']: s for s in state['sources']
               if s['learner_id'] == owner['id'] and s['source_system'] == 'old_lms' and s['deleted_at'] is None}
    plan = {'archive': [], 'dates': [], 'confirm': [], 'before': before}
    dependencies = {d['id']: d for d in state['dependencies']}
    for ident in args.rollback_material_ids:
        ref = f'material:{ident}'
        definition = definitions.get(ref)
        if definition is None:
            continue
        payload = catalogue.metadata(definition['source_payload'])
        fact = payload.get('live_catalogue_recovery') or {}
        dependency = dependencies[definition['id']]
        if (payload.get('recovery_run_id') != args.recovery_run_id
                or fact.get('section_id') or definition.get('curriculum_component_ref')
                or dependency['source_links'] or dependency['history_links']):
            raise ValueError('Rollback target is not an unused unsectioned addition from the selected run.')
        key = f"catalogue:{course['source_course_ref']}:{ref}"
        if any(i['activity_id'] == key and (i['has_result'] or i['completed'] or i['actual'])
               for projection in before.values() for i in projection['items']):
            raise ValueError('Rollback would remove existing learner evidence.')
        plan['archive'].append(definition['id'])
        next(d for d in simulated['definitions'] if d['id'] == definition['id'])['deleted_at'] = 'planned-archive'
    for ident in args.date_material_ids:
        ref = f'material:{ident}'
        source = sources.get(ref)
        definition = definitions.get(ref)
        if (not source or not definition or not source['completed']
                or source['source_catalog_activity_id'] != definition['id']
                or source['source_course_ref'] != str(course['source_course_ref'])):
            raise ValueError('Month repair needs an owned completed source and exact catalogue link.')
        record = progress.get(source['canonical_progress_id'])
        fact = catalogue.metadata(record['source_payload']).get('live_completion_recovery', {}).get('component', {}) if record else {}
        if (not record or record['sync_run_id'] != args.recovery_run_id or record['accepted']
                or record['actual_seconds'] is not None or source['accepted'] or source['actual_seconds'] is not None
                or fact.get('component_id') != ident or fact.get('completed') is not True
                or not fact.get('completed_at') or not record['submitted_at'] or not record['submitted_at'].tzinfo
                or any(s['progress_id'] == record['id'] for s in state['segments'])):
            raise ValueError('Month repair requires the selected recovery\'s untimed completion evidence.')
        at = record['submitted_at']
        fields = {'reporting_month': at.astimezone(UK).strftime('%Y-%m'),
                  'reporting_started_at': at, 'reporting_ended_at': at}
        if all(record.get(k) == v and source.get(k) == v for k, v in fields.items()):
            continue
        if any(record.get(k) or source.get(k) for k in DATE_FIELDS):
            raise ValueError('Existing reporting dates cannot be overwritten by month recovery.')
        plan['dates'].append({'progress_id': record['id'], 'source_id': source['id'], 'fields': fields, 'ref': ref})
        next(p for p in simulated['progress'] if p['id'] == record['id']).update(fields)
        next(s for s in simulated['sources'] if s['id'] == source['id']).update(fields)
    next_id = -1
    for ident in args.confirm_material_ids:
        ref = f'material:{ident}'
        definition = definitions.get(ref)
        if not definition or definition['id'] in plan['archive']:
            raise ValueError('Confirmed material is not in the retained course catalogue.')
        key = f"catalogue:{course['source_course_ref']}:{ref}"
        if key in completion_set(before[owner['id']]):
            continue
        if ref in sources:
            raise ValueError('An existing source requires separate completion reconciliation.')
        item = {'ref': ref, 'definition': definition, 'source_reported_completed': catalogue.metadata(definition['source_payload']).get('completed')}
        plan['confirm'].append(item)
        simulated['progress'].append(dict(id=next_id, learner_id=owner['id'], entry_order=state['last_order'] + len(plan['confirm']),
            source_system='staff_confirmation', source_activity_id=ref, component_ref=ref,
            kind='reading', component_title=definition['source_activity_title'], deleted_at=None,
            activity_status='completed', accepted=False, actual_seconds=None, reporting_month='', source_payload={}))
        simulated['sources'].append(dict(id=next_id, learner_id=owner['id'], source_system='old_lms',
            source_activity_id=ref, source_course_ref=course['source_course_ref'], source_catalog_activity_id=definition['id'],
            canonical_progress_id=next_id, completed=True, deleted_at=None))
        simulated['source_routes'].append({'id': definition['id'], 'source_course_ref': course['source_course_ref']})
        next_id -= 1
    after = catalogue.projections(simulated, include_placements=False)
    for learner_id, prior in before.items():
        expected = completion_set(prior)
        if learner_id == owner['id']:
            expected |= {f"catalogue:{course['source_course_ref']}:{i['ref']}" for i in plan['confirm']}
        if completion_set(after[learner_id]) != expected or after[learner_id]['accepted_hours'] != prior['accepted_hours']:
            raise ValueError('Simulation changed another completion or accepted hours.')
    plan['after'] = after
    return plan


def summary(state, plan):
    learner_id = state['owner']['id']
    final = plan['after'][learner_id]
    return {'catalogue_additions_to_rollback': len(plan['archive']), 'completion_confirmations': len(plan['confirm']),
            'verified_month_assignments': len(plan['dates']), 'months_before': monthly(plan['before'][learner_id]),
            'months_after': monthly(final), 'completed': len(completion_set(final)), 'total': len(final['items']),
            'accepted_hours': final['accepted_hours'], 'added_accepted_seconds': 0, 'members_checked': len(plan['after'])}


def apply_plan(cur, state, plan, args, fingerprint):
    owner, course = state['owner'], state['course']
    run = insert(cur, 'activity_sync_runs', {'run_key': RUN_KIND + ':' + fingerprint, 'run_kind': RUN_KIND,
        'status': 'running', 'dry_run': False,
        'source_counts': Jsonb({'course_id': course['source_course_ref'], 'rollback_of_run': args.recovery_run_id,
            'owner_confirmation': args.confirmation_note, 'archived_catalogue_ids': plan['archive']}),
        'result_counts': Jsonb(summary(state, plan))})
    for date in plan['dates']:
        proof = {'run_id': run, 'course_id': course['source_course_ref'], 'source_id': date['source_id'],
                 'basis': 'saved-original-source-completion', 'previous_reporting_month': '',
                 'completion_timestamp': date['fields']['reporting_started_at'].isoformat()}
        values = date['fields']
        for table, ident in [('learner_progress_entries', date['progress_id']), ('learner_activity_sources', date['source_id'])]:
            cur.execute(f'''UPDATE "Learner".{table} SET reporting_month=%s,reporting_started_at=%s,
                reporting_ended_at=%s,source_payload=source_payload||%s::jsonb
                WHERE id=%s AND learner_id=%s AND deleted_at IS NULL AND accepted=false AND actual_seconds IS NULL''',
                [values['reporting_month'], values['reporting_started_at'], values['reporting_ended_at'],
                 Jsonb({'verified_month_assignment': proof}), ident, owner['id']])
            if cur.rowcount != 1:
                raise ValueError('Month target changed during repair.')
    for index, confirmed in enumerate(plan['confirm'], 1):
        definition, ref = confirmed['definition'], confirmed['ref']
        payload = {'owner_completion_confirmation': {'run_id': run, 'basis': args.confirmation_note,
            'course_id': course['source_course_ref'], 'activity_ref': ref,
            'source_reported_completed': confirmed['source_reported_completed'],
            'completion_timestamp_known': False, 'actual_study_time_verified': False}}
        common = {k: owner[k] for k in ('enrolment_id', 'programme_id', 'aptem_id')}
        common.update(learner_id=owner['id'], source_activity_id=ref,
            canonical_activity_key=f"staff-confirmation:{owner['id']}:{course['source_course_ref']}:{ref}",
            activity_status='completed', accepted=False, actual_seconds=None,
            actual_basis='owner-confirmed-completion:actual-time-unverified', source_payload=Jsonb(payload), sync_run_id=run)
        pid = insert(cur, 'learner_progress_entries', {**common, 'source_system': 'staff_confirmation',
            'entry_order': state['last_order'] + index, 'kind': 'reading', 'component_type': 'reading',
            'component_ref': ref, 'component_title': definition['source_activity_title'],
            'module_ref': course['curriculum_module_ref'], 'module_title': course['source_course_title'],
            'week_title': definition['source_section_title']})
        insert(cur, 'learner_activity_sources', {**common, 'source_system': 'old_lms',
            'canonical_progress_id': pid, 'completed': True, 'activity_type': 'reading',
            'title': definition['source_activity_title'], 'source_fingerprint': digest(payload),
            'source_course_ref': course['source_course_ref'], 'source_catalog_activity_id': definition['id']})
    if plan['archive']:
        cur.execute('''UPDATE curriculum.source_activities SET deleted_at=now()
            WHERE source_course_id=%s AND id=ANY(%s) AND deleted_at IS NULL''', [course['id'], plan['archive']])
        if cur.rowcount != len(plan['archive']):
            raise ValueError('Catalogue changed during rollback.')
    return run


def verify(before, after, plan):
    allowed = {'progress': {d['progress_id'] for d in plan['dates']}, 'sources': {d['source_id'] for d in plan['dates']}}
    for name in ('progress', 'sources', 'segments', 'journals', 'identities'):
        expected_additions = len(plan['confirm']) if name in ('progress', 'sources') else 0
        if len(after[name]) - len(before[name]) != expected_additions:
            raise ValueError('Unexpected record additions or removals.')
        originals = {r['id']: r for r in before[name]}
        retained = {r['id']: r for r in after[name] if r['id'] in originals}
        if set(originals) != set(retained):
            raise ValueError('Historical records disappeared.')
        for ident, original in originals.items():
            actual = dict(retained[ident])
            if ident in allowed.get(name, set()):
                date = next(d for d in plan['dates'] if d['progress_id' if name == 'progress' else 'source_id'] == ident)
                if any(actual[k] != v for k, v in date['fields'].items()):
                    raise ValueError('Verified month was not saved.')
                payload = catalogue.metadata(actual['source_payload'])
                previous = catalogue.metadata(original['source_payload'])
                if (set(payload) != set(previous) | {'verified_month_assignment'}
                        or any(payload.get(k) != v for k, v in previous.items())):
                    raise ValueError('Original source evidence changed during month repair.')
                for field in (*DATE_FIELDS, 'source_payload'):
                    actual[field] = original[field]
            if actual != original:
                raise ValueError('Unrelated history changed.')
    for name in ('course', 'memberships', 'owners', 'export', 'snapshot', 'accepted_totals'):
        if before[name] != after[name]:
            raise ValueError('Course ownership, retained evidence or accepted totals changed.')
    original_defs = {d['id']: d for d in before['definitions']}
    if set(original_defs) != {d['id'] for d in after['definitions']}:
        raise ValueError('Catalogue records were added or physically deleted.')
    for row in after['definitions']:
        actual = dict(row)
        if row['id'] in plan['archive']:
            if row['deleted_at'] is None:
                raise ValueError('Unsupported addition was not archived.')
            actual['deleted_at'] = original_defs[row['id']]['deleted_at']
        if actual != original_defs[row['id']]:
            raise ValueError('Existing catalogue details changed.')
    if catalogue.hours(before) != catalogue.hours(after):
        raise ValueError('Accepted hours changed.')
    actual = catalogue.projections(after, include_placements=False)
    for learner_id, expected in plan['after'].items():
        if (completion_set(actual[learner_id]) != completion_set(expected)
                or monthly(actual[learner_id]) != monthly(expected)
                or actual[learner_id]['accepted_hours'] != expected['accepted_hours']):
            raise ValueError('Actual results differ from the verified preview.')
    return actual


def run(args):
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE if args.apply else psycopg.IsolationLevel.REPEATABLE_READ
        cur = conn.cursor()
        cur.execute("SET LOCAL statement_timeout='60s'")
        cur.execute("SET LOCAL lock_timeout='5s'")
        target = digest({'database': conn.info.dbname, 'host': conn.info.host})
        if args.apply and target != args.expected_target:
            raise ValueError('Database differs from the preview.')
        state = read_state(cur, args)
        plan = make_plan(state, args)
        fingerprint = digest(state)
        output = {'database': conn.info.dbname, 'target': target, 'fingerprint': fingerprint, **summary(state, plan)}
        if args.apply:
            if fingerprint != args.expected_fingerprint:
                raise ValueError('State changed since preview.')
            if not any(plan[k] for k in ('archive', 'dates', 'confirm')):
                return {**output, 'already_correct': True}
            cur.execute('SELECT id FROM curriculum.source_courses WHERE id=%s FOR UPDATE', [state['course']['id']])
            owner_ids = sorted(o['id'] for o in state['owners'])
            cur.execute("""SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),id::integer)
                FROM unnest(%s::bigint[]) owner(id) ORDER BY id""", [owner_ids])
            cur.execute('SELECT id FROM "Learner".learners WHERE id=ANY(%s) ORDER BY id FOR UPDATE', [owner_ids])
            audit_run = apply_plan(cur, state, plan, args, fingerprint)
            after = read_state(cur, args)
            verify(state, after, plan)
            pending = make_plan(after, args)
            if any(pending[k] for k in ('archive', 'dates', 'confirm')):
                raise ValueError('Repair is not idempotent.')
            output.update(applied=True, audit_run=audit_run, all_members_verified=True,
                          accepted_seconds_preserved=True, idempotent=True)
            cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
                updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(output), audit_run])
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--course-id', type=int, required=True)
    parser.add_argument('--recovery-run-id', type=int, required=True)
    parser.add_argument('--confirm-material-ids', type=ids, default=[])
    parser.add_argument('--date-material-ids', type=ids, default=[])
    parser.add_argument('--rollback-material-ids', type=ids, default=[])
    parser.add_argument('--confirmation-note', required=True)
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
                          'sqlstate': getattr(exc, 'sqlstate', None)}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
