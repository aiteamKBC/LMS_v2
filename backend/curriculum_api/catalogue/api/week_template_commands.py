"""Week template HTTP validation, revision checks, archive and response construction.

Explicit capabilities preserve existing caller contracts during migration.
No views, settings or provider runtime is imported here.
"""


def curriculum_week_template_collection(
    request,
    *,
    WEEK_TEMPLATES_TABLE,
    WEEK_TEMPLATE_COURSE_TYPES,
    clean_str,
    curriculum_results_response,
    datetime,
    ensure_week_template_tables,
    get_week_template_rows,
    insert_row,
    invalidate_curriculum_cache,
    json_body,
    json_db_value,
    json_error,
    save_week_template_components,
    unique_prefixed_id,
    week_template_component_metrics,
    week_template_detail_response,
    week_template_payload,
    week_template_scope_fields,
):
    ensure_week_template_tables()
    if request.method == 'GET':
        from ..application.week_templates import list_week_template_payloads
        return curriculum_results_response(list_week_template_payloads(
            request.GET.get, clean_str=clean_str, WEEK_TEMPLATE_COURSE_TYPES=WEEK_TEMPLATE_COURSE_TYPES,
            get_week_template_rows=get_week_template_rows, week_template_payload=week_template_payload,
        ))

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    course_type = clean_str(payload.get('courseType')).lower() or 'paid'
    if course_type not in WEEK_TEMPLATE_COURSE_TYPES:
        return json_error('courseType must be "paid" or "free".', fields=['courseType'])
    if not clean_str(payload.get('title')):
        return json_error('Missing required fields.', fields=['title'])
    # Scope is optional. A week template used to be required to name a
    # programme, module and group up front, which forced that decision before
    # the author had written anything -- and it is not a decision the template
    # needs: the library lists every template regardless, and scope only drives
    # the group lock in the editor. Templates that carry it keep it; one saved
    # without it is a perfectly good template that has not been pointed at a
    # module yet.

    components = payload.get('components') if isinstance(payload.get('components'), list) else []
    total_otjh, points, component_count = week_template_component_metrics(components)
    existing_ids = [row.get('id') for row in get_week_template_rows()]
    template_id = unique_prefixed_id('WT', payload.get('id'), existing_ids)

    insert_row(WEEK_TEMPLATES_TABLE, {
        'id': template_id,
        'title': clean_str(payload.get('title')),
        'summary': clean_str(payload.get('summary')),
        'learning_outcomes': json_db_value(payload.get('learningOutcomes') or []),
        'course_type': course_type,
        **week_template_scope_fields(payload, course_type),
        'status': clean_str(payload.get('status')) or 'draft',
        'total_otjh': total_otjh,
        'points': points,
        'component_count': component_count,
        'author': clean_str(payload.get('author')),
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    })
    if components:
        save_week_template_components(template_id, components)
    invalidate_curriculum_cache()
    return week_template_detail_response(template_id, after_write=True, created=True)


def curriculum_week_template_detail(
    request,
    identifier,
    *,
    JsonResponse,
    WEEK_TEMPLATES_TABLE,
    WEEK_TEMPLATE_COURSE_TYPES,
    clean_str,
    datetime,
    get_week_template_row,
    invalidate_curriculum_cache,
    json_body,
    json_db_value,
    json_error,
    lock_record_row,
    record_conflict_response,
    requested_expected_revision,
    save_week_template_components,
    soft_delete_rows,
    transaction,
    update_rows,
    week_template_component_metrics,
    week_template_detail_response,
    week_template_record,
    week_template_revision,
    week_template_scope_fields,
):
    if request.method not in {'GET', 'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    row = get_week_template_row(identifier)
    if not row:
        return json_error('Week template not found.', status=404)

    if request.method == 'GET':
        return week_template_detail_response(identifier)

    if request.method == 'DELETE':
        # Archive, never destroy: a week template is reusable content by
        # definition, and this used to be the one hard delete in the authoring
        # surface. Its components are left attached to it so a future restore
        # gets a whole template back rather than an empty shell.
        soft_delete_rows(WEEK_TEMPLATES_TABLE, 'id = %s', [identifier], deleted_by='week-template-delete')
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'permanent': False, 'id': identifier})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    if 'title' in payload and not clean_str(payload.get('title')):
        return json_error('Title cannot be blank.', fields=['title'])

    course_type = clean_str(payload.get('courseType')).lower() or (row.get('course_type') or 'paid')
    if course_type not in WEEK_TEMPLATE_COURSE_TYPES:
        return json_error('courseType must be "paid" or "free".', fields=['courseType'])

    updates = {'updated_at': datetime.utcnow(), 'course_type': course_type}
    if 'title' in payload:
        updates['title'] = clean_str(payload.get('title'))
    if 'summary' in payload:
        updates['summary'] = clean_str(payload.get('summary'))
    if 'learningOutcomes' in payload:
        updates['learning_outcomes'] = json_db_value(payload.get('learningOutcomes') or [])
    if 'status' in payload:
        updates['status'] = clean_str(payload.get('status')) or 'draft'
    if 'author' in payload:
        updates['author'] = clean_str(payload.get('author'))
    # Re-apply scope whenever course type is sent (switching to free clears it)
    # or when any scope field is provided.
    if 'courseType' in payload or any(key in payload for key in ('programmeId', 'programmeName', 'moduleCatalogueId', 'groupId', 'groupName')):
        updates.update(week_template_scope_fields(payload, course_type))

    components_provided = isinstance(payload.get('components'), list)
    if components_provided:
        components = payload.get('components')
        total_otjh, points, component_count = week_template_component_metrics(components)
        updates.update({'total_otjh': total_otjh, 'points': points, 'component_count': component_count})

    # Optimistic concurrency, opt-in, exactly as the module structure PATCH
    # does it. A components list replaces every component row this template
    # owns, so a second editor's save landing on a version they never saw takes
    # the first editor's whole afternoon with it.
    expected_revision = requested_expected_revision(request, payload)
    # One transaction around the check and the write. See lock_record_row:
    # read-then-write would let two saves that read the same revision both pass.
    with transaction.atomic():
        if expected_revision:
            lock_record_row(WEEK_TEMPLATES_TABLE, 'id = %s', [identifier])
            current_revision = week_template_revision(identifier)
            if current_revision != expected_revision:
                # The stored template travels with the refusal so the editor can
                # rebase without a second call. Nothing has been written.
                return record_conflict_response(
                    expected_revision,
                    current_revision,
                    weekTemplate=week_template_record(identifier),
                )
        update_rows(WEEK_TEMPLATES_TABLE, 'id = %s', [identifier], updates)
        if components_provided:
            save_week_template_components(identifier, payload.get('components'))
    invalidate_curriculum_cache()
    # after_write: the revision handed back has to describe this save, not the
    # state it landed on.
    return week_template_detail_response(identifier, after_write=True, updated=True)
