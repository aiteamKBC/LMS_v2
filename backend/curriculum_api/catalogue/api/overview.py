"""Overview HTTP cache negotiation, error mapping and compact serialization."""


def curriculum_overview(
    request,
    *,
    JsonResponse,
    build_curriculum_overview,
    cached_curriculum_value,
    compact_module_rows,
    curriculum_visibility,
    logger,
    request_bypasses_curriculum_cache,
    settings
):
    visibility = curriculum_visibility(request)
    compact = request.GET.get('compact') in {'1', 'true', 'yes'}
    learner_profiles = request.GET.get('learner_source') == 'profiles'
    cache_key = f'overview-required:v2:{visibility}:{"compact" if compact else "full"}'
    if learner_profiles:
        cache_key += ':learner-profiles'
    force = request_bypasses_curriculum_cache(request)

    if compact and not learner_profiles and not force and getattr(settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False):
        from curriculum_api.catalogue.infrastructure.home_read_model import enqueue_curriculum_home_refresh, get_curriculum_home
        shared = get_curriculum_home(visibility)
        if shared is not None and isinstance(shared.payload.get('overview'), dict):
            response = JsonResponse(shared.payload['overview'])
            response['X-LMS-Cache'] = 'READ-MODEL-STALE' if shared.stale else 'READ-MODEL-HIT'
            if shared.stale:
                enqueue_curriculum_home_refresh(visibility, reason='stale-read')
            return response

    def build_overview():
        identity_options = {'learner_profiles': True} if learner_profiles else {}
        return build_curriculum_overview(visibility, compact=compact, force=force, **identity_options)

    # A client that asks for fresh data gets it. Every Curriculum Studio screen
    # reloads with `skipCache` straight after a save, which sends Cache-Control:
    # no-cache -- and that reload is exactly the one that must not be answered
    # out of a payload cache built before the write. `force` travels down to the
    # rows read as well, or the rebuilt payload would be assembled from rows
    # cached before the same write.
    from curriculum_api.catalogue.application.overview import CurriculumOverviewUnavailable
    try:
        payload = cached_curriculum_value(cache_key, build_overview, force=force)
    except CurriculumOverviewUnavailable:
        logger.warning('Required curriculum overview source unavailable.', exc_info=True)
        return JsonResponse({'error': 'Curriculum overview unavailable. Please retry.'}, status=503)
    if compact:
        payload = {
            **payload,
            'modules': compact_module_rows(payload['modules']),
            # Compact callers load KSB sets from their dedicated endpoint. Keep
            # the full cached payload intact because that endpoint shares it.
            'ksbSets': [],
        }
    response = JsonResponse(payload)
    if compact and not learner_profiles and getattr(settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False):
        from curriculum_api.catalogue.infrastructure.home_read_model import enqueue_curriculum_home_refresh
        enqueue_curriculum_home_refresh(
            visibility, reason='forced-read' if force else 'missing-read-model',
        )
        response['X-LMS-Cache'] = 'READ-MODEL-MISS'
    return response
