"""Serve programme KSB statistics with the existing HTTP and cache contract."""


def curriculum_programme_ksb_stats(
    request,
    programme_id,
    *,
    CURRICULUM_LEARNER_DATA_TTL_SECONDS,
    build_programme_ksb_stats,
    cached_curriculum_value,
    clean_str,
    conditional_json_response,
    curriculum_visibility,
    encode_json_entry,
    encode_json_error_entry,
    forced_programme_ksb_design,
    request_bypasses_curriculum_cache,
):
    visibility = curriculum_visibility(request)
    identifier = clean_str(programme_id)
    force = request_bypasses_curriculum_cache(request)
    def build_entry():
        with forced_programme_ksb_design(force):
            stats = build_programme_ksb_stats(identifier, visibility)
        if not stats:
            return encode_json_error_entry('Programme not found.', status=404)
        return encode_json_entry(stats)

    entry = cached_curriculum_value(
        f'programme-ksb-stats-response:{visibility}:{identifier}',
        build_entry,
        force=force,
        ttl=CURRICULUM_LEARNER_DATA_TTL_SECONDS,
        scope=identifier,
    )
    return conditional_json_response(request, entry)
