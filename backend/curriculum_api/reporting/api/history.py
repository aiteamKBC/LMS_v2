"""Quality history HTTP parsing, error mapping and responses; SQL lives in readers."""
from ..application import history_results
from ..infrastructure import history_queries


def curriculum_quality_audit_trail(
    request, *, JsonResponse, history_off_response, logger, revision_trail,
    versioning_history_available,
):
    """What changed in the curriculum: who, when, what, and from what to what.

    Answered from ``curriculum.record_revisions`` -- the log the write helpers
    fill -- whenever those tables exist, which is what lets the trail name an
    actor and show a before and an after. If the log is not installed, the API
    reports that explicitly rather than reading legacy timestamp tables.

    ``authorRecorded`` on the response says which of the two the caller is
    looking at, so the page can report honestly rather than showing an empty
    column. Rows written before the log existed keep no actor and are never
    given a plausible one.

    ``?days=`` window (default 30), ``?limit=`` events returned (default 200),
    ``?entity=`` / ``?action=`` / ``?actor=`` filter, ``?search=`` matches
    title/context/id, ``?scope=`` + ``?scopeId=`` narrow to one programme,
    cohort, group or module.
    """
    if not versioning_history_available():
        return history_off_response()
    try:
        return revision_trail(request)
    except Exception:
        logger.warning('Could not read the revision audit trail.', exc_info=True)
        return JsonResponse({'error': 'Audit history could not be read. Please retry.'}, status=503)


def revision_trail(
    request, *, ACTIONS, DEFAULT_PAGE_SIZE, DEFAULT_WINDOW_DAYS, JsonResponse, MAX_LIMIT, _scope_clause,
    audit_pages_workspace_options, change_window_limit, coverage_keys, curriculum_views_clean_str,
    datetime, derived_PROVENANCE_REVISION, derived_PROVENANCE_TIMESTAMPS, derived_read_hybrid,
    entity_type_options, merge_actors, parse_bounded_int, revision_actors, revision_event,
    system_writes_change_workspaces, system_writes_revision_workspace_clause, timedelta, transaction,
    versioning_ACTOR_TYPES, versioning_ENTITY_TYPES, versioning_REVISIONS_TABLE, versioning_SOURCES,
    versioning_metadata_columns_available, versioning_qualified,
):
    """The audit trail read from the revision log."""
    days = parse_bounded_int(
        request.GET.get('days'), DEFAULT_WINDOW_DAYS, 1,
        change_window_limit(curriculum_views_clean_str(request.GET.get('workspace')).lower()),
    )
    limit = parse_bounded_int(request.GET.get('limit'), DEFAULT_PAGE_SIZE, 1, MAX_LIMIT)
    page = parse_bounded_int(request.GET.get('page'), 1, 1, 10_000)
    entity_filter = curriculum_views_clean_str(request.GET.get('entity')).lower()
    action_filter = curriculum_views_clean_str(request.GET.get('action')).lower()
    actor_filter = curriculum_views_clean_str(request.GET.get('actor')).lower()
    source_filter = curriculum_views_clean_str(request.GET.get('source')).lower()
    actor_type_filter = curriculum_views_clean_str(request.GET.get('actorType')).lower()
    search = curriculum_views_clean_str(request.GET.get('search')).lower()
    scope = curriculum_views_clean_str(request.GET.get('scope')).lower()
    scope_id = curriculum_views_clean_str(request.GET.get('scopeId'))
    workspace = curriculum_views_clean_str(request.GET.get('workspace')).lower()

    hybrid, columns, structured, since = history_queries.trail_query(
        ACTIONS=ACTIONS, _scope_clause=_scope_clause, action_filter=action_filter,
        actor_filter=actor_filter, actor_type_filter=actor_type_filter, datetime=datetime, days=days,
        entity_filter=entity_filter, limit=limit, page=page, scope=scope, scope_id=scope_id,
        search=search, source_filter=source_filter,
        system_writes_revision_workspace_clause=system_writes_revision_workspace_clause,
        timedelta=timedelta, versioning_ACTOR_TYPES=versioning_ACTOR_TYPES,
        versioning_ENTITY_TYPES=versioning_ENTITY_TYPES,
        versioning_REVISIONS_TABLE=versioning_REVISIONS_TABLE, versioning_SOURCES=versioning_SOURCES,
        versioning_metadata_columns_available=versioning_metadata_columns_available,
        versioning_qualified=versioning_qualified, workspace=workspace,
    )
    with transaction.atomic():
        result = derived_read_hybrid(recover=False, **hybrid)

    payload = history_results.trail_payload(
        ACTIONS=ACTIONS, action_filter=action_filter, actor_type_filter=actor_type_filter,
        audit_pages_workspace_options=audit_pages_workspace_options, columns=columns,
        coverage_keys=coverage_keys, datetime=datetime, days=days,
        derived_PROVENANCE_REVISION=derived_PROVENANCE_REVISION,
        derived_PROVENANCE_TIMESTAMPS=derived_PROVENANCE_TIMESTAMPS, entity_filter=entity_filter,
        entity_type_options=entity_type_options, limit=limit, merge_actors=merge_actors, result=result,
        revision_actors=revision_actors, revision_event=revision_event, since=since,
        source_filter=source_filter, structured=structured,
        system_writes_change_workspaces=system_writes_change_workspaces,
        versioning_ACTOR_TYPES=versioning_ACTOR_TYPES, versioning_SOURCES=versioning_SOURCES,
        workspace=workspace,
    )
    return JsonResponse(payload)



