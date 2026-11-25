"""Api cached reads. Explicit read capabilities preserve legacy contracts."""


def get_cached_sessions(
    request, *, build_curriculum_sessions, cached_curriculum_value, curriculum_visibility,
    request_bypasses_curriculum_cache,
):
    visibility = curriculum_visibility(request)
    force = request_bypasses_curriculum_cache(request)
    return cached_curriculum_value(
        f'sessions:authored-v2:{visibility}',
        lambda: build_curriculum_sessions(visibility, force=force),
        force=force,
    )


def get_cached_payload(
    request, compact=False, *, build_curriculum_payload, cached_curriculum_value, curriculum_visibility,
    request_bypasses_curriculum_cache,
):
    visibility = curriculum_visibility(request)
    cache_key = f'overview:{visibility}:{"compact" if compact else "full"}'
    force = request_bypasses_curriculum_cache(request)
    return cached_curriculum_value(
        cache_key,
        lambda: build_curriculum_payload(visibility, compact=compact, force=force),
        force=force,
    )
