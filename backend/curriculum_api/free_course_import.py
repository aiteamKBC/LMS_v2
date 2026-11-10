"""Import catalogue CONTENT, never assignments or completions, from an export.

Existing course IDs always win, including archived or converted courses. Stable
native IDs and a transaction make retries safe without replaying branch edits.
"""
from collections import defaultdict
from copy import deepcopy

from django.db import connection, transaction

from .legacy_free_course_migration import adopted_id, course_payload
from .free_course_writer_mode import LEGACY, require_mode


def import_payloads(export):
    from . import views as v
    def index(rows, label):
        result = {row['id']: row for row in rows}
        if len(result) != len(rows) or any(not ident for ident in result):
            raise ValueError(f'Duplicate or missing {label} identity.')
        return result

    courses = index(export['courses'], 'course')
    links = index(export['week_links'], 'week link')
    weeks = index(export['weeks'], 'week')
    components = index(export['components'], 'component')
    by_link = defaultdict(list)
    for component in components.values():
        link = links.get(component['free_module_id'])
        if not link or component.get('week_id') != link.get('week_id'):
            raise ValueError('A component does not belong to its exported week.')
        by_link[link['id']].append(component)
    by_course = defaultdict(list)
    for link in links.values():
        week = weeks.get(link['week_id'])
        if link['course_id'] not in courses or not week or week.get('free_course_id') != link['course_id']:
            raise ValueError('A week does not belong to its exported course.')
        merged = {**link, 'week_number': week['week_number'], 'week_title': week['title']}
        response = v.free_programme_module_response(merged, by_link[link['id']], courses[link['course_id']])
        by_course[link['course_id']].append(response)
    result = []
    for course in courses.values():
        payload = course_payload(course, by_course[course['id']])
        source_by_native = {adopted_id('WEEK', course['id'], link['id']): weeks[link['week_id']]
                            for link in links.values() if link['course_id'] == course['id']}
        for week in payload['weekStructure']:
            source = source_by_native[week['id']]
            week.update(summary=source.get('summary') or '',
                        learningOutcomes=source.get('learning_outcomes') or [],
                        holidayNoteEnabled=bool(source.get('holiday_note_enabled')),
                        holidayNote=source.get('holiday_note') or '')
            # A branch-local copied_from_id may identify a template absent from
            # this database. Keep provenance in the export, not a dangling FK.
        result.append((course, payload))
    return result


def import_plan(export):
    from . import views as v
    existing = {r['id'] for r in v.free_programme_fetch_all(v.FREE_COURSES_TABLE, columns=['id'])}
    native = {r['module_catalogue_id'] for r in v.authoring_fetch_all(v.AUTHORING_MODULES_TABLE,
                                                                  columns=['module_catalogue_id'])}
    planned, skipped = [], 0
    for course, payload in import_payloads(export):
        if course['id'] in existing:
            skipped += 1
            continue
        if payload['catalogueId'] in native:
            raise ValueError('An imported module identity is already in use; no content was changed.')
        errors = v.validate_module_authoring_payload(deepcopy(payload))
        if errors:
            messages = sorted({error['message'] for error in errors})
            raise ValueError('Imported content validation failed: ' + '; '.join(messages))
        planned.append((course, payload))
    new_ids = {course['id'] for course, _ in planned}
    new_links = {row['id'] for row in export['week_links'] if row['course_id'] in new_ids}
    new_components = {row['id'] for row in export['components'] if row['free_module_id'] in new_links}
    for table, selected, key in (
        (v.FREE_PROGRAMME_MODULES_TABLE, new_links, 'id'),
        (v.FREE_PROGRAMME_COMPONENTS_TABLE, new_components, 'id'),
        (v.AUTHORING_WEEKS_TABLE, {w['id'] for _, p in planned for w in p['weekStructure']}, 'id'),
        (v.AUTHORING_COMPONENTS_TABLE, {c['id'] for _, p in planned for w in p['weekStructure'] for c in w['components']}, 'id'),
    ):
        if selected and selected.intersection(row[key] for row in v.authoring_fetch_all(table, columns=[key])):
            raise ValueError('Imported content identity is already owned by another course; no content was changed.')
    return planned, {
        'coursesToImport': len(planned), 'existingCoursesPreserved': skipped,
        'weeksToImport': sum(len(p['weekStructure']) for _, p in planned),
        'componentsToImport': sum(len(w['components']) for _, p in planned for w in p['weekStructure']),
    }


