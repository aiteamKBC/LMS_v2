"""Concrete catalogue application operations; dependencies supplied by outer adapters."""


def build_home_summary(
    visibility,
    *,
    force=False,
    apply_authoring_facts,
    build_curriculum_payload_from_rows,
    curriculum_read_scope,
    enrich_modules_with_authoring,
    enrich_programmes_with_module_counts,
    home_programmes_need_enrichment,
    home_source_rows,
    project_home
):
    with curriculum_read_scope():
        rows, delivery = home_source_rows(visibility)
        overview = build_curriculum_payload_from_rows(
            rows, visibility, compact=True, home_summary=True, delivery_source=delivery,
        )
        # Idempotent: the payload builder applies the same facts once views.py
        # passes rows['ksb_counts'] through; until then this call does it.
        apply_authoring_facts(overview['modules'], rows['authoring_modules'], rows.get('ksb_counts'))
        if not home_programmes_need_enrichment(
            overview, rows['authoring_modules'], rows['program_configs'], include_archived=visibility == 'all',
        ):
            return project_home(overview, overview['programmes'])
        # Programme enrichment can introduce module-only programmes. Preserve
        # those identities, but do not load component bodies or KSB mappings.
        modules = enrich_modules_with_authoring(
            overview['modules'], include_programme_deleted=visibility == 'all', include_content=False,
        )
        programmes = enrich_programmes_with_module_counts(
            overview['programmes'], modules, modules_enriched=True, include_archived=visibility == 'all',
            # Home derives its counts from overview and only needs programme
            # identities/source metadata, including module-only programmes.
            include_structure_counts=False,
        )
        return project_home(overview, programmes)


def build_programme_list(
    visibility,
    *,
    force=False,
    authoring_modules_as_training_rows,
    authoring_programme_structure_counts,
    build_curriculum_payload_from_rows,
    build_programmes,
    curriculum_read_scope,
    enrich_modules_with_authoring,
    enrich_programmes_with_module_counts,
    get_curriculum_rows,
    is_operational_training_row,
    programme_list_learner_counts,
    programme_list_needs_module_enrichment,
    programme_list_sources
):
    with curriculum_read_scope():
        source = programme_list_sources()
        training = authoring_modules_as_training_rows(
            module_rows=source['modules'], group_rows=source['groups'], cohort_rows=source['cohorts'],
        )
        if visibility != 'all':
            training = [row for row in training if is_operational_training_row(row)]
        counts = authoring_programme_structure_counts(source=source)
        programmes = build_programmes(
            training, source['program_configs'], [], include_config_only=visibility == 'all',
            only_stats_for_ids=frozenset(), structure_counts=counts,
            learner_counts=programme_list_learner_counts(source),
        )
        if not programme_list_needs_module_enrichment(
            programmes, source, counts, include_archived=visibility == 'all',
        ):
            return programmes
        # Keep the established response for legacy and module-only programmes.
        # This fallback is cached as the same list, never as a partial overview.
        overview = build_curriculum_payload_from_rows(
            get_curriculum_rows(compact=True), visibility, compact=True, programme_list=True,
        )
        modules = enrich_modules_with_authoring(
            overview['modules'], include_programme_deleted=visibility == 'all', include_content=False,
        )
        return enrich_programmes_with_module_counts(
            overview['programmes'], modules, modules_enriched=True, include_archived=visibility == 'all',
        )
