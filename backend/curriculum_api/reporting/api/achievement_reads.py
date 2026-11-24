"""Achievement HTTP adapters: request filters, errors, projections and pagination."""


def scope_learner_ksb_impact_payload(
    request,
    scope,
    identifier,
    *,
    _scope_learner_ksb_impact_payload,
    curriculum_read_scope
):
    """The one read behind every scope's achievement view.

    Programme, cohort, group, module, week and component all answer the same
    question — who is in this scope, what did curriculum plan for them, and what
    have they actually consumed — so they share one implementation rather than
    six that drift. What changes per scope is only which components are in it and
    which learners it resolves to.

    The build below reads the same handful of authoring tables from several
    directions — the scope's own structure, the lineage that names it, the
    learners enrolment placed in it — and on a remote database each repeat is a
    round trip, not a cached scan: the programme view measured 43 queries and
    ~14 s for a payload whose learner reads were 0.4 s of it. One read scope
    collapses the repeats. It asks for targeted child reads because this answers
    about one scope, so the whole-table read that pays off across every
    programme would be the more expensive half of the trade here.
    """
    with curriculum_read_scope(targeted_child_reads=True):
        return _scope_learner_ksb_impact_payload(request, scope, identifier)


def _scope_learner_ksb_impact_payload(
    request,
    scope,
    identifier,
    *,
    PROGRESS_LINEAGE_COLUMN_BY_SCOPE,
    annotate_coverage_sources,
    apply_reflection_otjh_to_learners,
    assigned_learners_for_scope,
    authoring_scope_data,
    build_coverage,
    clean_str,
    connection,
    json_error,
    learner_activity_plan,
    learner_activity_trace,
    learner_consumption_payload,
    learner_plans_for_scope,
    learner_progress_ksb_consumption,
    logger,
    mappings_with_inferred_sources,
    out_of_scope_progress_count,
    progress_evidence_index,
    progress_scope_predicate,
    reflection_submission_ksb_consumption,
    required_ksbs_for_request,
    scope_authored_plan,
    scope_ksb_achievement,
    scope_otjh_summary,
    scope_placement_lineage
):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.queries import _scope_learner_ksb_impact_payload as read
    (payload, error) = read(
        request.GET,
        scope,
        identifier,
        read_required_ksbs=lambda *args: required_ksbs_for_request(request, *args),
        PROGRESS_LINEAGE_COLUMN_BY_SCOPE=PROGRESS_LINEAGE_COLUMN_BY_SCOPE,
        annotate_coverage_sources=annotate_coverage_sources,
        apply_reflection_otjh_to_learners=apply_reflection_otjh_to_learners,
        assigned_learners_for_scope=assigned_learners_for_scope,
        authoring_scope_data=authoring_scope_data,
        build_coverage=build_coverage,
        clean_str=clean_str,
        is_postgresql=lambda: connection.vendor == 'postgresql',
        learner_activity_plan=learner_activity_plan,
        learner_activity_trace=learner_activity_trace,
        learner_consumption_payload=learner_consumption_payload,
        learner_plans_for_scope=learner_plans_for_scope,
        learner_progress_ksb_consumption=learner_progress_ksb_consumption,
        logger=logger,
        mappings_with_inferred_sources=mappings_with_inferred_sources,
        out_of_scope_progress_count=out_of_scope_progress_count,
        progress_evidence_index=progress_evidence_index,
        progress_scope_predicate=progress_scope_predicate,
        reflection_submission_ksb_consumption=reflection_submission_ksb_consumption,
        scope_authored_plan=scope_authored_plan,
        scope_ksb_achievement=scope_ksb_achievement,
        scope_otjh_summary=scope_otjh_summary,
        scope_placement_lineage=scope_placement_lineage,
    )
    if error is not None:
        message, status = error
        return (None, json_error(message, status=status))
    return (payload, None)


