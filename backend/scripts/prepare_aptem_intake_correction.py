"""Historical date-based correction, superseded by programme-name intake parsing.

The historical functions remain for reviewing the executed correction. Running
this file is disabled so it cannot regenerate the rejected date-derived plan.
The current intake parser is aptem_programme_cohorts.parse_programme_intake.
"""

import hashlib
import json
from collections import defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / 'reports/aptem_intake_correction_before_2026-09-11.json'
SQL_PATH = ROOT / 'backend/sql/2026-09-11_correct_aptem_intakes.sql'
PLAN_PATH = ROOT / 'reports/aptem_intake_correction_plan_2026-09-11.json'


def intake_start(start):
    """Jan-Feb -> Feb; Mar-Jun -> Jun; Jul-Oct -> Oct; Nov-Dec -> next Feb."""
    start = date.fromisoformat(start) if isinstance(start, str) else start
    for month in (2, 6, 10):
        if start.month <= month:
            return date(start.year, month, 1)
    return date(start.year + 1, 2, 1)


def month_before(start):
    start = date.fromisoformat(start)
    return date(start.year - (start.month == 1), start.month - 1 or 12, 1)


def imported_cohort_id(programme_id, start):
    # PostgreSQL jsonb_build_array(... )::text uses the same comma-space layout.
    payload = json.dumps([programme_id, str(start)], ensure_ascii=False)
    return 'APTEM-COHORT-' + hashlib.md5(payload.encode('utf-8')).hexdigest()


