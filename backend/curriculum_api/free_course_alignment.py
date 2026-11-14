"""Insert-only alignment of architecture free courses with native storage.

No caller may use profile primary keys as cross-database identities. Existing
target rows win in full, including timestamps, order and archived history.
The enrolment JSON receives only newly imported assignments so normal plan
saves and the learner viewer retain them; training plans/hours are untouched.
"""
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json

from psycopg import sql
from psycopg.types.json import Jsonb

from .legacy_free_course_migration import adopted_id


TABLES = {
    'free_courses': 'curriculum',
    'free_course_weeks': 'curriculum',
    'free_programme_components': 'curriculum',
    'learner_free_courses': 'Learner',
    'learner_free_course_progress': 'Learner',
}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str,
                                     separators=(',', ':')).encode()).hexdigest()


def rows(database, query, params=()):
    with database.cursor() as cursor:
        cursor.execute(query, params)
        names = [column[0] for column in cursor.description]
        json_fields = {column[0] for column in cursor.description if column[1] in (114, 3802)}
        return [{name: json.loads(value) if name in json_fields and isinstance(value, str) else value
                 for name, value in zip(names, row)} for row in cursor.fetchall()]


def snapshot(database):
    data = {table: rows(database, sql.SQL('SELECT * FROM {} ORDER BY id').format(
        sql.Identifier(namespace, table))) for table, namespace in TABLES.items()}
    data['profiles'] = rows(database, 'SELECT id,enrolment_id FROM "Learner".learners ORDER BY id')
    data['assignments_json'] = rows(database, '''SELECT id,"Free_courses"::jsonb AS value
        FROM enrolment."Created_users" ORDER BY id''')
    data['enrolment_uuids'] = {r['id']: str(r['uuid']) for r in rows(database,
        'SELECT id,uuid FROM enrolment."Created_users" ORDER BY id')}
    data['quiz_ids'] = [row['id'] for row in rows(database, 'SELECT id FROM curriculum.quizzes ORDER BY id')]
    data['ordinary_refs'] = {table: [r['reference'] for r in rows(database,
        sql.SQL('SELECT {} AS reference FROM curriculum.{} ORDER BY {}').format(
            sql.Identifier(key), sql.Identifier(table), sql.Identifier(key)))]
        for table, key in (('modules', 'module_catalogue_id'), ('weeks', 'id'), ('components', 'id'))}
    return data


@dataclass
class Plan:
    inserts: dict
    assignment_appends: dict
    fingerprint: str
    unlinked_quizzes: int

    def summary(self):
        return {**{table: len(records) for table, records in self.inserts.items()},
                'assignment_json_records': sum(map(len, self.assignment_appends.values())),
                'unlinked_source_quizzes': self.unlinked_quizzes,
                'fingerprint': self.fingerprint}


