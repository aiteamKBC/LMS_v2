"""Meeting response mapping and HTTP workflows; public decorators remain at the facade.

The existing facade composes dependencies; query and business semantics are preserved.
"""


def curriculum_module_teams_meeting_restore(
    request,
    module_catalogue_id,
    *,
    JsonResponse,
    LIVE_SESSIONS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    attach_teams_meeting_to_module_weeks,
    authoring_fetch_all,
    authoring_module_exists,
    cached_curriculum_value,
    clean_str,
    curriculum_read_scope,
    ensure_live_session_tracking_tables,
    ensure_module_authoring_tables,
    get_authoring_structure_payload,
    json_body,
    json_error,
    live_session_row_to_component_settings,
    parse_graph_datetime,
    parse_json_value,
    request_bypasses_curriculum_cache,
    resolve_stored_module_catalogue_id,
    stamp_revision_after_write,
    stored_calendar_series,
    structure_payload_with_revision,
    teams_module_owner_id,
    truthy,
    utc_iso_value,
):
    """Restore the last tracked Teams meeting into a module's live-session components."""
    if request.method not in ('GET', 'POST'):
        return json_error('Method not allowed.', status=405)
    ensure_module_authoring_tables()
    ensure_live_session_tracking_tables()
    requested_id = clean_str(module_catalogue_id)
    # The cheap resolver, for the same reason the module structure endpoint uses
    # it: an identifier that already names a stored module is its own answer,
    # and one indexed lookup settles it. `resolve_authoring_catalogue_id`
    # summarises every module in the database to give the general answer -- and
    # that search only means anything for an identifier that is NOT a stored
    # module, which the Module Builder never sends here. Measured on this
    # module, the general resolver was the whole of the dialog's stall: the
    # request cleared the table probes in 0.57s and was still inside the
    # resolver when the browser gave up 30s later. An alias still falls through
    # to the general resolver inside this helper, so nothing resolves differently.
    resolved_id = resolve_stored_module_catalogue_id(requested_id) or requested_id
    if not authoring_module_exists(resolved_id):
        return json_error('Module authoring structure not found.', status=404)
    owner_resolver = teams_module_owner_id
    owner_id = owner_resolver(resolved_id) if callable(owner_resolver) else resolved_id

    sessions = authoring_fetch_all(
        LIVE_SESSIONS_TABLE,
        "module_catalogue_id = %s and status = 'active'",
        [owner_id],
        'updated_at desc, created_at desc',
    )
    if not sessions:
        return json_error('No saved Teams meeting was found for this module.', status=404)

    settings_update = live_session_row_to_component_settings(sessions[0])
    # The module's live-session components are paired with the series' sessions in
    # order, which is the same pairing the Teams page shows its rows in.
    occurrence_rows = authoring_fetch_all(
        LIVE_SESSION_OCCURRENCES_TABLE,
        "live_session_id = %s and status not in ('cancelled', 'superseded')",
        [clean_str(sessions[0].get('id'))],
        'session_number asc',
    )
    warnings = parse_json_value(sessions[0].get('warnings'), [])
    if clean_str(sessions[0].get('meeting_type')) == 'linked-external':
        # Read-only access limits calendar edits, not attaching the occurrences
        # already imported from Microsoft. Other verification failures still block.
        warnings = [warning for warning in warnings
                    if not isinstance(warning, dict) or warning.get('code') != 'external_calendar_read_only']
    verification_pending = bool(warnings) or not occurrence_rows
    if request.method == 'POST' and verification_pending:
        return json_error('The calendar is saved, but verification is still incomplete. Review the existing calendar before restoring its links.',
                          status=409, code='teams_calendar_verification_pending')
    # Opt-in, because this endpoint is also the silent restore the Module Builder
    # runs when it opens a module whose saved join link has gone missing. That
    # path must never author anything: only a person pressing "re-attach" may.
    body = json_body(request) if request.method == 'POST' else None
    create_missing = truthy(body.get('createMissingComponents')) if isinstance(body, dict) else False

    updated_components = 0
    created_components = 0
    # Opt-in on GET, because GET is also the Module Builder's silent restore and
    # that path must stay as cheap as it is. ``?probe=1`` asks the same walk what
    # re-attaching would create, so the UI can hide the button when the answer
    # is nothing rather than offering an action with no effect.
    pending_components = None
    if request.method == 'POST':
        # Re-attach the canonical source components, not the alias.  This keeps
        # provider ids and occurrence links out of the duplicate while making
        # the explicit Teams edit visible to both modules through the owner.
        updated_components, created_components = attach_teams_meeting_to_module_weeks(
            owner_id,
            sessions[0],
            settings_update,
            occurrence_rows,
            create_missing=create_missing,
        )
    elif truthy(request.GET.get('probe')):
        _would_update, pending_components = attach_teams_meeting_to_module_weeks(
            resolved_id,
            sessions[0],
            settings_update,
            occurrence_rows,
            create_missing=True,
            dry_run=True,
        )

    # A second full structure build, on an endpoint the Module Builder calls
    # every time its Teams dialog opens -- roughly a dozen Neon round trips for
    # weeks, components, mappings, completion and the quality check, repeating
    # work the Builder has just paid for to load the very module it is showing.
    #
    # A GET here changes nothing, so it is served from the same entry, under the
    # same invalidation, as the module-structure endpoint -- same key, same
    # factory, so the two can never disagree. The POST path always rebuilds: it
    # has just rewritten the components this payload describes, and the revision
    # stamped into it is what the Builder's next save is checked against.
    if request.method == 'POST':
        module_payload = stamp_revision_after_write(get_authoring_structure_payload(resolved_id), resolved_id)
    else:
        with curriculum_read_scope(targeted_child_reads=True):
            module_payload = cached_curriculum_value(
                f'module-structure:{resolved_id}',
                lambda: structure_payload_with_revision(lambda: get_authoring_structure_payload(resolved_id), resolved_id),
                force=request_bypasses_curriculum_cache(request),
            )
    body = {
        'restored': request.method == 'POST',
        'verificationPending': verification_pending,
        'updatedComponents': updated_components,
        'createdComponents': created_components,
        'meeting': settings_update,
        'calendar': {
            'title': clean_str(sessions[0].get('module_title')),
            'meetingType': clean_str(sessions[0].get('meeting_type')),
            'calendarManagement': 'external' if clean_str(sessions[0].get('meeting_type')) == 'linked-external' else 'lms',
            'calendarSource': 'stored',
            'seriesMode': 'per_day' if stored_calendar_series(sessions[0]) else 'shared',
            'occurrences': [{
                'sessionNumber': row['session_number'],
                'startDateTimeUtc': utc_iso_value(row.get('scheduled_start')),
                'durationMinutes': int((parse_graph_datetime(row['scheduled_end']) - parse_graph_datetime(row['scheduled_start'])).total_seconds() / 60),
                'joinUrl': clean_str(row.get('join_url')) or settings_update['teamsMeetingUrl'],
                'eventId': clean_str(row.get('graph_event_id')),
            } for row in occurrence_rows],
        },
        # Stamped the same way the structure GET stamps it. A POST here rewrote
        # the module's live-session components, so the revision the Module
        # Builder is holding is now behind -- and the Builder opens a module by
        # calling this endpoint whenever a join link has gone missing. Handing
        # back the pre-restore revision left that module permanently unsaveable:
        # every save was refused as stale, and reloading ran the same restore
        # again.
        'module': module_payload,
    }
    if pending_components is not None:
        # Weeks that have no live-session component yet, so re-attaching has
        # real work to do.
        body['pendingComponents'] = pending_components
    return JsonResponse(body)