def make_plan(snapshot):
    cohorts = {c['cohort_id']: c for c in snapshot['cohorts']}
    groups = {g['group_id']: g for g in snapshot['groups']}
    assert cohorts and all(c['source_type'] == 'aptem_import' and not c['deleted_at'] for c in cohorts.values())
    assert all(c['cohort_id'] == imported_cohort_id(c['programme_id'], c['start_date']) for c in cohorts.values()), 'An original cohort date was edited.'
    assert all(g['group_id'].startswith('APTEM-GROUP-') and not g['deleted_at'] for g in groups.values()), 'Unexpected group in imported cohorts.'
    programme_names = {p['programme_id']: p['name'] for p in snapshot['programmes']}
    corrected_dates = {cid: intake_start(month_before(c['start_date'])) for cid, c in cohorts.items()}
    targets = {}
    cohort_map = {}
    for cid, old in cohorts.items():
        start = corrected_dates[cid]
        target_id = imported_cohort_id(old['programme_id'], start)
        cohort_map[cid] = target_id
        existing = cohorts.get(target_id)
        target = targets.setdefault(target_id, {
            'cohort_id': target_id, 'cohort_name': start.strftime('%b %Y'),
            'programme_id': old['programme_id'], 'programme_name': programme_names[old['programme_id']],
            'start_date': str(start), 'source_type': 'aptem_intakes',
            'group_ids': [], 'module_names': [], 'is_new': existing is None,
        })
        if existing:
            assert existing['start_date'] == str(start)

    buckets = defaultdict(list)
    for group in groups.values():
        buckets[(cohort_map[group['cohort_id']], group['group_name'])].append(group)
    referenced_groups = {m['group_id'] for m in snapshot['modules']}
    group_map = {}
    kept_groups = []
    for (target_id, name), members in sorted(buckets.items()):
        # Keep a group with authored content, then one already in the correct
        # cohort. This preserves the attached module's stable group ID.
        members.sort(key=lambda g: (not (g['group_id'] in referenced_groups or g.get('module_ids')),
                                    g['cohort_id'] != target_id, g['group_id']))
        keeper = members[0]
        for field in ('coach_name', 'session_week_day', 'session_start_time', 'session_end_time', 'color'):
            values = {g.get(field) for g in members if g.get(field)}
            assert len(values) <= 1, f'Conflicting {field} while merging group {name}'
        updated = {
            'group_id': keeper['group_id'], 'group_name': name,
            'cohort_id': target_id, 'cohort_name': targets[target_id]['cohort_name'],
            'module_ids': sorted({value for g in members for value in (g.get('module_ids') or [])}) or keeper.get('module_ids'),
            'module_names': sorted({value for g in members for value in (g.get('module_names') or [])}) or keeper.get('module_names'),
        }
        for field in ('coach_name', 'session_week_day', 'session_start_time', 'session_end_time', 'color'):
            updated[field] = next((g[field] for g in members if g.get(field)), keeper.get(field))
        authored_notes = list(dict.fromkeys(g['notes'] for g in members
                                           if g.get('notes') and g['notes'] != 'Imported from LMS.Aptem_users.Group.'))
        if authored_notes:
            updated['notes'] = '\n\n'.join(authored_notes)
        kept_groups.append(updated)
        targets[target_id]['group_ids'].append(keeper['group_id'])
        targets[target_id]['module_names'].extend(updated['module_names'] or [])
        for group in members:
            group_map[group['group_id']] = keeper['group_id']
    kept_by_id = {g['group_id']: g for g in kept_groups}
    for target in targets.values():
        target['group_ids'].sort()
        target['module_names'] = sorted(set(target['module_names']))

    source_by_email = defaultdict(list)
    for source in snapshot['source']:
        source_by_email[(source['Email'] or '').strip().lower()].append(source)
    learner_updates = []
    placements_by_email = {}
    for learner in snapshot['learners']:
        if learner['cohort_id'] not in cohort_map:
            continue
        assert learner['group_id'] in group_map
        old_group = groups[learner['group_id']]
        assert learner['cohort_id'] == old_group['cohort_id']
        email = learner['email'].strip().lower()
        source = source_by_email[email]
        assert len(source) == 1, 'Missing or ambiguous source email.'
        target = targets[cohort_map[learner['cohort_id']]]
        assert target['start_date'] == str(intake_start(source[0]['Start-Date'])), 'Source date disagrees with original import.'
        assert old_group['group_name'] == source[0]['Group'], 'Source group changed since import.'
        new_group = kept_by_id[group_map[learner['group_id']]]
        update = {'id': learner['id'], 'cohort': target['cohort_name'], 'cohort_id': target['cohort_id'],
                  'group_name': new_group['group_name'], 'group_id': new_group['group_id']}
        assert email not in placements_by_email, 'Ambiguous learner email.'
        placements_by_email[email] = {'old': learner, 'new': update}
        if any(learner[key] != value for key, value in update.items()):
            learner_updates.append(update)

    enrolment_updates = []
    seen_emails = set()
    for enrolment in snapshot['enrolments']:
        email = (enrolment['Email'] or '').strip().lower()
        if email not in placements_by_email:
            continue
        assert email not in seen_emails, 'Ambiguous enrolment email.'
        seen_emails.add(email)
        placement = placements_by_email[email]
        assert (enrolment['Programme'], enrolment['Cohort'], enrolment['Group']) == (
            placement['old']['programme'], placement['old']['cohort'], placement['old']['group_name']
        ), 'Enrolment placement changed since import.'
        update = {'id': enrolment['id'], 'Cohort': placement['new']['cohort'], 'Group': placement['new']['group_name']}
        if any(enrolment[key] != value for key, value in update.items()):
            enrolment_updates.append(update)

    module_updates = []
    for module in snapshot['modules']:
        assert module['group_id'] in group_map and module['cohort_id'] in cohort_map
        target = targets[cohort_map[module['cohort_id']]]
        new_group = kept_by_id[group_map[module['group_id']]]
        update = {'module_catalogue_id': module['module_catalogue_id'], 'cohort_id': target['cohort_id'],
                  'cohort_name': target['cohort_name'], 'group_id': new_group['group_id'], 'group_name': new_group['group_name']}
        if any(module[key] != value for key, value in update.items()):
            module_updates.append(update)
    archived_groups = sorted(gid for gid, keeper in group_map.items() if gid != keeper)
    archived_cohorts = sorted(cid for cid in cohorts if cid not in targets)
    return {
        'rule': 'Jan-Feb -> Feb; Mar-Jun -> Jun; Jul-Oct -> Oct; Nov-Dec -> next Feb',
        'cohort_map': cohort_map, 'group_map': group_map, 'cohorts': list(targets.values()),
        'groups': kept_groups, 'archived_cohorts': archived_cohorts, 'archived_groups': archived_groups,
        'learner_updates': learner_updates, 'enrolment_updates': enrolment_updates, 'module_updates': module_updates,
        'eligible_learner_count': len(placements_by_email), 'eligible_enrolment_count': len(seen_emails),
    }


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def json_literal(value):
    return literal(json.dumps(value, ensure_ascii=False, separators=(',', ':'))) + '::jsonb'


