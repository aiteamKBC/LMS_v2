"""Component attachment settings and authoritative KSB mapping synchronization.

Dependencies are supplied at the existing composition seam; no legacy views import.
"""

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def _update_component_upload_settings(
    component_id,
    component_type,
    metadata,
    *,
    AUTHORING_COMPONENTS_TABLE,
    authoring_fetch_all,
    authoring_upsert,
    invalidate_curriculum_cache,
    json_db_value,
    normalise_component_settings_payload,
    parse_json_value,
):
    rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    if not rows:
        return False
    row = rows[0]
    settings_payload = normalise_component_settings_payload(component_type, parse_json_value(row.get('settings'), {}))
    updates = {
        'uploadedFileName': metadata['fileName'],
        'uploadedFileUrl': metadata['url'],
        'uploadedFileSize': metadata['size'],
        'uploadedFileContentType': metadata['contentType'],
        'uploadSource': 'Device upload',
    }
    if component_type == 'podcast':
        updates.update({'podcastSource': 'Device upload', 'podcastUrl': metadata['url']})
    if component_type == 'powerpoint':
        updates.update({'fileName': metadata['fileName'], 'presentationUrl': metadata['url']})
    if component_type == 'reading':
        updates.update({'readingSource': 'LMS resource', 'resourceUrl': metadata['url']})
    if component_type == 'assignment':
        updates.update({'assignmentFileName': metadata['fileName'], 'assignmentFileUrl': metadata['url']})
    authoring_upsert(AUTHORING_COMPONENTS_TABLE, ['id'], {
        **row,
        'settings': json_db_value({**settings_payload, **updates}),
    })
    invalidate_curriculum_cache()
    return True


def store_component_ksb_mappings(
    component,
    items,
    deleted_by,
    *,
    clean_str=_default_clean_str,
    sync_component_ksb_projection,
):
    """Make ``items`` (JSON mapping items) the component's KSB mappings.

    The list is handed to the projection directly. Re-reading the component
    for it would answer the mappings stored before this write: the normalised
    schema keeps no JSON copy on the component, so the copy written first is
    not there to read back.
    """
    component_id = clean_str((component or {}).get('id'))
    return sync_component_ksb_projection(
        component_id, component_row={**(component or {}), 'ksb_mappings': list(items or [])}, deleted_by=deleted_by,
    )


def sync_component_ksb_projection(
    component_id,
    component_row=None,
    module_row=None,
    week_id=None,
    deleted_by='component-ksb-sync',
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    authoring_bulk_upsert,
    authoring_fetch_all,
    authoring_soft_delete,
    clean_str=_default_clean_str,
    component_ksb_mappings_from_row,
    has_column,
    json_db_value,
    normalise_component_ksb_mappings,
    sync_progress_ksbs,
    update_authoring_rows,
):
    component_id = clean_str(component_id)
    if not component_id:
        return []
    rows = [component_row] if component_row else authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    if not rows:
        return []
    component = rows[0]
    module_catalogue_id = clean_str(component.get('module_catalogue_id'))
    week_id = clean_str(week_id or component.get('week_id'))
    module_row = module_row or (authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id]) or [{}])[0]
    mappings = component_ksb_mappings_from_row(component)
    json_items, projection_payloads = normalise_component_ksb_mappings(
        module_catalogue_id,
        mappings,
        week_id=week_id,
        component_id=component_id,
        module_row=module_row,
        enforce_unique=False,
    )
    if has_column(AUTHORING_COMPONENTS_TABLE, 'ksb_mappings'):
        # The component's JSON copy, where the schema still keeps one; the
        # ksb_mappings rows below are the record.
        update_authoring_rows(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id], {'ksb_mappings': json_db_value(json_items)})
    authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id], deleted_by=deleted_by)
    authoring_bulk_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], projection_payloads)
    sync_progress_ksbs({component_id: json_items}, actor=deleted_by)
    return json_items
