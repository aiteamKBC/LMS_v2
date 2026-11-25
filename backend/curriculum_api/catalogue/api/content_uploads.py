"""Content upload and module material HTTP contracts; storage is an explicit capability.

Dependencies are supplied at the existing composition seam; no legacy views import.
"""


def curriculum_component_upload(
    request,
    component_id,
    *,
    COMPONENT_UPLOAD_EXTENSIONS,
    JsonResponse,
    clean_str,
    component_upload_metadata,
    frontend_component_type,
    json_error,
    logger,
    update_component_upload_settings,
):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    component_id = clean_str(component_id)
    uploaded_file = request.FILES.get('file')
    if not uploaded_file:
        return json_error('No file was uploaded.', status=400)

    component_type = frontend_component_type(request.POST.get('componentType') or request.POST.get('type'))
    if component_type not in COMPONENT_UPLOAD_EXTENSIONS:
        return json_error('Uploads are only supported for reading, podcast, PowerPoint and assignment components.', status=400)

    module_catalogue_id = clean_str(request.POST.get('moduleCatalogueId') or request.POST.get('moduleId') or 'module')
    try:
        metadata, error = component_upload_metadata(module_catalogue_id, component_id, component_type, uploaded_file)
    except Exception:
        logger.exception('Unable to store upload for curriculum component %s.', component_id)
        return json_error(
            'The file could not be stored. Please retry the upload.',
            status=503,
        )
    if error:
        return json_error(error, status=400)

    # Topic uploads are attached by the editor on Save, preserving other resources.
    saved_to_component = False if component_type == 'assignment' and request.POST.get('topicResource') == 'true' else update_component_upload_settings(component_id, component_type, metadata)
    return JsonResponse({
        'uploaded': True,
        'savedToComponent': saved_to_component,
        'componentId': component_id,
        'moduleCatalogueId': module_catalogue_id,
        'file': metadata,
    }, status=201)


def curriculum_week_component_upload(
    request,
    component_id,
    *,
    COMPONENT_UPLOAD_EXTENSIONS,
    JsonResponse,
    clean_str,
    component_upload_metadata,
    frontend_component_type,
    json_error,
    logger,
):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    component_id = clean_str(component_id)
    uploaded_file = request.FILES.get('file')
    if not uploaded_file:
        return json_error('No file was uploaded.', status=400)

    component_type = frontend_component_type(request.POST.get('componentType') or request.POST.get('type')) or 'reading'
    if component_type not in COMPONENT_UPLOAD_EXTENSIONS:
        return json_error('Uploads are only supported for reading, podcast, PowerPoint and assignment components.', status=400)

    # Week template components live in their own table (not the module builder's
    # `components` table), and are saved wholesale on the next Save rather than
    # patched row-by-row — so this just stores the file and hands back its
    # metadata; the frontend writes it into the component's own settings and
    # persists it the normal way.
    try:
        metadata, error = component_upload_metadata('week-template', component_id, component_type, uploaded_file)
    except Exception:
        logger.exception('Unable to store upload for week component %s.', component_id)
        return json_error(
            'The file could not be stored. Please retry the upload.',
            status=503,
        )
    if error:
        return json_error(error, status=400)

    return JsonResponse({'uploaded': True, 'componentId': component_id, 'file': metadata}, status=201)


def ai_material_response(module_catalogue_id, record, *, JsonResponse, **extra):
    return JsonResponse({
        'moduleCatalogueId': module_catalogue_id,
        'hasMaterial': bool(record),
        'material': record,
        **extra,
    })