def import_content(export):
    require_mode(LEGACY)
    from . import views as v
    if connection.vendor != 'postgresql' or not v.has_column(v.FREE_COURSES_TABLE, 'module_catalogue_id'):
        raise ValueError('Apply migration 0080 before importing free-course content.')
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext('curriculum.free_course_content_import'))")
        planned, counts = import_plan(export)
        for course, original_payload in planned:
            payload = deepcopy(original_payload)
            # No storage upload, email, enrolment, or Teams side effect. Existing
            # artwork is restored directly after content creation.
            cover = payload.pop('coverImage', '')
            v.free_programme_upsert(v.FREE_COURSES_TABLE, ['id'], {
                'id': course['id'], 'course_name': course['course_name'],
                'description': course.get('description'), 'cover_image_url': cover,
                'course_type': course.get('course_type') or 'free',
                'display_order': course.get('display_order', 0),
                'created_at': course.get('created_at'),
            })
            source_weeks = {row['id']: row for row in export['weeks']}
            links = {row['id']: row for row in export['week_links'] if row['course_id'] == course['id']}
            for link in links.values():
                source = source_weeks[link['week_id']]
                v.free_programme_upsert(v.FREE_PROGRAMME_MODULES_TABLE, ['id'], {
                    'id': link['id'], 'course_id': course['id'],
                    'week_id': adopted_id('WEEK', course['id'], link['id']),
                    'course_name': course['course_name'], 'week_number': source['week_number'],
                    'week_title': source['title'], 'display_order': link.get('display_order', 0),
                    'created_at': link.get('created_at'),
                })
            for component in export['components']:
                if component['free_module_id'] not in links:
                    continue
                values = {**component, 'programme_id': 'FREE-COURSES',
                          'week_id': adopted_id('WEEK', course['id'], component['free_module_id']),
                          'settings_json': v.json_db_value(component.get('settings_json') or {})}
                v.free_programme_upsert(v.FREE_PROGRAMME_COMPONENTS_TABLE, ['id'], values)
            v.save_module_authoring_structure(payload['catalogueId'], payload,
                                              repair_links=False, build_result=False)
            if cover:
                v.update_authoring_rows(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s',
                                        [payload['catalogueId']], {'cover_image_url': cover})
            for link in links.values():
                if source_weeks[link['week_id']].get('status') != 'inactive':
                    continue
                week_id = adopted_id('WEEK', course['id'], link['id'])
                v.authoring_soft_delete(v.AUTHORING_WEEKS_TABLE, 'id = %s', [week_id],
                                        deleted_by='branch-content-import')
                v.authoring_soft_delete(v.AUTHORING_COMPONENTS_TABLE, 'week_id = %s', [week_id],
                                        via_parent=f'week:{week_id}', deleted_by='branch-content-import')
            # Apply the ordinary active-content total after retaining inactive
            # branch weeks in the archive. No learner hours are generated.
            active = v.get_authoring_structure_payload(payload['catalogueId'])
            total = v.otjh_hours_from_minutes(sum(v.component_expected_otjh_minutes(component)
                for week in active['weekStructure'] for component in week['components']))
            v.update_authoring_rows(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s',
                                    [payload['catalogueId']], {'total_otjh': total})
        transaction.on_commit(v.invalidate_curriculum_cache)
    return counts