def history_off_response(
    *, JsonResponse,
):
    """The one honest answer when the history tables are not there.

    A 200 carrying ``available: false`` rather than a 404: the feature exists,
    the store behind it has not been created yet, and the page has to be able to
    say which of those it is looking at.
    """
    return JsonResponse({
        'available': False,
        'reason': (
            'Version history is not switched on. Run '
            'backend/sql/2026-09-09_curriculum_record_versions.sql against the database '
            'to create curriculum.record_revisions and curriculum.record_versions.'
        ),
        'totalRevisions': 0,
        'totalNamedVersions': 0,
        'count': 0,
        'entities': [],
        'versions': [],
        'revisions': [],
    })


def curriculum_quality_versions(
    request, *, JsonResponse, curriculum_views_clean_str, curriculum_views_fetch_all, datetime,
    history_off_response, iso, latest_revision_by_entity, logger, named_version_counts,
    parse_bounded_int, versioning_ENTITY_TYPES, versioning_REVISIONS_TABLE, versioning_VERSIONS_TABLE,
    versioning_history_available, versioning_qualified,
):
    """Versioned records, most recently changed first.

    ``?module=`` narrows to one module's whole tree, ``?entity_type=`` to one
    kind of record, ``?search=`` matches the title or the id.
    """
    if not versioning_history_available():
        return history_off_response()

    module = curriculum_views_clean_str(request.GET.get('module'))
    entity_type = curriculum_views_clean_str(request.GET.get('entity_type')).lower()
    search = curriculum_views_clean_str(request.GET.get('search')).lower()
    limit = parse_bounded_int(request.GET.get('limit'), 200, 1, 1000)

    revisions_table = versioning_qualified(versioning_REVISIONS_TABLE)
    versions_table = versioning_qualified(versioning_VERSIONS_TABLE)

    try:
        summary_rows = history_queries.version_summaries(
            curriculum_views_fetch_all=curriculum_views_fetch_all,
            entity_type=entity_type,
            limit=limit,
            module=module,
            revisions_table=revisions_table,
            versioning_ENTITY_TYPES=versioning_ENTITY_TYPES,
        )
    except Exception:
        logger.warning('Could not read curriculum version summaries.', exc_info=True)
        return JsonResponse({'error': 'Version history could not be read. Please retry.'}, status=503)

    entities = history_results.version_entities(
        curriculum_views_clean_str=curriculum_views_clean_str, iso=iso,
        latest_revision_by_entity=latest_revision_by_entity, named_version_counts=named_version_counts,
        search=search, summary_rows=summary_rows,
    )
    try:
        totals = history_queries.history_totals(
            curriculum_views_fetch_all=curriculum_views_fetch_all,
            revisions_table=revisions_table, versions_table=versions_table,
        )
        total_revisions = int((totals[0] if totals else {}).get('revisions') or 0)
        total_versions = int((totals[0] if totals else {}).get('versions') or 0)
    except Exception:
        logger.warning('Could not read curriculum version totals.', exc_info=True)
        return JsonResponse({'error': 'Version history could not be read. Please retry.'}, status=503)

    return JsonResponse({
        'available': True,
        'generatedAt': datetime.utcnow().isoformat(),
        'totalRevisions': total_revisions,
        'totalNamedVersions': total_versions,
        'count': len(entities),
        'entities': entities,
    })


