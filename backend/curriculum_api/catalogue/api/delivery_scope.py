"""Delivery-scope response composition with the existing visibility and cache contract."""


def delivery_scope_lists(
    request, *, build_cohorts_and_groups, cached_curriculum_value, curriculum_read_scope,
    curriculum_visibility, request_bypasses_curriculum_cache,
):
    """``{'cohorts': [...], 'groups': [...]}`` for the request's visibility.

    The cohorts and groups exactly as the full curriculum payload builds them --
    same build_cohorts_and_groups(), measured identical on the new database for
    both visibilities -- without the rest of that payload (34-49 s cold against
    0.5-1 s here). Shared by delivery-scope and the group list, one cache entry.
    """
    visibility = curriculum_visibility(request)

    def build():
        with curriculum_read_scope():
            cohorts, groups = build_cohorts_and_groups(
                include_archived=visibility == 'all',
            )
            return {'cohorts': cohorts, 'groups': groups}

    return cached_curriculum_value(
        f'delivery-scope:{visibility}', build, force=request_bypasses_curriculum_cache(request),
    )