def curriculum_module_ai_material(
    request,
    module_catalogue_id,
    *,
    AI_MATERIAL_COLUMN,
    AI_MATERIAL_UPLOAD_EXTENSIONS,
    AI_MATERIAL_UPLOAD_SLOT,
    AUTHORING_ADVANCED_TABLE,
    ai_material_record,
    ai_material_response,
    authoring_upsert,
    clean_str,
    component_upload_metadata,
    datetime,
    ensure_module_authoring_tables,
    has_column,
    invalidate_curriculum_cache,
    json_db_value,
    json_error,
    logger,
    mimetypes,
    upload_storage,
):
    """Read, upload/replace or remove a module's AI Material book.

    The bytes go through ``upload_storage`` exactly like a component upload, so
    they land in the curriculum container in Azure and are served back by the
    existing ``/curriculum_api/curriculum/uploads/...`` route -- which already
    streams byte ranges for the PDF viewer and frames Office files through the
    Office Online viewer. Nothing here talks to Azure directly.

    A replace deletes the blob it replaced only *after* the new one is stored and
    recorded, so a failed upload leaves the previous book intact and readable.
    """
    module_catalogue_id = clean_str(module_catalogue_id)
    if not module_catalogue_id:
        return json_error('A module is required.', status=400)

    # authoring_upsert drops any key that is not a column, so without this the
    # book would upload, report success and be forgotten. Say so instead.
    ensure_module_authoring_tables()
    if not has_column(AUTHORING_ADVANCED_TABLE, AI_MATERIAL_COLUMN):
        return json_error(
            'AI Material storage is not set up on this database yet. '
            'Add the ai_material column to curriculum.module_details and retry.',
            status=503,
        )

    if request.method == 'GET':
        return ai_material_response(module_catalogue_id, ai_material_record(module_catalogue_id))

    if request.method == 'DELETE':
        previous = ai_material_record(module_catalogue_id)
        if not previous:
            return ai_material_response(module_catalogue_id, None, removed=False)
        authoring_upsert(AUTHORING_ADVANCED_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_catalogue_id,
            AI_MATERIAL_COLUMN: json_db_value({}),
        })
        try:
            upload_storage.delete(previous.get('storedPath'))
        except Exception:
            logger.warning(
                'Removed the AI material record for %s but its blob could not be deleted.',
                module_catalogue_id, exc_info=True,
            )
        invalidate_curriculum_cache()
        return ai_material_response(module_catalogue_id, None, removed=True)

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    uploaded_file = request.FILES.get('file')
    if not uploaded_file:
        return json_error('No file was uploaded.', status=400)

    previous = ai_material_record(module_catalogue_id)
    try:
        metadata, error = component_upload_metadata(
            module_catalogue_id,
            AI_MATERIAL_UPLOAD_SLOT,
            'AI material',
            uploaded_file,
            allowed_extensions=AI_MATERIAL_UPLOAD_EXTENSIONS,
        )
    except Exception:
        logger.exception('Unable to store the AI material book for module %s.', module_catalogue_id)
        return json_error('The book could not be stored. Please retry the upload.', status=503)
    if error:
        return json_error(error, status=400)

    record = {
        'fileName': metadata['fileName'],
        'storedPath': metadata['storedPath'],
        'url': metadata['url'],
        'size': metadata['size'],
        'contentType': metadata['contentType'] or mimetypes.guess_type(metadata['fileName'])[0] or '',
        'uploadedAt': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
    }
    try:
        authoring_upsert(AUTHORING_ADVANCED_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_catalogue_id,
            AI_MATERIAL_COLUMN: json_db_value(record),
        })
    except Exception:
        # The bytes are in the container but nothing points at them. Drop them
        # rather than leave an orphan, and keep the book that is still recorded.
        logger.exception('Unable to record the AI material book for module %s.', module_catalogue_id)
        try:
            upload_storage.delete(metadata['storedPath'])
        except Exception:
            logger.warning('Could not clean up the unrecorded AI material blob for %s.', module_catalogue_id)
        return json_error('The book was uploaded but could not be saved to the module. Please retry.', status=503)

    replaced = bool(previous and previous.get('storedPath') != record['storedPath'])
    if replaced:
        try:
            upload_storage.delete(previous.get('storedPath'))
        except Exception:
            logger.warning(
                'Stored a replacement AI material book for %s but the old blob remains.',
                module_catalogue_id, exc_info=True,
            )
    invalidate_curriculum_cache()
    return ai_material_response(
        module_catalogue_id, record, replaced=replaced, uploaded=True,
    )
