"""Module structure HTTP contracts, optimistic concurrency, partial merge and response construction.

Named capabilities are supplied by the existing composition seam during migration.
No application settings, legacy views or provider runtime is imported here.
"""
from curriculum_api.weekly_schedule import module_week_boundary_mode


def curriculum_module_structure(
    request,
    module_catalogue_id,
    *,
    JsonResponse,
    ModuleAuthoringValidationError,
    ModuleStructureDeltaConflict,
    announce_saved,
    archived_programme_module_edit_error,
    authoring_module_exists,
    cached_curriculum_value,
    check_structure_save,
    clean_str,
    collaboration_enabled,
    creation_unavailable_response,
    curriculum_read_scope,
    get_authoring_structure_payload,
    is_canonical_module_catalogue_id,
    json_body,
    json_error,
    link_training_row_to_catalogue,
    lock_module_structure_row,
    logger,
    merge_partial_module_structure,
    module_merge_bindings,
    module_merge_conflict_response,
    module_structure_revision,
    module_structure_source_rows,
    module_week_starts_on,
    module_weekly_schedule,
    read_module_structure_with_revision,
    request_bypasses_curriculum_cache,
    resolve_stored_module_catalogue_id,
    save_module_authoring_structure,
    soft_deleted_structure_ids,
    stamp_revision_after_write,
    structure_payload_with_revision,
    transaction,
    with_item_fingerprints,
):
    module_catalogue_id = clean_str(module_catalogue_id)
    # Existence-first, so a request for a stored module does not summarise every
    # module in the database to learn that its own id was the answer. See
    # resolve_stored_module_catalogue_id.
    stored_catalogue_id = resolve_stored_module_catalogue_id(module_catalogue_id)
    resolved_catalogue_id = stored_catalogue_id or module_catalogue_id
    if request.method == 'GET':
        is_training_alias = module_catalogue_id.startswith('training-module-')
        bypass_cache = request_bypasses_curriculum_cache(request)
        if not is_training_alias:
            from .module_reads import module_structure_response
            from ..application.structure_payloads import load_stored_module_structure
            return module_structure_response(
                module_catalogue_id,
                load_structure=lambda: load_stored_module_structure(
                    stored_catalogue_id, resolved_catalogue_id, force=bypass_cache,
                    curriculum_read_scope=curriculum_read_scope,
                    cached_curriculum_value=cached_curriculum_value,
                    read_module_structure_with_revision=read_module_structure_with_revision,
                    structure_payload_with_revision=structure_payload_with_revision,
                    get_authoring_structure_payload=get_authoring_structure_payload,
                ),
                JsonResponse=JsonResponse, json_error=json_error, logger=logger,
            )
        try:
            # One read scope for the whole payload. The KSB source inference
            # inside it (mappings_with_inferred_sources) asks whether a code
            # exists in a standard or a profile once per mapping row that has no
            # stored source, and each of those questions is a whole-table read of
            # standard_ksbs or ksb_profiles. Memoised for the scope, a module
            # with thirty unsourced mappings costs two reads instead of ninety.
            with curriculum_read_scope(targeted_child_reads=True):
                payload = (
                    structure_payload_with_revision(
                        lambda: get_authoring_structure_payload(resolved_catalogue_id),
                        resolved_catalogue_id,
                    )
                    if resolved_catalogue_id != module_catalogue_id
                    else None
                )
        except Exception:
            logger.exception('Unable to load module authoring structure for %s.', module_catalogue_id)
            return json_error('Unable to load module authoring structure.', status=500)
        if not payload:
            return json_error('Module authoring structure not found.', status=404)
        return JsonResponse(payload)

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    if not stored_catalogue_id:
        # The Builder can create its first saved draft through this PATCH as
        # well as through the collection POST. Guard both before any write.
        storage_error = creation_unavailable_response(payload)
        if storage_error is not None:
            return storage_error
    try:
        module_week_starts_on(payload)
        module_week_boundary_mode(payload)
    except ValueError as exc:
        return json_error(str(exc), fields=['weekStartsOn'])
    try:
        module_weekly_schedule(payload)
    except ValueError as exc:
        return json_error(str(exc), fields=['weeklySchedule'])
    # An identifier that names an existing module but did not resolve to one must
    # not fall through to the save: ``unique_module_catalogue_id`` mints a fresh
    # MOD id for anything it cannot recognise, so the whole structure would be
    # written to a brand new ghost module while the one the person was editing
    # kept its old content -- the save reports success and the work is nowhere.
    # A fresh canonical MOD id (the builder's own local draft) and a training
    # alias are the two cases that legitimately provision on write.
    if (
        not stored_catalogue_id
        and not module_catalogue_id.startswith('training-module-')
        and not is_canonical_module_catalogue_id(module_catalogue_id)
    ):
        return json_error('Module not found.', status=404)
    # The same archived-programme rule the drawer PATCH applies, checked before
    # anything is written. Without it the Builder saved the structure happily
    # and the module stayed hidden, because the save re-derived
    # `is_programme_deleted` from the archived programme underneath it: blocked
    # in the drawer, saved-and-vanished in the Builder, for the same edit.
    #
    # Only for a module that already exists -- a fresh canonical draft and a
    # training alias provision on write, so there is nothing yet to withdraw.
    # The programme is resolved the way save_module_authoring_structure resolves
    # it, so the row the guard judges is the row the save would attach.
    existing_structure_row = authoring_module_exists(resolved_catalogue_id) if stored_catalogue_id else None
    if existing_structure_row:
        archived_error = archived_programme_module_edit_error(
            existing_structure_row,
            title=payload.get('title') or payload.get('name') or existing_structure_row.get('title'),
            programme_id=(
                payload.get('programmeId')
                or payload.get('programme_id')
                or existing_structure_row.get('programme_id')
            ),
            programme_name=(
                payload.get('programmeName')
                or payload.get('programme')
                or existing_structure_row.get('programme_name')
            ),
        )
        if archived_error:
            return archived_error
    # Optimistic concurrency. A caller that read the structure sends the
    # revision it read back as ``expectedRevision`` (or an ``If-Match`` header),
    # and this save is refused unless the stored material is still exactly that.
    #
    # Opt-in rather than compulsory, because the callers that write here without
    # ever having read a revision are legitimate and must keep working: the
    # programme tree save, the structure wizard, the Excel import, the duplicate
    # and a module's first save. What the check protects is the one caller that
    # holds the whole structure open in a browser for an hour and then writes all
    # of it back -- and the Module Builder always sends it.
    expected_revision = clean_str(
        payload.get('expectedRevision')
        or payload.get('expected_revision')
        or request.headers.get('If-Match')
    )
    # A partial save only says what changed relative to one stored version, so
    # it is only meaningful against that version: it needs the revision, and a
    # module that is already stored.
    partial_save = clean_str(payload.get('saveMode')) == 'partial'
    if partial_save and (not expected_revision or not stored_catalogue_id):
        return json_error('A partial save needs the saved version it was made against. Save the whole module instead.')
    if partial_save:
        # The programme's status belongs to the programme drawer. The Builder
        # echoes back the status it loaded, and the module revision does not
        # cover the programmes table, so a tab opened before a programme was
        # archived could otherwise reactivate it with a component edit.
        payload = {key: value for key, value in payload.items() if key not in ('programmeStatus', 'programme_status')}
    try:
        if module_catalogue_id.startswith('training-module-'):
            training_id = module_catalogue_id.replace('training-module-', '', 1)
            payload = {
                **payload,
                'sourceType': payload.get('sourceType') or 'training_plan',
                'sourceId': payload.get('sourceId') or training_id,
            }
        # One transaction around the check and the write. See
        # lock_module_structure_row: read-then-write would let two saves that
        # read the same revision both pass.
        #
        # A partial save that carries the copy it was made against
        # (``structureBase``) is not refused just because someone else saved
        # first: it is merged item by item under this lock (module_merge), and
        # refused only for a real conflict -- the same field, or an item
        # deleted on one side and edited on the other.
        source_rows = None
        current_revision = ''
        merge_summary = None
        item_merge = partial_save and isinstance(payload.get('structureBase'), dict)
        with transaction.atomic():
            if expected_revision or collaboration_enabled(resolved_catalogue_id):
                lock_module_structure_row(resolved_catalogue_id)
            if expected_revision:
                if partial_save:
                    # Read once, under the lock, for both the guard and the
                    # merge: the revision and the stored structure then
                    # describe the same moment.
                    source_rows = module_structure_source_rows(resolved_catalogue_id)
                    current_revision = module_structure_revision(resolved_catalogue_id, source_rows=source_rows)
                else:
                    current_revision = module_structure_revision(resolved_catalogue_id)
                if not current_revision:
                    # Fail closed. '' here means the fingerprint could not be
                    # read at all, never that the module is empty -- an empty
                    # module still hashes to a real value. Carrying on would run
                    # this save unchecked, which is the silent overwrite the
                    # caller asked to be protected from by sending a revision in
                    # the first place. No module travels with this refusal:
                    # nothing was compared, so there is no other version to show.
                    logger.warning(
                        'Refusing a guarded structure save for %s: the current revision could not be read.',
                        resolved_catalogue_id,
                    )
                    return json_error(
                        'This module could not be checked against the saved version, so nothing was '
                        'written. Your changes are still here - try again in a moment.',
                        status=409,
                        conflict=True,
                        expectedRevision=expected_revision,
                        currentRevision='',
                    )
                if current_revision != expected_revision and not item_merge:
                    # Deliberately NOT a merge and NOT a retry. The payload
                    # waiting here replaces every week and component in the
                    # module, so applying it would destroy whatever the other
                    # writer authored; the caller keeps its edits in memory and
                    # is told to re-read. The current structure travels with the
                    # refusal so it can show what changed without a second call.
                    return json_error(
                        'This module changed after you opened it. Your changes have not been '
                        'overwritten. Reload the latest version before saving again.',
                        status=409,
                        conflict=True,
                        expectedRevision=expected_revision,
                        currentRevision=current_revision,
                        module=structure_payload_with_revision(
                            lambda: get_authoring_structure_payload(resolved_catalogue_id),
                            resolved_catalogue_id,
                        ),
                    )
            if partial_save:
                stored_structure = get_authoring_structure_payload(resolved_catalogue_id, source_rows=source_rows)
                if not stored_structure:
                    return json_error('Module not found.', status=404)
                ModuleMergeConflicts, ModuleMergeUnavailable, candidate_new_ids, merge_partial_save, restore_conflicts = module_merge_bindings()
                delta = payload.get('structureDelta') if isinstance(payload.get('structureDelta'), dict) else {}
                deleted_ids = soft_deleted_structure_ids(candidate_new_ids(delta, stored_structure))
                try:
                    if current_revision == expected_revision:
                        # Nobody else has written since this copy was read, so
                        # the delta applies as it stands -- except that it may
                        # not quietly bring back a row that was deleted.
                        refused = restore_conflicts(delta, stored_structure, deleted_ids, payload.get('restoreIds'))
                        if refused:
                            raise ModuleMergeConflicts(refused)
                        full_payload = merge_partial_module_structure(stored_structure, payload)
                    else:
                        full_payload, merge_summary = merge_partial_save(
                            stored_structure, payload, deleted_ids=deleted_ids,
                        )
                except ModuleMergeConflicts as exc:
                    return module_merge_conflict_response(expected_revision, current_revision, exc.conflicts)
                except (ModuleStructureDeltaConflict, ModuleMergeUnavailable):
                    # The changes were made against a version of the module that
                    # no longer matches what is stored. Answered exactly like a
                    # revision mismatch, so the Builder merges and tries again.
                    return json_error(
                        'This module changed after you opened it. Your changes have not been '
                        'overwritten. Reload the latest version before saving again.',
                        status=409,
                        conflict=True,
                        expectedRevision=expected_revision,
                        currentRevision=module_structure_revision(resolved_catalogue_id),
                        module=stamp_revision_after_write(stored_structure, resolved_catalogue_id),
                    )
                lease_error = check_structure_save(request, resolved_catalogue_id, stored_structure, full_payload, payload)
                if lease_error is not None:
                    return lease_error
                result = save_module_authoring_structure(
                    resolved_catalogue_id, full_payload, write_changed_only=True,
                    light=source_rows is not None, stored_rows=source_rows,
                    stored_structure=stored_structure, build_result=False,
                )
            else:
                if collaboration_enabled(resolved_catalogue_id):
                    stored_guard = get_authoring_structure_payload(resolved_catalogue_id) or {}
                    lease_error = check_structure_save(request, resolved_catalogue_id, stored_guard, payload, payload)
                    if lease_error is not None:
                        return lease_error
                result = save_module_authoring_structure(resolved_catalogue_id, payload)
            if module_catalogue_id.startswith('training-module-'):
                link_training_row_to_catalogue(
                    module_catalogue_id.replace('training-module-', '', 1),
                    result.get('catalogueId') or resolved_catalogue_id,
                )
            saved_catalogue_id = result.get('catalogueId') or resolved_catalogue_id
            announce_saved(saved_catalogue_id)
    except ModuleAuthoringValidationError as exc:
        return json_error('Module authoring validation failed.', status=400, validationErrors=exc.errors)
    except Exception as exc:
        logger.exception('Unable to save module authoring structure for %s.', module_catalogue_id)
        return json_error('Unable to save module authoring structure.', status=500, detail=str(exc))
    # Read after the transaction has committed, so the revision handed back is
    # the one a reader would fingerprint now. Inside the block it would describe
    # rows that a rollback could still take away.
    if partial_save:
        # One read for the saved module, its revision and its item
        # fingerprints, instead of a payload read inside the lock and a
        # revision read after it.
        saved = read_module_structure_with_revision(saved_catalogue_id) or {}
        if result.get('qualityChecklist') is not None:
            saved['qualityChecklist'] = result['qualityChecklist']
        if merge_summary:
            saved['merged'] = merge_summary
        return JsonResponse(saved)
    result['structureRevision'] = module_structure_revision(saved_catalogue_id)
    return JsonResponse(with_item_fingerprints(result))