def curriculum_module_teams_links_replace(
    request,
    module_catalogue_id,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_MODULES_TABLE,
    JsonResponse,
    STRUCTURE_REVISION_UNAVAILABLE,
    SchemaNotProvisioned,
    active_component_rows,
    active_teams_series_for_join_link,
    archived_programme_module_edit_error,
    as_json_value,
    authoring_fetch_all,
    authoring_module_exists,
    clean_str,
    component_builder_settings,
    datetime,
    ensure_live_session_tracking_tables,
    ensure_module_authoring_tables,
    http_url,
    invalidate_curriculum_cache,
    json_body,
    json_db_value,
    json_error,
    lock_module_structure_row,
    logger,
    manual_link_settings,
    module_has_active_teams_series,
    module_structure_revision,
    replaceable_live_session,
    resolve_stored_module_catalogue_id,
    strip_shared_teams_delivery_settings,
    transaction,
    unique,
    update_authoring_rows,
):
    """Point the chosen weeks' live sessions at a new join link, and nothing else.

    Its own endpoint rather than the structure PATCH, because that one rewrites
    every week, component and KSB mapping in the module: on a large module the
    full save outran the browser's timeout for an edit that changes a dozen
    rows. This touches only the live-session components in the selected weeks.

    Stored links only. Nothing is sent to Microsoft: the Teams meetings, their
    invitations and attendees are left exactly as they are. The replacement is
    stamped as ``liveSessionLinkOverride`` so a later module save, which
    re-attaches the stored calendar, keeps the new link rather than restoring
    the meeting's own one.

    A module that shares another module's Teams meeting is changed on its own
    rows only: it keeps the source's calendar, the source and the other modules
    sharing it keep their link, and its own learners join through the new one.
    """
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if not isinstance(payload, dict):
        return json_error('Invalid JSON body.')
    link = clean_str(payload.get('link'))
    if not http_url(link):
        return json_error('Paste a full http:// or https:// link.', fields=['link'])
    raw_week_ids = payload.get('weekIds')
    week_ids = unique([clean_str(value) for value in raw_week_ids if clean_str(value)]) if isinstance(raw_week_ids, list) else []
    if not week_ids:
        return json_error('Choose at least one week to update.', fields=['weekIds'])

    ensure_module_authoring_tables()
    requested_id = clean_str(module_catalogue_id)
    resolved_id = resolve_stored_module_catalogue_id(requested_id) or requested_id
    module_row = authoring_module_exists(resolved_id)
    if not module_row:
        return json_error('Module authoring structure not found.', status=404)
    archived_error = archived_programme_module_edit_error(
        module_row,
        title=module_row.get('title'),
        programme_id=module_row.get('programme_id'),
        programme_name=module_row.get('programme_name'),
    )
    if archived_error:
        return archived_error
    shared = bool(clean_str(module_row.get('teams_shared_source_module_id')))

    expected_revision = clean_str(payload.get('expectedRevision'))
    updated_ids = []
    try:
        with transaction.atomic():
            lock_module_structure_row(resolved_id)
            # Not a refusal: this write changes only the link fields of the rows
            # it names, so it cannot destroy another writer's work the way a full
            # structure save can. The answer only tells the Builder whether it
            # may take the new revision as its own (nothing else moved) or must
            # merge the stored module first, as for any other outside write.
            revision_was_current = bool(expected_revision) and module_structure_revision(resolved_id) == expected_revision
            # A copied link can refer to a meeting whose files are already
            # tracked under another module.  Make this module a Teams alias in
            # that precise case, so the existing recordings and attendance are
            # read here too.  A module with its own active calendar keeps its
            # existing ownership; two calendars must never be silently merged.
            source_module_id = ''
            try:
                ensure_live_session_tracking_tables()
                if not module_has_active_teams_series(resolved_id):
                    source_module_id = active_teams_series_for_join_link(link, excluding_module_id=resolved_id)
            except SchemaNotProvisioned:
                # Linking the component itself must still work while an older
                # environment has not yet provisioned recording tracking.
                # There can be no saved recording to attach in that state.
                logger.info('Teams result tracking is not provisioned; saved link without recording association.')
            # A module-level alias affects EVERY week. A single pasted link
            # must not silently switch the calendar/evidence of the unselected
            # weeks to another module.
            if source_module_id:
                main_rows = [row for row in active_component_rows(authoring_fetch_all(
                    AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [resolved_id],
                )) if replaceable_live_session(row)]
                if (not any(clean_str(row.get('week_id')) in week_ids for row in main_rows)
                        or any(clean_str(row.get('week_id')) not in week_ids
                               and clean_str(component_builder_settings(row).get('liveSessionLinkOverride')
                                             or component_builder_settings(row).get('liveSessionUrl')
                                             or component_builder_settings(row).get('teamsMeetingUrl')) != link
                               for row in main_rows)):
                    source_module_id = ''
            effective_shared = shared or bool(source_module_id)
            if source_module_id and source_module_id != clean_str(module_row.get('teams_shared_source_module_id')):
                update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [resolved_id], {
                    'teams_shared_source_module_id': source_module_id,
                    'updated_at': datetime.utcnow(),
                })
            placeholders = ', '.join(['%s'] * len(week_ids))
            rows = active_component_rows(authoring_fetch_all(
                AUTHORING_COMPONENTS_TABLE,
                f'module_catalogue_id = %s and week_id in ({placeholders})',
                [resolved_id, *week_ids],
                'display_order, id',
            ))
            now = datetime.utcnow()
            for row in rows:
                if not replaceable_live_session(row, shared=effective_shared):
                    continue
                settings = as_json_value(row.get('settings_json'), {})
                settings = settings if isinstance(settings, dict) else {}
                if source_module_id:
                    # Do not leave the former module's provider ids on this
                    # alias.  The source's current identity is projected on
                    # reads, while this component retains the chosen join URL.
                    settings = strip_shared_teams_delivery_settings(settings)
                settings = manual_link_settings({**settings, 'liveSessionUrl': link, 'teamsMeetingUrl': link}, settings)
                update_authoring_rows(AUTHORING_COMPONENTS_TABLE, 'id = %s', [row.get('id')], {
                    'settings_json': json_db_value({
                        **settings,
                        'liveSessionUrl': link,
                        'teamsMeetingUrl': link,
                        'liveSessionLinkOverride': link,
                    }),
                    'live_sessions_link': link,
                    'updated_at': now,
                })
                updated_ids.append(clean_str(row.get('id')))
    except Exception as exc:
        logger.exception('Unable to replace Teams links for %s.', resolved_id)
        return json_error('The Teams links could not be saved. Nothing was changed.', status=500, detail=str(exc))

    if updated_ids:
        invalidate_curriculum_cache()
    return JsonResponse({
        'updated': len(updated_ids),
        'updatedComponentIds': updated_ids,
        'link': link,
        'recordingsSourceModuleId': source_module_id,
        # Read after the commit, so it describes the module as this write left it.
        'structureRevision': module_structure_revision(resolved_id) or STRUCTURE_REVISION_UNAVAILABLE,
        'revisionWasCurrent': revision_was_current,
    })
