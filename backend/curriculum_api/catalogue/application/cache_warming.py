"""Warm the existing compact catalogue payloads through explicit read capabilities."""


def warm_curriculum_caches(*, reconciliation_command, curriculum_read_scope, cached_curriculum_value, build_curriculum_payload, enrich_modules_with_authoring, enrich_programmes_with_module_counts):
    """Build the payload keys a Curriculum page load reads, for both visibilities.

    Deliberately the compact keys only. They are what the page actually asks for
    -- overview, modules, programmes -- and they share one rows read, so warming
    both visibilities costs a single trip to the database.

    The whole warm runs inside one read scope. On the request path each build
    opens its own, which is right there -- a request must not read back rows
    memoised before someone else's write. Here there is no such caller: this is
    one batch, assembling one consistent snapshot, and the two visibilities plus
    the enrichments otherwise re-read the same authoring tables several times
    over. curriculum.components alone is ~18k rows on a remote database and
    dominates the build, so reading it once is most of what warming saves.
    """
    if reconciliation_command():
        return
    with curriculum_read_scope():
        for visibility in ('operational', 'all'):
            payload = cached_curriculum_value(
                f'overview:{visibility}:compact',
                lambda visibility=visibility: build_curriculum_payload(visibility, compact=True),
            )
            enriched_modules = cached_curriculum_value(
                f'modules:{visibility}:enriched',
                lambda visibility=visibility: enrich_modules_with_authoring(
                    payload['modules'], include_programme_deleted=visibility == 'all',
                ),
            )
            cached_curriculum_value(
                f'programmes:{visibility}:with-module-counts',
                lambda visibility=visibility: enrich_programmes_with_module_counts(
                    payload['programmes'], enriched_modules,
                    modules_enriched=True, include_archived=visibility == 'all',
                ),
            )

