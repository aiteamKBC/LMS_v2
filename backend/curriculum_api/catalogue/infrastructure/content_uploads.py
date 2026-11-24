"""Upload storage metadata, locked attachment updates and material record reads.

Dependencies are supplied at the existing composition seam; no legacy views import.
"""

from curriculum_api.catalogue.domain.content_validation import frontend_component_type as _default_frontend_component_type
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value


def safe_upload_segment(value, fallback, *, clean_str=_default_clean_str, get_valid_filename):
    text = get_valid_filename(clean_str(value)).strip('._-')
    return text[:96] or fallback


def component_upload_metadata(
    module_catalogue_id,
    component_id,
    component_type,
    uploaded_file,
    allowed_extensions=None,
    *,
    COMPONENT_UPLOAD_EXTENSIONS,
    COMPONENT_UPLOAD_MAX_BYTES,
    COMPONENT_UPLOAD_ROOT,
    Path,
    datetime,
    frontend_component_type=_default_frontend_component_type,
    get_valid_filename,
    safe_upload_segment,
    upload_storage,
):
    """Store one authoring upload and describe where it landed.

    ``allowed_extensions`` overrides the per-component-type list for uploads that
    are not a week component at all -- the module's AI material book is stored
    through the same container, path shape and serving route, but its own file
    types have nothing to do with a component type.
    """
    module_catalogue_id = safe_upload_segment(module_catalogue_id, 'module')
    component_id = safe_upload_segment(component_id, 'component')
    component_type = frontend_component_type(component_type)
    original_name = get_valid_filename(uploaded_file.name or 'upload')
    suffix = Path(original_name).suffix.lower()
    allowed = set(allowed_extensions) if allowed_extensions else COMPONENT_UPLOAD_EXTENSIONS.get(component_type, set())
    if suffix not in allowed:
        return None, f'{component_type} uploads must use one of: {", ".join(sorted(allowed))}.'
    if uploaded_file.size > COMPONENT_UPLOAD_MAX_BYTES:
        return None, 'File is too large. Maximum upload size is 300 MB.'

    # Microseconds make the path unique even when the same component retries or
    # replaces a same-named resource within one second.
    timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S%f')
    stem = safe_upload_segment(Path(original_name).stem, 'resource')
    stored_name = f'{stem}-{timestamp}{suffix}'
    relative_path = f'{COMPONENT_UPLOAD_ROOT}/{module_catalogue_id}/{component_id}/{stored_name}'
    # Azure when it is configured, local disk when it is not — see upload_storage.
    saved_path = upload_storage.store(
        uploaded_file, relative_path, uploaded_file.content_type or '',
    )
    public_path = saved_path.removeprefix(f'{COMPONENT_UPLOAD_ROOT}/')
    return {
        'fileName': original_name,
        'storedPath': saved_path,
        'url': f'/curriculum_api/curriculum/uploads/{public_path}',
        'size': uploaded_file.size,
        'contentType': uploaded_file.content_type or '',
        'componentType': component_type,
    }, ''


def update_component_upload_settings(
    component_id,
    component_type,
    metadata,
    *,
    AUTHORING_COMPONENTS_TABLE,
    _update_component_upload_settings,
    authoring_table_name,
    connection,
    transaction,
):
    with transaction.atomic():
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute(
                    f'select 1 from {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} where id = %s for update',
                    [component_id],
                )
                cursor.fetchall()
        return _update_component_upload_settings(component_id, component_type, metadata)


def ai_material_record(
    module_catalogue_id,
    *,
    AI_MATERIAL_COLUMN,
    AUTHORING_ADVANCED_TABLE,
    authoring_fetch_all,
    clean_str=_default_clean_str,
    parse_json_value=_default_parse_json_value,
):
    """The AI Material book stored against a module, or ``None``.

    The metadata is a JSON blob on ``curriculum.module_details`` rather than its
    own table: a module has at most one book, the row is already keyed by
    ``module_catalogue_id``, and the module save writes that row with a partial
    payload -- so a column it never names survives every save untouched.
    """
    rows = authoring_fetch_all(
        AUTHORING_ADVANCED_TABLE, 'module_catalogue_id = %s', [module_catalogue_id],
    )
    if not rows:
        return None
    stored = parse_json_value(rows[0].get(AI_MATERIAL_COLUMN), None)
    if not isinstance(stored, dict) or not clean_str(stored.get('storedPath')):
        return None
    return stored
