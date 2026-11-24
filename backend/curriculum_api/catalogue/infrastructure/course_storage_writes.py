"""Existing free-course persistence, inside the caller's authoring transaction.

Concrete storage owner; conversion orchestration remains in its existing entry.
SQL, validation and transaction ownership are unchanged.
"""
import hashlib
import json
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection
from psycopg import sql
from psycopg.types.json import Jsonb
from .storage_context import native_only
from .learning_relations import TABLES
from .learning_read_routes import enabled, native_read_table
from .course_storage_reads import course, free_rows, _rows


JSON_COLUMNS = {'settings_json', 'ksb_mappings', 'learning_outcomes', 'epa_requirements',
                'professional_qualification_outcomes', 'ai_material', 'weekly_schedule',
                'session_holidays', 'session_overrides', 'module_overview'}


def _data(values):
    result = dict(values)
    for key in JSON_COLUMNS:
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    return json.loads(json.dumps(result, cls=DjangoJSONEncoder))


def _write(table, key, identity, values):
    fields = [key, *[name for name in values if name != key]]
    params = [identity, *[Jsonb(values[name]) if isinstance(values[name], (dict, list)) else values[name]
                          for name in fields[1:]]]
    assignments = sql.SQL(', ').join(sql.SQL('{}=excluded.{}').format(sql.Identifier(name), sql.Identifier(name))
                                   for name in fields[1:] if name != 'created_at')
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL('INSERT INTO curriculum.{} ({}) VALUES ({}) ON CONFLICT ({}) DO UPDATE SET {} RETURNING *').format(
            sql.Identifier(table), sql.SQL(', ').join(map(sql.Identifier, fields)),
            sql.SQL(', ').join(sql.Placeholder() for _ in fields), sql.Identifier(key), assignments), params)
        return _rows(cursor)[0]