def programme_achievement_inputs_uncached(
    request,
    programme_id,
    *,
    assigned_learners_for_scope,
    authoring_scope_data,
    clean_str,
    curriculum_read_scope,
    json_error,
    learner_progress_ksb_consumption,
    mappings_with_inferred_sources,
    required_ksbs_for_request,
    scope_placement_lineage
):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.queries import programme_achievement_inputs_uncached as read
    (payload, error) = read(
        request.GET,
        programme_id,
        read_required_ksbs=lambda *args: required_ksbs_for_request(request, *args),
        assigned_learners_for_scope=assigned_learners_for_scope,
        authoring_scope_data=authoring_scope_data,
        clean_str=clean_str,
        curriculum_read_scope=curriculum_read_scope,
        learner_progress_ksb_consumption=learner_progress_ksb_consumption,
        mappings_with_inferred_sources=mappings_with_inferred_sources,
        required_ksbs=lambda *args: required_ksbs_for_request(request, *args),
        scope_placement_lineage=scope_placement_lineage,
    )
    if error is not None:
        message, status = error
        return (None, json_error(message, status=status))
    return (payload, None)


def _achievement_projection(
    request,
    programme_id,
    *,
    _achievement_query,
    clean_str,
    coverage_normalise_code,
    float_weight,
    json_error,
    ksb_type_family,
    programme_achievement_inputs,
    programme_row_ksb_source,
    source_display_metadata,
    split_ksb_source
):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.achievement import _achievement_projection as read
    payload, error = programme_achievement_inputs(request, programme_id)
    if error:
        return (None, error)
    if not payload:
        return (None, json_error('Programme not found.', status=404))
    return read(
        payload,
        request.GET,
        programme_id,
        _achievement_query=lambda query, *args: _achievement_query(request, *args),
        clean_str=clean_str,
        coverage_normalise_code=coverage_normalise_code,
        float_weight=float_weight,
        ksb_type_family=ksb_type_family,
        programme_row_ksb_source=programme_row_ksb_source,
        source_display_metadata=source_display_metadata,
        split_ksb_source=split_ksb_source,
    )


def curriculum_programme_learner_ksb_impact(
    request,
    programme_id,
    *,
    JsonResponse,
    scope_learner_ksb_impact_payload
):
    payload, error = scope_learner_ksb_impact_payload(request, 'programme', programme_id)
    if error:
        return error
    # The programme card's Learners dialog: one line per learner and KSB code,
    # built here, instead of every progress row (187 MB for the largest
    # programme). Without ?view=summary the response is unchanged.
    if request.GET.get('view') == 'summary':
        from curriculum_api.learner_impact_summary import learner_impact_summary
        payload = learner_impact_summary(payload)
    return JsonResponse(payload)


def curriculum_programme_ksb_achievement(
    request,
    programme_id,
    *,
    JsonResponse,
    _achievement_projection
):
    projection, error = _achievement_projection(request, programme_id)
    if error:
        return error
    page = max(1, int(request.GET.get('page') or 1))
    page_size = min(100, max(1, int(request.GET.get('page_size') or 50)))
    consumptions = projection['consumptions']
    start = (page - 1) * page_size
    projection['consumptionLog'] = {
        'items': consumptions[start:start + page_size],
        'page': page,
        'pageSize': page_size,
        'total': len(consumptions),
        'hasNext': start + page_size < len(consumptions),
    }
    projection.pop('_allItems', None)
    projection.pop('consumptions', None)
    return JsonResponse(projection)


def curriculum_programme_ksb_achievement_consumptions(
    request,
    programme_id,
    ksb_definition_id,
    *,
    JsonResponse,
    _achievement_projection
):
    request.GET = request.GET.copy()
    request.GET['ksb_id'] = ksb_definition_id
    projection, error = _achievement_projection(request, programme_id)
    if error:
        return error
    page = max(1, int(request.GET.get('page') or 1))
    page_size = min(100, max(1, int(request.GET.get('page_size') or 50)))
    rows = projection['consumptions']
    start = (page - 1) * page_size
    # The selected definition may be on another KSB page; recover it from the
    # filtered projection's complete identity set without loading consumptions
    # into the drawer until the user opens it.
    ksb = next((item for item in projection.get('_allItems', []) if item['ksbDefinitionId'] == ksb_definition_id), None)
    if ksb is None:
        ksb = next((item for item in projection['items'] if item['ksbDefinitionId'] == ksb_definition_id), None)
    return JsonResponse({'ksb': ksb, 'items': rows[start:start + page_size], 'page': page, 'pageSize': page_size, 'total': len(rows), 'hasNext': start + page_size < len(rows)})