def build_plan(source, target):
    inserts = {table: [] for table in TABLES}
    src = {table: {r['id']: r for r in source[table]} for table in TABLES}
    dst = {table: {r['id']: r for r in target[table]} for table in TABLES}
    new_courses = src['free_courses'].keys() - dst['free_courses'].keys()
    new_weeks = {key for key, week in src['free_course_weeks'].items() if week['course_id'] in new_courses}
    new_components = src['free_programme_components'].keys() - dst['free_programme_components'].keys()
    # A shared component proves the course identity even when old week IDs
    # were renamed during production's native-storage migration.
    for key, component in src['free_programme_components'].items():
        source_course = src['free_course_weeks'][component['free_module_id']]['course_id']
        if key in dst['free_programme_components']:
            old = dst['free_programme_components'][key]
            if dst['free_course_weeks'][old['free_module_id']]['course_id'] != source_course:
                raise ValueError('A shared component has conflicting course ownership.')
        elif source_course not in new_courses:
            raise ValueError('New content in an existing course needs explicit reconciliation.')
    if new_weeks & dst['free_course_weeks'].keys():
        raise ValueError('A new course reuses an existing week identity.')
    for key in sorted(new_courses):
        original = src['free_courses'][key]
        reference = adopted_id('MOD', key, key)
        data = dict(original)
        data.update(content_ref=reference, managed_by_builder=True, storage_version=2,
                    authoring_data={
                        'module_catalogue_id': reference, 'title': original['course_name'],
                        'description': original.get('description'), 'source_type': 'free_course',
                        'source_id': key, 'learner_roster_mode': 'manual',
                        'is_programme_deleted': False, 'session_overrides': {},
                        'sessions_number': 0, 'quality_score': 0,
                    })
        inserts['free_courses'].append(data)
    for key in sorted(new_weeks):
        original = src['free_course_weeks'][key]
        if original.get('status', 'active') != 'active':
            raise ValueError('Importing inactive weeks requires an explicit archive-state mapping.')
        owner = src['free_courses'][original['course_id']]
        reference = adopted_id('WEEK', owner['id'], key)
        data = {field: original[field] for field in (
            'id', 'course_id', 'week_number', 'display_order', 'created_at', 'updated_at')}
        data.update({field: original[field] for field in ('component_count', 'total_otjh') if field in original})
        data.update(week_title=original['title'], course_name=owner['course_name'],
                    week_id=reference, content_ref=reference,
                    authoring_data={**original, 'id': reference,
                        'module_catalogue_id': adopted_id('MOD', owner['id'], owner['id']),
                        'is_programme_deleted': False, 'library_state': ''})
        inserts['free_course_weeks'].append(data)
    unlinked = 0
    for key in sorted(new_components):
        original = src['free_programme_components'][key]
        week = src['free_course_weeks'][original['free_module_id']]
        owner = week['course_id']
        reference = adopted_id('COMP', owner, key)
        settings = original.get('settings_json') or {}
        if not isinstance(settings, dict):
            raise ValueError('Component settings must be a JSON object.')
        if original['type'] == 'quiz':
            linked = settings.get('linkedQuizId')
            if linked and int(linked) not in target['quiz_ids']:
                raise ValueError('An imported quiz definition is missing from the target.')
            unlinked += not bool(linked)
        data = dict(original)
        data.update(content_ref=reference, week_id=adopted_id('WEEK', owner, week['id']),
                    authoring_data={**original, 'id': reference,
                        'module_catalogue_id': adopted_id('MOD', owner, owner),
                        'week_id': adopted_id('WEEK', owner, week['id']),
                        'is_programme_deleted': False, 'library_state': '', 'ksb_mappings': []})
        inserts['free_programme_components'].append(data)
    for ordinary, native in (('modules','free_courses'), ('weeks','free_course_weeks'),
                             ('components','free_programme_components')):
        if {r['content_ref'] for r in inserts[native]} & set(target['ordinary_refs'][ordinary]):
            raise ValueError('An imported native identity is already owned by ordinary curriculum content.')
    source_profiles = {r['id']: r['enrolment_id'] for r in source['profiles']}
    target_profiles = defaultdict(list)
    for profile in target['profiles']:
        if profile['enrolment_id'] is not None:
            target_profiles[profile['enrolment_id']].append(profile['id'])

    def learner(source_id):
        enrolment = source_profiles.get(source_id)
        matches = target_profiles.get(enrolment, [])
        if enrolment is None or len(matches) != 1:
            raise ValueError('A learner cannot be matched unambiguously by enrolment identity.')
        source_uuid = source['enrolment_uuids'].get(enrolment)
        if not source_uuid or source_uuid != target['enrolment_uuids'].get(enrolment):
            raise ValueError('The enrolment UUID differs between branches; learner identity is not verified.')
        return matches[0], enrolment

    known = {(r['learner_id'], r['free_course_ref']) for r in target['learner_free_courses']}
    positions = defaultdict(int)
    for record in target['learner_free_courses']:
        positions[record['learner_id']] = max(positions[record['learner_id']], record['position'])
    legacy = {r['id']: r['value'] for r in target['assignments_json']}
    appends = defaultdict(list)
    for record in sorted(source['learner_free_courses'], key=lambda r: (r['learner_id'], r['position'], r['id'])):
        target_id, enrolment = learner(record['learner_id'])
        course_id = record['free_course_ref']
        if course_id not in src['free_courses']:
            raise ValueError('A source assignment has no course.')
        if (target_id, course_id) in known:
            continue
        positions[target_id] += 1
        course = dst['free_courses'].get(course_id, src['free_courses'][course_id])
        if course.get('converted_at') or course.get('deleted_at'):
            raise ValueError('An imported assignment targets a converted or archived production course.')
        inserts['learner_free_courses'].append(dict(learner_id=target_id, free_course_ref=course_id,
            position=positions[target_id], free_course_title=course['course_name']))
        known.add((target_id, course_id))
        if enrolment not in legacy or not isinstance(legacy[enrolment], list):
            raise ValueError('The target enrolment assignment store is missing or not a list.')
        if not any(isinstance(item, dict) and item.get('freeCourseId') == course_id for item in legacy[enrolment]):
            appends[enrolment].append(dict(freeCourseId=course_id, courseName=course['course_name'], addedAt=''))
    known = {(r['learner_id'], r['component_ref']) for r in target['learner_free_course_progress']}
    for record in source['learner_free_course_progress']:
        target_id, _ = learner(record['learner_id'])
        if (target_id, record['component_ref']) in known:
            continue
        component = src['free_programme_components'].get(record['component_ref'])
        if not component or src['free_course_weeks'][component['free_module_id']]['course_id'] != record['free_course_ref']:
            raise ValueError('Source progress has conflicting course/component ownership.')
        if record['status'] not in ('active', 'inactive'):
            raise ValueError('Unknown source progress state.')
        inserts['learner_free_course_progress'].append({**{k: record[k] for k in
            ('free_course_ref', 'component_ref', 'completed_at', 'status', 'deleted_at')}, 'learner_id': target_id})
        known.add((target_id, record['component_ref']))
    return Plan(inserts, dict(appends), digest([source, target]), unlinked)


