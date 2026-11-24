"""Persist an already validated staffing assignment using required module facts."""


class StaffingSourceUnavailable(RuntimeError):
    """Required module assignments could not be read before a staffing write."""


def save_staffing_assignment(
    group_id, payload, *, AUTHORING_MODULES_TABLE, canonical_group_coaches,
    canonical_staff_assignment_name, datetime, invalidate_curriculum_cache,
    notify_staff_assignment_change, read_staffing_module_ids, resolve_staff_assignment_email,
    update_authoring_rows, update_group_fields,
):
    module_assignment_ids = read_staffing_module_ids(group_id) if 'tutor' in payload else []
    updates = {}
    if 'coach' in payload:
        updates['coach_name'] = canonical_group_coaches(payload.get('coach'))
    update_group_fields(group_id, updates)

    next_tutor = canonical_staff_assignment_name('tutor', payload.get('tutor')) if 'tutor' in payload else ''
    next_tutor_email = resolve_staff_assignment_email('tutor', next_tutor) if next_tutor else ''
    if 'tutor' in payload:
        for module_id in module_assignment_ids:
            update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], {
                'tutor_name': next_tutor or None,
                'tutor_email': next_tutor_email or None,
                'updated_at': datetime.utcnow(),
            })
    notify_staff_assignment_change()
    invalidate_curriculum_cache()
    return {'updated': True, 'id': group_id}