def recordset(records, key, fields):
    types = {key: 'bigint' if key == 'id' else 'text'}
    types.update({field: 'jsonb' if field in ('group_ids', 'module_ids', 'module_names') else
                  'date' if field == 'start_date' else 'text' for field in fields})
    rows = [{field: row[field] for field in types} for row in records]
    declaration = ', '.join(f'{ident(field)} {kind}' for field, kind in types.items())
    return f'jsonb_to_recordset({json_literal(rows)}) AS x({declaration})'


def render_sql(snapshot, plan):
    assert '$intake_preflight$' not in json.dumps(snapshot)
    assert '$intake_verify$' not in json.dumps(plan)
    parts = ["-- Correct the imported Aptem cohorts to February, June and October intakes.\n"
             "-- Rule: Jan-Feb -> Feb; Mar-Jun -> Jun; Jul-Oct -> Oct; Nov-Dec -> next Feb.\n"
             "-- Snapshot-specific correction. Preserves module content and archives superseded rows.\n"
             "-- Preflight rejects stale snapshots. Run this complete file in one transaction.\n"
             "BEGIN;\nSET LOCAL standard_conforming_strings = on;\nSET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '60s';\n"
             'LOCK TABLE curriculum.cohorts, curriculum.groups, curriculum.modules,\n'
             '    "Learner".learners, enrolment."Created_users" IN SHARE ROW EXCLUSIVE MODE;\n']
    guards = []
    for name, table, key in [('cohorts', 'curriculum.cohorts', 'cohort_id'), ('groups', 'curriculum.groups', 'group_id'),
                             ('modules', 'curriculum.modules', 'module_catalogue_id'),
                             ('learners', '"Learner".learners', 'id'), ('enrolments', 'enrolment."Created_users"', 'id'),
                             ('source', '"LMS"."Aptem_users"', 'ID')]:
        expected = snapshot[name]
        if not expected:
            continue
        actual = '(SELECT jsonb_object_agg(k, to_jsonb(t)->k) FROM jsonb_object_keys(e.v) keys(k))'
        guards.append(f"IF EXISTS (SELECT 1 FROM jsonb_array_elements({json_literal(expected)}) e(v)\n"
                      f" LEFT JOIN {table} t ON t.{ident(key)}::text = e.v->>{literal(key)}\n"
                      f" WHERE {actual} IS DISTINCT FROM e.v) THEN\n"
                      f" RAISE EXCEPTION 'Snapshot changed: {name}. Rebuild the correction before running.'; END IF;")
    # All non-learner references were checked during preparation. Refuse to
    # archive identities if any new references appear before execution.
    cohort_ids = literal(json.dumps(list(plan['cohort_map']))) + '::jsonb'
    group_ids = literal(json.dumps(list(plan['group_map']))) + '::jsonb'
    cohort_scope = f'(SELECT jsonb_array_elements_text({cohort_ids}))'
    group_scope = f'(SELECT jsonb_array_elements_text({group_ids}))'
    for table, predicate, expected_count in [
        ('curriculum.groups', f'cohort_id IN {cohort_scope}', len(snapshot['groups'])),
        ('curriculum.modules', f'cohort_id IN {cohort_scope} OR group_id IN {group_scope}', len(snapshot['modules'])),
        ('"Learner".learners', f'cohort_id IN {cohort_scope} OR group_id IN {group_scope}', plan['eligible_learner_count']),
        ('enrolment."Created_users"',
         'lower(btrim("Email")) IN (SELECT lower(btrim(v->>\'Email\')) FROM jsonb_array_elements('
         + json_literal(snapshot['source']) + ') e(v))', len(snapshot['enrolments'])),
    ]:
        guards.append(f"IF (SELECT count(*) FROM {table} WHERE {predicate}) <> {expected_count} THEN\n"
                      f" RAISE EXCEPTION 'Reference count changed in {table}; rebuild the correction.'; END IF;")
    for table, field, ids in [
        ('"Learner".learner_attendance_details', 'group_id', group_ids),
        ('"Learner".verified_teams_attendance', 'group_id', group_ids),
        ('"Learner".learner_progress_entries', 'cohort_ref', cohort_ids),
        ('"Learner".learner_progress_entries', 'group_ref', group_ids),
        ('"Learner".learning_reflection_submissions', 'cohort_ref', cohort_ids),
        ('"Learner".learning_reflection_submissions', 'group_ref', group_ids),
        ('curriculum.week_templates', 'group_id', group_ids),
    ]:
        guards.append(f"IF EXISTS (SELECT 1 FROM {table} WHERE {ident(field)} IN (SELECT jsonb_array_elements_text({ids}))) THEN\n"
                      f" RAISE EXCEPTION 'New references in {table}.{field}; review required.'; END IF;")
    parts.append('DO $intake_preflight$ BEGIN\n' + '\n'.join(guards) + '\nEND $intake_preflight$;\n')

    def update(table, records, key, fields, timestamps=True):
        if not records:
            return
        fields = [f for f in fields if f != key]
        assignments = ', '.join(f'{ident(f)} = x.{ident(f)}' for f in fields)
        if timestamps:
            assignments += ', updated_at = now()'
        parts.append(f'UPDATE {table} t SET {assignments}\nFROM {recordset(records, key, fields)}\n'
                     f'WHERE t.{ident(key)} = x.{ident(key)};\n')

    new_cohorts = [c for c in plan['cohorts'] if c['is_new']]
    cohort_fields = ['cohort_name', 'programme_id', 'programme_name', 'start_date', 'source_type', 'group_ids', 'module_names']
    if new_cohorts:
        columns = ['cohort_id', *cohort_fields]
        parts.append('INSERT INTO curriculum.cohorts (' + ', '.join(ident(c) for c in columns) + ')\nSELECT '
                     + ', '.join('x.' + ident(c) for c in columns) + '\nFROM '
                     + recordset(new_cohorts, 'cohort_id', cohort_fields) + ';\n')
    update('curriculum.cohorts', [c for c in plan['cohorts'] if not c['is_new']], 'cohort_id', cohort_fields)
    for group in plan['groups']:
        old = next(g for g in snapshot['groups'] if g['group_id'] == group['group_id'])
        changed = [field for field, value in group.items() if field != 'group_id' and value != old[field]]
        if changed:
            update('curriculum.groups', [group], 'group_id', changed)
    update('curriculum.modules', plan['module_updates'], 'module_catalogue_id',
           ['cohort_id', 'cohort_name', 'group_id', 'group_name'])
    update('"Learner".learners', plan['learner_updates'], 'id', ['cohort', 'cohort_id', 'group_name', 'group_id'])
    update('enrolment."Created_users"', plan['enrolment_updates'], 'id', ['Cohort', 'Group'], timestamps=False)
    for table, key, ids in [('curriculum.groups', 'group_id', plan['archived_groups']),
                            ('curriculum.cohorts', 'cohort_id', plan['archived_cohorts'])]:
        if ids:
            status = ", status = 'archived', group_ids = '[]'::jsonb" if key == 'cohort_id' else ''
            parts.append(f"UPDATE {table} SET deleted_at = now(), deleted_by = 'aptem_intake_correction',\n"
                         f" deleted_via_parent = NULL, updated_at = now(){status}\n"
                         f"WHERE {ident(key)} IN (SELECT jsonb_array_elements_text({json_literal(ids)}));\n")
    checks = []
    for table, records, key, fields in [
        ('curriculum.cohorts', plan['cohorts'], 'cohort_id', ['cohort_name', 'start_date', 'source_type', 'group_ids']),
        ('curriculum.groups', plan['groups'], 'group_id', ['cohort_id', 'cohort_name', 'group_name']),
        ('"Learner".learners', plan['learner_updates'], 'id', ['cohort', 'cohort_id', 'group_name', 'group_id']),
        ('enrolment."Created_users"', plan['enrolment_updates'], 'id', ['Cohort', 'Group']),
    ]:
        actual = '(' + ', '.join('t.' + ident(f) for f in fields) + ')'
        wanted = '(' + ', '.join('x.' + ident(f) for f in fields) + ')'
        checks.append(f'IF EXISTS (SELECT 1 FROM {recordset(records, key, fields)}\n'
                      f' LEFT JOIN {table} t ON t.{ident(key)} = x.{ident(key)}\n'
                      f' WHERE t.{ident(key)} IS NULL OR {actual} IS DISTINCT FROM {wanted}) THEN\n'
                      f" RAISE EXCEPTION 'Correction verification failed in {table}'; END IF;")
    new_ids = json_literal([c['cohort_id'] for c in plan['cohorts']])
    archived_cohort_ids = json_literal(plan['archived_cohorts'])
    archived_group_ids = json_literal(plan['archived_groups'])
    checks.extend([
        f"IF EXISTS (SELECT 1 FROM curriculum.cohorts WHERE cohort_id IN (SELECT jsonb_array_elements_text({new_ids}))\n"
        " AND (deleted_at IS NOT NULL OR extract(month FROM start_date) NOT IN (2,6,10))) THEN\n"
        " RAISE EXCEPTION 'An intake is archived or outside February/June/October'; END IF;",
        f"IF EXISTS (SELECT 1 FROM curriculum.groups WHERE deleted_at IS NULL AND cohort_id IN (SELECT jsonb_array_elements_text({archived_cohort_ids}))) THEN\n"
        " RAISE EXCEPTION 'A live group still refers to a superseded cohort'; END IF;",
        f'IF EXISTS (SELECT 1 FROM "Learner".learners WHERE cohort_id IN (SELECT jsonb_array_elements_text({archived_cohort_ids}))\n'
        f' OR group_id IN (SELECT jsonb_array_elements_text({archived_group_ids}))) THEN\n'
        " RAISE EXCEPTION 'A learner still refers to a superseded placement'; END IF;",
        f"IF EXISTS (SELECT 1 FROM curriculum.modules WHERE cohort_id IN (SELECT jsonb_array_elements_text({archived_cohort_ids}))\n"
        f" OR group_id IN (SELECT jsonb_array_elements_text({archived_group_ids}))) THEN\n"
        " RAISE EXCEPTION 'A module still refers to a superseded placement'; END IF;",
    ])
    parts.append('DO $intake_verify$ BEGIN\n' + '\n'.join(checks) + '\nEND $intake_verify$;\n')
    parts.append('COMMIT;\n')
    return '\n'.join(parts)


def main():
    snapshot = json.loads(SNAPSHOT.read_text(encoding='utf-8'))
    plan = make_plan(snapshot)
    PLAN_PATH.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
    SQL_PATH.parent.mkdir(exist_ok=True)
    SQL_PATH.write_text(render_sql(snapshot, plan), encoding='utf-8')
    print(json.dumps({
        'active_cohorts_after': len(plan['cohorts']), 'active_groups_after': len(plan['groups']),
        'new_cohorts': sum(c['is_new'] for c in plan['cohorts']),
        'cohorts_to_archive': len(plan['archived_cohorts']), 'groups_to_archive': len(plan['archived_groups']),
        'learner_updates': len(plan['learner_updates']), 'enrolment_updates': len(plan['enrolment_updates']),
        'module_updates': len(plan['module_updates']),
        'eligible_learner_count': plan['eligible_learner_count'], 'eligible_enrolment_count': plan['eligible_enrolment_count'],
    }, indent=2))


if __name__ == '__main__':
    raise SystemExit(
        'The start-date intake method has been retired. Use programme-name '
        'parsing from aptem_programme_cohorts; resolve undated names and '
        'May/July/August labels before preparing another database correction.'
    )
