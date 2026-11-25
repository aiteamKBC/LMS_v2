"""Legacy edit orchestration inside the caller-owned lock/transaction scope."""
from ..domain.free_course_structure_edits import _delta


def edit_structure(method, course_id, course, module_id, kind, item_id, payload, *,
    lock_module_structure_row, _active_module, collaboration_configuration, refuse_stale_module_write, read_module_structure_with_revision, requested_expected_revision, forward_save, reply, json_error, saved_payload, save_failed):
    lock_module_structure_row(module_id)
    if not _active_module(course):
        return json_error('Free course not found or already converted.', status=404)
    if kind == 'collaboration':
        return collaboration_configuration(module_id)
    if method != 'GET':
        refused = refuse_stale_module_write(payload, module_id)
        if refused is not None:
            return refused
    stored = read_module_structure_with_revision(module_id)
    if not stored:
        return json_error('Free course not found.', status=404)
    if method == 'GET':
        if kind == 'structure':
            return reply({**stored, 'courseId': course_id, 'moduleCatalogueId': module_id})
        items = stored.get('weekStructure') or []
        if kind == 'component':
            items = [c for w in items for c in w.get('components') or []]
        item = next((item for item in items if item['id'] == item_id), None)
        if item is None:
            return json_error('Item not found in this free course.', status=404)
        return reply({kind: item, 'courseId': course_id, 'moduleCatalogueId': module_id,
                       'structureRevision': stored['structureRevision']})
    if kind == 'structure':
        body = {**payload, 'expectedRevision': requested_expected_revision(payload)}
    else:
        payload = {**payload, 'expectedRevision': requested_expected_revision(payload)}
        body, item_id = _delta(stored, kind, item_id, payload, method)
    response = forward_save(module_id, body)
    if save_failed(response):
        return response
    saved = saved_payload(response)
    return reply({**saved, 'courseId': course_id, 'moduleCatalogueId': module_id,
                   **({'itemId': item_id} if item_id else {}),
                   **({'deleted': True, 'permanent': False} if method == 'DELETE' else {})},
                  status=201 if method == 'POST' else 200)
