"""Plan and apply insert-only catalogue content imports through explicit capabilities."""
from copy import deepcopy
from curriculum_api.legacy_free_course_migration import adopted_id
from curriculum_api.catalogue.domain.content_values import component_expected_otjh_minutes
from curriculum_api.catalogue.domain.content_values import otjh_hours_from_minutes


def import_plan(export, *, storage, import_payloads, validate_module_authoring_payload):
    existing = {r['id'] for r in storage.free_programme_fetch_all(storage.FREE_COURSES_TABLE, columns=['id'])}
    native = {r['module_catalogue_id'] for r in storage.authoring_fetch_all(storage.AUTHORING_MODULES_TABLE,
                                                                  columns=['module_catalogue_id'])}
    planned, skipped = [], 0
    for course, payload in import_payloads(export):
        if course['id'] in existing:
            skipped += 1
            continue
        if payload['catalogueId'] in native:
            raise ValueError('An imported module identity is already in use; no content was changed.')
        errors = validate_module_authoring_payload(deepcopy(payload))
        if errors:
            messages = sorted({error['message'] for error in errors})
            raise ValueError('Imported content validation failed: ' + '; '.join(messages))
        planned.append((course, payload))
    new_ids = {course['id'] for course, _ in planned}
    new_links = {row['id'] for row in export['week_links'] if row['course_id'] in new_ids}
    new_components = {row['id'] for row in export['components'] if row['free_module_id'] in new_links}
    for table, selected, key in (
        (storage.FREE_PROGRAMME_MODULES_TABLE, new_links, 'id'),
        (storage.FREE_PROGRAMME_COMPONENTS_TABLE, new_components, 'id'),
        (storage.AUTHORING_WEEKS_TABLE, {w['id'] for _, p in planned for w in p['weekStructure']}, 'id'),
        (storage.AUTHORING_COMPONENTS_TABLE, {c['id'] for _, p in planned for w in p['weekStructure'] for c in w['components']}, 'id'),
    ):
        if selected and selected.intersection(row[key] for row in storage.authoring_fetch_all(table, columns=[key])):
            raise ValueError('Imported content identity is already owned by another course; no content was changed.')
    return planned, {
        'coursesToImport': len(planned), 'existingCoursesPreserved': skipped,
        'weeksToImport': sum(len(p['weekStructure']) for _, p in planned),
        'componentsToImport': sum(len(w['components']) for _, p in planned for w in p['weekStructure']),
    }


def import_content(export, *, storage, import_plan, save_module_authoring_structure, get_authoring_structure_payload, invalidate_curriculum_cache):
    storage.require_legacy_mode()
    if storage.vendor() != 'postgresql' or not storage.has_column(storage.FREE_COURSES_TABLE, 'module_catalogue_id'):
        raise ValueError('Apply migration 0080 before importing free-course content.')
    with storage.atomic():
        storage.lock_import()
        planned, counts = import_plan(export)
        for course, original_payload in planned:
            payload = deepcopy(original_payload)
            # No storage upload, email, enrolment, or Teams side effect. Existing
            # artwork is restored directly after content creation.
            cover = payload.pop('coverImage', '')
            storage.free_programme_upsert(storage.FREE_COURSES_TABLE, ['id'], {
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
                storage.free_programme_upsert(storage.FREE_PROGRAMME_MODULES_TABLE, ['id'], {
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
                          'settings_json': storage.json_db_value(component.get('settings_json') or {})}
                storage.free_programme_upsert(storage.FREE_PROGRAMME_COMPONENTS_TABLE, ['id'], values)
            save_module_authoring_structure(payload['catalogueId'], payload,
                                              repair_links=False, build_result=False)
            if cover:
                storage.update_authoring_rows(storage.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s',
                                        [payload['catalogueId']], {'cover_image_url': cover})
            for link in links.values():
                if source_weeks[link['week_id']].get('status') != 'inactive':
                    continue
                week_id = adopted_id('WEEK', course['id'], link['id'])
                storage.authoring_soft_delete(storage.AUTHORING_WEEKS_TABLE, 'id = %s', [week_id],
                                        deleted_by='branch-content-import')
                storage.authoring_soft_delete(storage.AUTHORING_COMPONENTS_TABLE, 'week_id = %s', [week_id],
                                        via_parent=f'week:{week_id}', deleted_by='branch-content-import')
            # Apply the ordinary active-content total after retaining inactive
            # branch weeks in the archive. No learner hours are generated.
            active = get_authoring_structure_payload(payload['catalogueId'])
            total = otjh_hours_from_minutes(sum(component_expected_otjh_minutes(component)
                for week in active['weekStructure'] for component in week['components']))
            storage.update_authoring_rows(storage.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s',
                                    [payload['catalogueId']], {'total_otjh': total})
        storage.on_commit(invalidate_curriculum_cache)
    return counts