def curriculum_quality_record_history(
    request, entity_type, entity_id, *, JsonResponse, curriculum_views_clean_str,
    curriculum_views_fetch_all, curriculum_views_json_error, history_off_response, iso, logger,
    parse_bounded_int, revision_row, versioning_ENTITY_TYPES, versioning_REVISIONS_TABLE,
    versioning_VERSIONS_TABLE, versioning_as_dict, versioning_history_available, versioning_qualified,
):
    """One record's timeline: its named versions, and every revision beneath them.

    Revisions come back newest first with their diffs. ``?snapshot=<n>`` also
    returns the stored content of revision ``n`` -- what the record actually held
    at that point, which is the question a version number exists to answer.
    """
    if not versioning_history_available():
        return history_off_response()
    entity_type = curriculum_views_clean_str(entity_type).lower()
    entity_id = curriculum_views_clean_str(entity_id)
    if entity_type not in versioning_ENTITY_TYPES:
        return curriculum_views_json_error(f'Unknown record type "{entity_type}".', status=404)

    revisions_table = versioning_qualified(versioning_REVISIONS_TABLE)
    versions_table = versioning_qualified(versioning_VERSIONS_TABLE)
    limit = parse_bounded_int(request.GET.get('limit'), 200, 1, 1000)

    try:
        revisions = history_queries.record_revisions(
            curriculum_views_fetch_all=curriculum_views_fetch_all, entity_id=entity_id,
            entity_type=entity_type, limit=limit, revisions_table=revisions_table,
        )
    except Exception:
        logger.warning('Could not read the revision timeline for %s %s.', entity_type, entity_id, exc_info=True)
        return JsonResponse({'error': 'Record history could not be read. Please retry.'}, status=503)

    if not revisions:
        return JsonResponse({
            'available': True,
            'entityType': entity_type,
            'entityId': entity_id,
            'title': '',
            'moduleCatalogueId': '',
            'versions': [],
            'revisions': [],
            'snapshot': None,
        })

    versions = history_queries.record_versions(
        curriculum_views_fetch_all=curriculum_views_fetch_all, entity_id=entity_id,
        entity_type=entity_type, revisions_table=revisions_table, versions_table=versions_table,
    )

    snapshot = None
    wanted = curriculum_views_clean_str(request.GET.get('snapshot'))
    if wanted:
        rows = history_queries.record_snapshot(
            curriculum_views_fetch_all=curriculum_views_fetch_all, entity_id=entity_id,
            entity_type=entity_type, revision_number=parse_bounded_int(wanted, 1, 1, 10_000_000),
            revisions_table=revisions_table,
        )
        if rows:
            snapshot = {
                'revisionNo': int(rows[0].get('revision_no') or 0),
                'at': iso(rows[0].get('created_at')),
                'content': versioning_as_dict(rows[0].get('snapshot')),
            }

    return JsonResponse({
        'available': True,
        'entityType': entity_type,
        'entityId': entity_id,
        'title': curriculum_views_clean_str(revisions[0].get('title')),
        'moduleCatalogueId': curriculum_views_clean_str(revisions[0].get('module_catalogue_id')),
        'versions': [
            {
                'id': row.get('id'),
                'versionLabel': curriculum_views_clean_str(row.get('version_label')),
                'revisionNo': int(row.get('revision_no') or 0),
                'contentStatus': curriculum_views_clean_str(row.get('content_status')),
                'note': curriculum_views_clean_str(row.get('note')),
                'actorName': curriculum_views_clean_str(row.get('actor_name')),
                'at': iso(row.get('created_at')),
            }
            for row in versions
        ],
        'revisions': [revision_row(row) for row in revisions],
        'snapshot': snapshot,
    })