def curriculum_cohort_learner_ksb_impact(
    request,
    cohort_id,
    *,
    JsonResponse,
    scope_learner_ksb_impact_payload
):
    payload, error = scope_learner_ksb_impact_payload(request, 'cohort', cohort_id)
    return error or JsonResponse(payload)


def curriculum_group_learner_ksb_impact(
    request,
    group_id,
    *,
    JsonResponse,
    scope_learner_ksb_impact_payload
):
    payload, error = scope_learner_ksb_impact_payload(request, 'group', group_id)
    return error or JsonResponse(payload)


def curriculum_module_learner_ksb_impact(
    request,
    module_catalogue_id,
    *,
    DatabaseError,
    JsonResponse,
    SchemaNotProvisioned,
    json_error,
    scope_learner_ksb_impact_payload,
    load_activity_enricher
):
    payload, error = scope_learner_ksb_impact_payload(request, 'module', module_catalogue_id)
    if not error and request.GET.get('moduleProgress') == '1':
        enrich = load_activity_enricher()
        try:
            enrich(payload, getattr(request, 'login_account', None))
        except (SchemaNotProvisioned, DatabaseError):
            return json_error('Activity status storage is unavailable. Apply curriculum migration 0070.', status=503)
        if request.GET.get('view') == 'summary':
            from curriculum_api.learner_impact_summary import module_progress_dialog_summary
            payload = module_progress_dialog_summary(payload)
    return error or JsonResponse(payload)


def curriculum_week_learner_ksb_impact(
    request,
    week_id,
    *,
    JsonResponse,
    scope_learner_ksb_impact_payload
):
    payload, error = scope_learner_ksb_impact_payload(request, 'week', week_id)
    return error or JsonResponse(payload)


def curriculum_scope_learner_ksb_impact(
    request,
    *,
    CURRICULUM_LEARNER_SCOPES,
    JsonResponse,
    clean_str,
    json_error,
    scope_learner_ksb_impact_payload
):
    """The same read addressed by ``?scope=&identifier=``.

    One route for a caller that already holds a scope and an id and does not want
    to pick a URL per level — the drill-down in the Programme workspace uses it.
    """
    scope = clean_str(request.GET.get('scope')) or 'programme'
    identifier = clean_str(request.GET.get('identifier') or request.GET.get('id'))
    if scope not in CURRICULUM_LEARNER_SCOPES:
        return json_error(
            f'Unsupported scope. Expected one of: {", ".join(CURRICULUM_LEARNER_SCOPES)}.',
        )
    if not identifier:
        return json_error('An identifier is required.')
    payload, error = scope_learner_ksb_impact_payload(request, scope, identifier)
    return error or JsonResponse(payload)


def curriculum_scope_learner_roster(
    request,
    *,
    CURRICULUM_LEARNER_SCOPES,
    clean_str,
    json_error,
    scope_learner_roster_response
):
    """``?scope=&identifier=`` form of the roster read."""
    scope = clean_str(request.GET.get('scope')) or 'programme'
    identifier = clean_str(request.GET.get('identifier') or request.GET.get('id'))
    if scope not in CURRICULUM_LEARNER_SCOPES:
        return json_error(
            f'Unsupported scope. Expected one of: {", ".join(CURRICULUM_LEARNER_SCOPES)}.',
        )
    if not identifier:
        return json_error('An identifier is required.')
    return scope_learner_roster_response(request, scope, identifier)