def upsert(table, values):
    """Return an independent saved row, or None when ordinary storage owns it.

    Call inside the normal authoring transaction. This function never writes to
    modules/weeks/components and never creates an upload request.
    """
    if table not in TABLES or not enabled():
        return None
    reference = values.get('module_catalogue_id')
    owner = course(reference, lock=True)
    creating = table == 'modules' and values.get('source_type') == 'free_course'
    if owner is None and not creating:
        if native_only():
            raise ValueError('The free-course content owner does not exist.')
        return None
    row = _data(values)
    if table == 'modules':
        if row.get('source_type') not in (None, 'free_course'):
            raise ValueError('Use the free-course conversion workflow to move this course into a programme.')
        for field in ('programme_id', 'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name'):
            if str(row.get(field) or '').strip().lower() not in ('', 'unassigned', 'unassigned programme'):
                raise ValueError('An independent free course cannot have a programme, cohort or group.')
        if owner is None:
            identifier = 'FC-' + hashlib.sha256(str(reference).encode()).hexdigest()[:32]
            owner = {'id': identifier, 'authoring_data': {}}
        data = {**{'quality_score': 0, 'is_programme_deleted': False, 'session_overrides': {},
                    'sessions_number': 0, 'learner_roster_mode': 'manual'}, **owner['authoring_data'], **row}
        data.update(source_type='free_course', learner_roster_mode='manual')
        direct = {'title': 'course_name', 'description': 'description', 'cover_image_url': 'cover_image_url',
                  'total_otjh': 'total_otjh', 'is_for_sale': 'is_for_sale', 'price': 'price', 'currency': 'currency',
                  'weeks_number': 'week_count', 'created_at': 'created_at', 'updated_at': 'updated_at', 'deleted_at': 'deleted_at'}
        fields = {destination: row[name] for name, destination in direct.items() if name in row}
        fields.update(content_ref=reference, authoring_data=data, managed_by_builder=True, storage_version=2)
        _write('free_courses', 'id', owner['id'], fields)
    elif table in ('weeks', 'components'):
        physical = TABLES[table][1]
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL('SELECT * FROM curriculum.{} WHERE content_ref=%s').format(sql.Identifier(physical)), [row['id']])
            existing = next(iter(_rows(cursor)), None)
        data = {**{'is_programme_deleted': False, 'library_state': '', 'display_order': 0},
                **((existing or {}).get('authoring_data') or {}), **row}
        if table == 'weeks':
            if existing and existing['course_id'] != owner['id']:
                raise ValueError('This week belongs to another course.')
            direct = {'week_number': 'week_number', 'title': 'week_title', 'display_order': 'display_order',
                      'created_at': 'created_at', 'updated_at': 'updated_at', 'deleted_at': 'deleted_at'}
            fields = {destination: row[name] for name, destination in direct.items() if name in row}
            fields.update(course_id=owner['id'], course_name=owner.get('course_name', ''),
                          content_ref=row['id'], authoring_data=data)
            if not existing:
                fields['week_id'] = row['id']
        else:
            with connection.cursor() as cursor:
                cursor.execute('SELECT id FROM curriculum.free_course_weeks WHERE content_ref=%s AND course_id=%s',
                               [row['week_id'], owner['id']])
                week = cursor.fetchone()
                if not week:
                    raise ValueError('This component week does not belong to the course.')
                if existing:
                    cursor.execute('SELECT course_id FROM curriculum.free_course_weeks WHERE id=%s', [existing['free_module_id']])
                    if cursor.fetchone()[0] != owner['id']:
                        raise ValueError('This component belongs to another course.')
            direct = ('type', 'title', 'description', 'expected_otjh', 'points', 'reflection_required',
                      'workplace_evidence_required', 'tutor_validation_required', 'display_order', 'settings_json',
                      'created_at', 'updated_at', 'deleted_at')
            fields = {name: row[name] for name in direct if name in row}
            fields.update(free_module_id=week[0], week_id=row['week_id'], programme_id='FREE-COURSES',
                          content_ref=row['id'], authoring_data=data)
        _write(physical, 'id', existing['id'] if existing else row['id'], fields)
    else:
        field = {'module_details': 'details_json', 'module_completion_criteria': 'completion_json',
                 'ksb_mappings': 'ksb_mappings'}[table]
        if table == 'ksb_mappings':
            rows = list(owner.get(field) or [])
            old = next((item for item in rows if item['id'] == row['id']), {})
            data = [item for item in rows if item['id'] != row['id']] + [{**old, **row}]
        else:
            data = {**(owner.get(field) or {}), **row}
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL('UPDATE curriculum.free_courses SET {}=%s WHERE id=%s').format(sql.Identifier(field)),
                           [Jsonb(data), owner['id']])
    key = 'id' if table in ('weeks', 'components', 'ksb_mappings') else 'module_catalogue_id'
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT * FROM {native_read_table(table)} WHERE "{key}"=%s', [row[key]])
        return _rows(cursor)[0]


def update(table, where, params, values):
    saved = []
    for row in free_rows(table, where, params):
        saved.append(upsert(table, {**row, **values}))
    return saved


def refresh_totals(reference):
    owner = course(reference)
    if not owner:
        return
    with connection.cursor() as cursor:
        cursor.execute('''UPDATE curriculum.free_course_weeks w SET
            component_count=(SELECT count(*) FROM curriculum.free_programme_components c WHERE c.free_module_id=w.id AND c.deleted_at IS NULL),
            total_otjh=(SELECT coalesce(sum(c.expected_otjh),0) FROM curriculum.free_programme_components c WHERE c.free_module_id=w.id AND c.deleted_at IS NULL)
            WHERE w.course_id=%s''', [owner['id']])
        cursor.execute('''UPDATE curriculum.free_courses f SET
            week_count=(SELECT count(*) FROM curriculum.free_course_weeks w WHERE w.course_id=f.id AND w.deleted_at IS NULL),
            component_count=(SELECT coalesce(sum(w.component_count),0) FROM curriculum.free_course_weeks w WHERE w.course_id=f.id AND w.deleted_at IS NULL)
            WHERE f.id=%s''', [owner['id']])
