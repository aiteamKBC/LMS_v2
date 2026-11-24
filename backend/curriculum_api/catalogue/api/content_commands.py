"""Component and KSB HTTP contracts with existing optimistic write guards.

Dependencies are supplied at the existing composition seam; no legacy views import.
"""


def curriculum_module_settings(
    request,
    module_catalogue_id,
    *,
    CoverImageError,
    JsonResponse,
    authoring_module_exists,
    clean_str,
    get_authoring_structure_payload,
    json_body,
    json_error,
    logger,
    module_structure_revision,
    refuse_stale_module_write,
    resolve_stored_module_catalogue_id,
    save_module_authoring_structure,
    transaction,
):
    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    # Resolved the same way every other module write resolves its target. Reading
    # the raw identifier meant a legacy or aliased id found nothing, and the
    # blank shell below was then saved as a brand new module: the real one kept
    # its old settings while a titleless ghost appeared in the catalogue.
    module_catalogue_id = resolve_stored_module_catalogue_id(module_catalogue_id) or clean_str(module_catalogue_id)
    if not authoring_module_exists(module_catalogue_id):
        # This endpoint only ever edits settings on a module that exists. A
        # missing one is a 404, never a create -- saving a shell here would
        # blank the weeks and components of whatever the id was meant to name.
        return json_error('Module not found.', status=404)
    try:
        with transaction.atomic():
            # Legacy endpoint with no screen of its own: it may only write
            # against the version it was made from, read under the lock, so it
            # can neither replace a newer title nor write back weeks it read
            # before somebody else's save.
            refused = refuse_stale_module_write(request, payload, module_catalogue_id)
            if refused is not None:
                return refused
            existing = get_authoring_structure_payload(module_catalogue_id)
            updates = {
                **existing,
                'programmeId': payload.get('programmeId') or existing.get('programmeId'),
                'programmeName': payload.get('programmeName') or payload.get('programme') or existing.get('programmeName'),
                'title': payload.get('title') or payload.get('name') or existing.get('title'),
                'description': payload.get('description') if 'description' in payload else existing.get('description'),
                'status': payload.get('status') or existing.get('status'),
                'declaredTotalOtjh': payload.get('totalOtjh') if 'totalOtjh' in payload else existing.get('declaredTotalOtjh'),
            }
            result = save_module_authoring_structure(module_catalogue_id, updates)
    except CoverImageError as exc:
        return json_error(str(exc), status=400)
    except Exception as exc:
        logger.exception('Unable to update module authoring settings for %s.', module_catalogue_id)
        return json_error('Unable to update module settings.', status=500, detail=str(exc))
    return JsonResponse({'updated': True, 'module': result, 'revision': module_structure_revision(module_catalogue_id)})


def refuse_stale_module_write(
    request,
    payload,
    module_catalogue_id,
    *,
    json_error,
    lock_module_structure_row,
    module_structure_revision,
    record_conflict_response,
    requested_expected_revision,
):
    """Lock a module and refuse a write not made against its current version.

    For the legacy single-item endpoints (settings, a component, a week, a KSB
    mapping) that no screen calls any more but that still write a module's
    rows. Each one used to write blind, so a script or an old client holding a
    copy from an hour ago could replace whatever had been authored since --
    the overwrite the Module Builder's revision exists to stop. They now need
    the same ``expectedRevision`` (or ``If-Match``) the structure save sends:
    428 without one, 409 with a stale one. Call inside ``transaction.atomic()``
    and write before it ends. Returns the refusal, or None to proceed.
    """
    expected_revision = requested_expected_revision(request, payload if isinstance(payload, dict) else {})
    if not expected_revision:
        return json_error(
            'This change needs the saved version of the module it was made against '
            '(expectedRevision). Open the module again and repeat the change.',
            status=428,
            conflict=True,
        )
    lock_module_structure_row(module_catalogue_id)
    current_revision = module_structure_revision(module_catalogue_id)
    if current_revision != expected_revision:
        return record_conflict_response(expected_revision, current_revision)
    return None


def guarded_module_item_write(
    request,
    module_catalogue_id,
    write,
    *,
    clean_str,
    json_body,
    refuse_stale_module_write,
    transaction,
):
    """Run a legacy single-item write under its module's lock and version check.

    ``write`` is the original handler; its own atomic blocks become savepoints
    inside this one, so the lock taken here is held until everything it wrote
    commits. Rows that belong to no module (library content) are not guarded.
    """
    module_catalogue_id = clean_str(module_catalogue_id)
    if not module_catalogue_id:
        return write()
    payload = json_body(request) if request.body else {}
    with transaction.atomic():
        refused = refuse_stale_module_write(request, payload or {}, module_catalogue_id)
        if refused is not None:
            return refused
        return write()