def apply_plan(database, plan, before):
    """Caller owns the transaction and locks; every original row is verified."""
    def original_state():
        return {table: rows(database, sql.SQL('''SELECT count(*) AS count,
            md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) AS checksum
            FROM {} t WHERE id=ANY(%s)''').format(sql.Identifier(namespace, table)),
            [[r['id'] for r in before[table]]])[0] for table,namespace in TABLES.items()}

    original = original_state()
    affected = list(plan.assignment_appends)
    def enrolment_state():
        return rows(database, '''SELECT id,md5((to_jsonb(u)-'Free_courses')::text) AS other_fields,
            "Free_courses"::jsonb AS value FROM enrolment."Created_users" u
            WHERE id=ANY(%s) ORDER BY id''', [affected])

    enrolments_before = enrolment_state()
    with database.cursor() as cursor:
        for table, records in plan.inserts.items():
            grouped = defaultdict(list)
            for record in records:
                grouped[tuple(record)].append(record)
            for fields, batch in grouped.items():
                cursor.executemany(sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(
                    sql.Identifier(TABLES[table], table), sql.SQL(',').join(map(sql.Identifier, fields)),
                    sql.SQL(',').join(sql.Placeholder() for _ in fields)),
                    [[Jsonb(json.loads(json.dumps(record[k], default=str)))
                      if isinstance(record[k], (dict, list)) else record[k] for k in fields] for record in batch])
                if cursor.rowcount != len(batch):
                    raise ValueError('Unexpected inserted row count; alignment rolled back.')
        if affected:
            cursor.executemany('''UPDATE enrolment."Created_users"
                SET "Free_courses"=("Free_courses"::jsonb || %s::jsonb) WHERE id=%s''',
                [[Jsonb(additions), enrolment] for enrolment,additions in plan.assignment_appends.items()])
            if cursor.rowcount != len(affected):
                raise ValueError('An enrolment assignment update missed its expected rows.')
    if original != original_state():
        raise ValueError('An existing target row changed; alignment rolled back.')
    for table in TABLES:
        count = rows(database, sql.SQL('SELECT count(*) AS count FROM {}').format(
            sql.Identifier(TABLES[table], table)))[0]['count']
        if count != len(before[table]) + len(plan.inserts[table]):
            raise ValueError('Unexpected inserted row count; alignment rolled back.')
    expected = deepcopy(enrolments_before)
    for row in expected:
        if row['id'] in plan.assignment_appends:
            row['value'] += plan.assignment_appends[row['id']]
    if expected != enrolment_state():
        raise ValueError('Existing learner assignment/identity values changed; alignment rolled back.')
