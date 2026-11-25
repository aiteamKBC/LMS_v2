"""Insert-only alignment of architecture free courses with native storage.

No caller may use profile primary keys as cross-database identities. Existing
target rows win in full, including timestamps, order and archived history.
The enrolment JSON receives only newly imported assignments so normal plan
saves and the learner viewer retain them; training plans/hours are untouched.
"""
from collections import defaultdict
from copy import deepcopy
import json

from psycopg import sql
from psycopg.types.json import Jsonb

from ..domain.free_course_alignment import TABLES, Plan, digest, build_plan


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