def curriculum_component_collection(
    request,
    *,
    JsonResponse,
    ModuleAuthoringValidationError,
    cached_curriculum_value,
    clean_str,
    component_builder_rows,
    component_rows_for_programme_page,
    component_rows_without_content,
    component_source_inputs_fingerprint,
    conditional_json_response,
    curriculum_results_response,
    encode_json_bytes,
    hashlib,
    json_body,
    json_error,
    logger,
    query_list,
    query_value,
    require_fields,
    save_component_builder_payload,
):
    if request.method == 'GET':
        try:
            raw_ids = request.GET.get('module_catalogue_ids') or request.GET.get('moduleCatalogueIds') or ''
            module_catalogue_ids = [clean_str(value) for value in raw_ids.split(',') if clean_str(value)]
            # ``omit=content``: see component_rows_without_content. Opt-in; any
            # other caller still gets every setting.
            omit_content = 'content' in query_list(request, 'omit')
            # ``fields=programme``: the programme page's projection, see
            # component_rows_for_programme_page. Opt-in like ``omit=content``.
            programme_view = 'programme' in query_list(request, 'fields')
            project = (
                component_rows_for_programme_page if programme_view
                else component_rows_without_content if omit_content else (lambda rows: rows)
            )
            if module_catalogue_ids:
                if query_value(request, 'page') or query_value(request, 'pageSize'):
                    return curriculum_results_response(component_builder_rows(
                        module_catalogue_ids, omit_content=omit_content, programme_view=programme_view,
                    ), request=request)
                # The programme page reads every component of the programme
                # here on each open -- ~17k rows with their settings for the
                # largest programme -- and nothing cached it. The rows are
                # authoring data, written only through curriculum handlers
                # that bump the epoch, so any edit retires this at once. The
                # one input that bumps nothing is the Skills England list a
                # mapping's source is inferred from (standard_ksbs, changed by
                # manual import), hence the same 60s bound coverage keeps.
                # Keyed on the sorted, de-duped id set: order never changes
                # the rows.
                ids = sorted({value for value in module_catalogue_ids})
                digest = hashlib.sha256('\x1f'.join(ids).encode()).hexdigest()[:32]
                variant = 'programme' if programme_view else 'nocontent' if omit_content else 'full'
                entry = cached_curriculum_value(
                    f'components-response:{variant}:{len(ids)}:{digest}',
                    lambda: encode_json_bytes(
                        curriculum_results_response(component_builder_rows(
                            module_catalogue_ids, omit_content=omit_content, programme_view=programme_view,
                        )).content,
                    ),
                    ttl=60,
                    # The programme read is the ~20k-row one: past its 60s it
                    # is re-checked against the KSB sources rather than rebuilt.
                    **({'fingerprint': component_source_inputs_fingerprint} if programme_view else {}),
                )
                return conditional_json_response(request, entry)
            return curriculum_results_response(
                project(cached_curriculum_value('components:builder', component_builder_rows)),
                request=request,
            )
        except Exception:
            logger.exception('Unable to load component builder rows.')
            return json_error('Unable to load component builder rows.', status=500)

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['title', 'module'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    try:
        component = save_component_builder_payload(payload)
    except ModuleAuthoringValidationError as exc:
        return json_error('Invalid component payload.', status=400, errors=exc.errors)
    except Exception as exc:
        logger.exception('Unable to create component builder component.')
        return json_error('Unable to create component.', status=500, detail=str(exc))
    return JsonResponse({'created': True, 'component': component}, status=201)


def curriculum_component_summary(
    request,
    *,
    CURRICULUM_SCHEMA,
    cached_curriculum_value,
    clean_str,
    component_source_inputs_fingerprint,
    component_summary_rows,
    conditional_json_response,
    encode_json_entry,
    hashlib,
    json_error,
    logger,
    request_bypasses_curriculum_cache,
):
    """The programme page's component figures without the components.

    Takes the same ``module_catalogue_ids`` the programme page sends to
    ``components/`` and answers with component_summary_rows(): one row per
    module/week bucket carrying counts and Expected OTJH minutes, instead of
    every component with its settings and KSB mappings. Cached and invalidated
    exactly as that read is -- the same epoch, and the same 60s bound for the
    one input no curriculum write bumps -- so the two can never disagree for
    longer than ``components/`` could already disagree with itself.
    """
    raw_ids = request.GET.get('module_catalogue_ids') or request.GET.get('moduleCatalogueIds') or ''
    ids = sorted({clean_str(value) for value in raw_ids.split(',') if clean_str(value)})
    if not ids:
        return json_error('module_catalogue_ids is required.', status=400)
    digest = hashlib.sha256('\x1f'.join(ids).encode()).hexdigest()[:32]
    try:
        entry = cached_curriculum_value(
            f'components-summary-response:{len(ids)}:{digest}',
            lambda: encode_json_entry({
                'schema': CURRICULUM_SCHEMA,
                'results': component_summary_rows(ids),
            }),
            force=request_bypasses_curriculum_cache(request),
            ttl=60,
            fingerprint=component_source_inputs_fingerprint,
        )
    except Exception:
        logger.exception('Unable to summarise components.')
        return json_error('Unable to summarise components.', status=500)
    return conditional_json_response(request, entry)


def curriculum_component_detail(
    request,
    component_id,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    JsonResponse,
    ModuleAuthoringValidationError,
    authoring_fetch_all,
    authoring_soft_delete,
    clean_str,
    component_builder_response,
    component_builder_rows,
    invalidate_curriculum_cache,
    json_body,
    json_error,
    logger,
    refuse_stale_module_write,
    save_component_builder_payload,
    transaction,
):
    component_id = clean_str(component_id)
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    existing = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    if not existing:
        return json_error('Component not found.', status=404)
    module_id = clean_str(existing[0].get('module_catalogue_id'))
    payload = json_body(request) if request.body else {}
    if payload is None:
        return json_error('Invalid JSON body.')

    if request.method == 'DELETE':
        with transaction.atomic():
            if module_id:
                refused = refuse_stale_module_write(request, payload, module_id)
                if refused is not None:
                    return refused
            authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id], via_parent=component_id, deleted_by='component-delete')
            authoring_soft_delete(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id], deleted_by='component-delete')
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'permanent': False, 'id': component_id})

    try:
        with transaction.atomic():
            if module_id:
                refused = refuse_stale_module_write(request, payload, module_id)
                if refused is not None:
                    return refused
            # Read under the lock, so the fields this PATCH does not name come
            # from the stored component rather than from before the lock.
            current = next((item for item in component_builder_rows([module_id] if module_id else None) if item['id'] == component_id), None)
            merged = {
                **(current or component_builder_response(existing[0])),
                **{key: value for key, value in payload.items() if key not in ('expectedRevision', 'expected_revision')},
                'id': component_id,
            }
            component = save_component_builder_payload(merged, component_id)
    except ModuleAuthoringValidationError as exc:
        return json_error('Invalid component payload.', status=400, errors=exc.errors)
    except Exception as exc:
        logger.exception('Unable to update component builder component %s.', component_id)
        return json_error('Unable to update component.', status=500, detail=str(exc))
    return JsonResponse({'updated': True, 'component': component})


def curriculum_ksb_mapping_detail(
    request,
    mapping_id,
    *,
    AUTHORING_KSB_MAPPINGS_TABLE,
    _curriculum_ksb_mapping_detail,
    authoring_fetch_all,
    clean_str,
    guarded_module_item_write,
):
    if request.method in {'PATCH', 'DELETE'}:
        owner = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', [clean_str(mapping_id)], columns=['module_catalogue_id'])
        if owner:
            return guarded_module_item_write(
                request, owner[0].get('module_catalogue_id'),
                lambda: _curriculum_ksb_mapping_detail(request, mapping_id),
            )
    return _curriculum_ksb_mapping_detail(request, mapping_id)


def _curriculum_ksb_mapping_detail(
    request,
    mapping_id,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    IntegrityError,
    JsonResponse,
    active_mapping_rows,
    authoring_fetch_all,
    authoring_soft_delete,
    authoring_upsert,
    clean_str,
    component_ksb_mappings_from_row,
    coverage_normalise_code,
    datetime,
    infer_mapping_source_from_module,
    invalidate_curriculum_cache,
    json_body,
    json_error,
    normalise_component_ksb_mappings,
    normalise_ksb_classification,
    normalise_ksb_weight,
    normalise_ksb_weight_class,
    source_payload_from_mapping,
    store_component_ksb_mappings,
    transaction,
    validate_ksb_mapping_payload,
):
    mapping_id = clean_str(mapping_id)
    rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', [mapping_id])
    if not rows:
        return json_error('KSB mapping not found.', status=404)
    existing = rows[0]
    if request.method == 'DELETE':
        component_id = clean_str(existing.get('component_id'))
        if component_id:
            component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
            if component_rows:
                component = component_rows[0]
                current_mappings = component_ksb_mappings_from_row(
                    component,
                    active_mapping_rows(authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id], 'created_at, id')),
                )
                next_mappings = [mapping for mapping in current_mappings if clean_str(mapping.get('id')) != mapping_id]
                with transaction.atomic():
                    store_component_ksb_mappings(component, next_mappings, deleted_by='ksb-mapping-delete')
            else:
                authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', [mapping_id], deleted_by='ksb-mapping-delete')
        else:
            authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', [mapping_id], deleted_by='ksb-mapping-delete')
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'permanent': False, 'id': mapping_id})
    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    merged = {
        'id': mapping_id,
        'code': payload.get('code') or existing.get('ksb_code'),
        'ksbId': payload.get('ksbId') or existing.get('ksb_id'),
        'description': payload.get('description') if 'description' in payload else existing.get('ksb_description'),
        'sourceType': payload.get('sourceType') if 'sourceType' in payload else existing.get('source_type'),
        'sourceId': payload.get('sourceId') if 'sourceId' in payload else existing.get('source_id'),
        'classification': payload.get('classification') or payload.get('type') or existing.get('classification'),
        'weight': payload.get('weight') if 'weight' in payload else existing.get('weight'),
        'weightClass': payload.get('weightClass') if 'weightClass' in payload else payload.get('weight_class') if 'weight_class' in payload else existing.get('weight_class'),
    }
    if not merged.get('sourceType') or not merged.get('sourceId'):
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [existing.get('module_catalogue_id')])
        source_type, source_id = infer_mapping_source_from_module(module_rows[0] if module_rows else {}, merged.get('code'))
        merged['sourceType'] = merged.get('sourceType') or source_type
        merged['sourceId'] = merged.get('sourceId') or source_id
    errors = validate_ksb_mapping_payload(merged, 'mapping', {})
    if errors:
        return json_error('KSB mapping validation failed.', status=400, validationErrors=errors)
    source_type, source_id = source_payload_from_mapping(merged)
    try:
        component_id = clean_str(existing.get('component_id'))
        if component_id:
            component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
            if not component_rows:
                return json_error('Component not found.', status=404)
            component = component_rows[0]
            module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [component.get('module_catalogue_id')])
            current_mappings = component_ksb_mappings_from_row(
                component,
                active_mapping_rows(authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id], 'created_at, id')),
            )
            next_mappings = [
                {
                    **mapping,
                    **merged,
                    'id': mapping_id,
                    'sourceType': source_type,
                    'sourceId': source_id,
                    'classification': normalise_ksb_classification(merged.get('classification')),
                    'type': normalise_ksb_classification(merged.get('classification')),
                    'weight': normalise_ksb_weight(merged.get('weight')),
                    'weightClass': normalise_ksb_weight_class(merged.get('weightClass')),
                    'weight_class': normalise_ksb_weight_class(merged.get('weightClass')),
                } if clean_str(mapping.get('id')) == mapping_id else mapping
                for mapping in current_mappings
            ]
            json_items, _ = normalise_component_ksb_mappings(
                component.get('module_catalogue_id'),
                next_mappings,
                week_id=component.get('week_id'),
                component_id=component_id,
                module_row=module_rows[0] if module_rows else {},
                enforce_unique=False,
            )
            with transaction.atomic():
                store_component_ksb_mappings(component, json_items, deleted_by='ksb-mapping-patch')
                updated_rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', [mapping_id])
                if not updated_rows:
                    transaction.set_rollback(True)
                    return json_error('The updated KSB mapping could not be read back. No changes were saved.', status=500)
                updated = updated_rows[0]
        else:
            updated = authoring_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], {
                **existing,
                'id': mapping_id,
                'module_catalogue_id': existing.get('module_catalogue_id'),
                'week_id': existing.get('week_id'),
                'component_id': existing.get('component_id'),
                'ksb_id': merged.get('ksbId'),
                'ksb_code': coverage_normalise_code(merged.get('code')),
                'ksb_description': merged.get('description'),
                'source_type': source_type,
                'source_id': source_id,
                'classification': normalise_ksb_classification(merged.get('classification')),
                'weight': normalise_ksb_weight(merged.get('weight')),
                'weight_class': normalise_ksb_weight_class(merged.get('weightClass')),
                'updated_at': datetime.utcnow(),
            })
    except (IntegrityError, ValueError):
        return json_error('This KSB is already mapped to this component.', status=409)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'mapping': updated})
