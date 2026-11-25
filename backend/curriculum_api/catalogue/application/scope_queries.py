"""Resolve catalogue scopes, hydrate their children and preserve scope filtering."""

from curriculum_api.catalogue.application.scope_identity import authoring_row_delivery_signature as _default_authoring_row_delivery_signature
from curriculum_api.catalogue.application.scope_identity import programme_identifier_looks_exact as _default_programme_identifier_looks_exact
from curriculum_api.catalogue.application.scope_identity import training_row_delivery_signature as _default_training_row_delivery_signature
from curriculum_api.catalogue.application.scope_identity import training_row_matches_programme_identifier as _default_training_row_matches_programme_identifier
from curriculum_api.catalogue.domain.hierarchy_values import matches_curriculum_identifier as _default_matches_curriculum_identifier
from curriculum_api.catalogue.domain.programme_identity import programme_identity as _default_programme_identity
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise


def authoring_scope_module_rows(
    scope='',
    identifier='',
    *,
    authoring_row_delivery_signature=_default_authoring_row_delivery_signature,
    clean_str=_default_clean_str,
    ensure_module_authoring_tables,
    get_program_config_rows,
    get_training_rows,
    matches_curriculum_identifier=_default_matches_curriculum_identifier,
    module_index_rows,
    normalise=_default_normalise,
    prefetch_authoring_reads,
    program_config_by_id,
    programme_identifier_looks_exact=_default_programme_identifier_looks_exact,
    programme_identity=_default_programme_identity,
    resolve_authoring_catalogue_id,
    resolve_group_row,
    training_index_reads,
    training_row_delivery_signature=_default_training_row_delivery_signature,
    training_row_matches_programme_identifier=_default_training_row_matches_programme_identifier,
    training_row_module_catalogue_id,
):
    """The authoring module rows a scope resolves to, and nothing beneath them.

    The first half of authoring_scope_data(), on its own. A caller that only
    needs to know which modules a scope covers -- programme_identity_candidates()
    reads their programme names -- used to call authoring_scope_data() and throw
    away the weeks, components and KSB mappings it read for them: on a
    programme with ~17k live components that was ~50s of a learner-roster read,
    paid twice per request, to learn a handful of names.

    Not deduplicated: authoring_scope_data() dedupes programme, cohort and group
    scopes by delivery signature using the child rows it reads afterwards, so a
    caller that needs that exact set must still go through it.
    """
    ensure_module_authoring_tables()
    # The shared module index (no ksb_remap_report, which nothing reading a
    # scope's modules looks at): one read per request with the other readers.
    if scope == 'programme':
        # The programme branch builds the training rows below; their group and
        # cohort reads go out with this module read in one round trip.
        prefetch_authoring_reads(training_index_reads())
    module_rows = module_index_rows()
    ident = clean_str(identifier)
    if scope == 'module':
        resolved = resolve_authoring_catalogue_id(ident) or ident
        module_rows = [row for row in module_rows if clean_str(row.get('module_catalogue_id')) == resolved]
    elif scope == 'programme':
        configs_by_id = program_config_by_id(get_program_config_rows())
        programme_training_rows = [
            row for row in get_training_rows()
            if training_row_matches_programme_identifier(row, ident, configs_by_id)
        ]
        training_ids = {clean_str(row.get('id')) for row in programme_training_rows if clean_str(row.get('id'))}
        linked_module_ids = {
            training_row_module_catalogue_id(row)
            for row in programme_training_rows
            if training_row_module_catalogue_id(row)
        }
        unlinked_training_rows = [
            row for row in programme_training_rows
            if not training_row_module_catalogue_id(row)
        ]
        delivery_signatures = {
            signature for signature in (
                training_row_delivery_signature(row, configs_by_id)
                for row in unlinked_training_rows
            )
            if signature
        }
        exact_identifier = programme_identifier_looks_exact(ident)
        if linked_module_ids:
            # Explicit canonical links are authoritative. The source/signature paths
            # below are temporary compatibility for legacy delivery rows that have
            # not yet been backfilled with module_catalogue_id.
            programme_id_candidates = {ident}
            programme_name_candidates = set()
            for row in programme_training_rows:
                identity = programme_identity(row, configs_by_id)
                if clean_str(identity.get('sourceId')):
                    programme_id_candidates.add(clean_str(identity.get('sourceId')))
                if clean_str(identity.get('name')):
                    programme_name_candidates.add(clean_str(identity.get('name')))
            linked_rows = [
                row for row in module_rows
                if clean_str(row.get('module_catalogue_id')) in linked_module_ids
            ]
            legacy_rows = [
                row for row in module_rows
                if clean_str(row.get('module_catalogue_id')) not in linked_module_ids
                and (
                    (
                        clean_str(row.get('source_type')) == 'training_plan'
                        and clean_str(row.get('source_id')) in {
                            clean_str(item.get('id')) for item in unlinked_training_rows if clean_str(item.get('id'))
                        }
                    )
                    or authoring_row_delivery_signature(row) in delivery_signatures
                )
            ]
            standalone_authoring_rows = [
                row for row in module_rows
                if clean_str(row.get('module_catalogue_id')) not in linked_module_ids
                and not (
                    clean_str(row.get('source_type')) == 'training_plan'
                    and clean_str(row.get('source_id')) in training_ids
                )
                and (
                    any(matches_curriculum_identifier(row.get('programme_id'), candidate) for candidate in programme_id_candidates)
                    or (
                        not programme_identifier_looks_exact(row.get('programme_id'))
                        and (
                            any(normalise(row.get('programme_name')) == normalise(name) for name in programme_name_candidates)
                            or (not exact_identifier and matches_curriculum_identifier(row.get('programme_name'), ident))
                        )
                    )
                )
            ]
            module_rows = [*linked_rows, *legacy_rows, *standalone_authoring_rows]
        else:
            # Temporary compatibility for older rows. Remove after all delivery rows
            # have a canonical training_plan.module_catalogue_id link.
            module_rows = [
                row for row in module_rows
                if matches_curriculum_identifier(row.get('programme_id'), ident)
                or (not exact_identifier and matches_curriculum_identifier(row.get('programme_name'), ident))
                or (
                    clean_str(row.get('source_type')) == 'training_plan'
                    and clean_str(row.get('source_id')) in training_ids
                )
                or authoring_row_delivery_signature(row) in delivery_signatures
            ]
    elif scope == 'cohort':
        module_rows = [
            row for row in module_rows
            if matches_curriculum_identifier(row.get('cohort_id'), ident)
            or matches_curriculum_identifier(row.get('cohort_name'), ident)
        ]
    elif scope == 'group':
        # Group names are unique only inside their cohort, so a bare-name match
        # would pull in a same-named group from another cohort. Resolve the group
        # row first and prefer its canonical id; the name path is kept for legacy
        # callers but is fenced by the resolved cohort.
        group_row = resolve_group_row(ident) or {}
        group_ident = clean_str(group_row.get('group_id')) or ident
        group_name = clean_str(group_row.get('group_name')) or ident
        cohort_id_key = normalise(group_row.get('cohort_id'))
        cohort_name_key = normalise(group_row.get('cohort_name'))
        module_rows = [
            row for row in module_rows
            if matches_curriculum_identifier(row.get('group_id'), group_ident)
            or (
                matches_curriculum_identifier(row.get('group_name'), group_name)
                and (
                    not (cohort_id_key or cohort_name_key)
                    or normalise(row.get('cohort_id')) == cohort_id_key
                    or normalise(row.get('cohort_name')) == cohort_name_key
                )
            )
        ]
    return module_rows


def authoring_scope_data(
    scope='',
    identifier='',
    *,
    stats_only=False,
    mapped_components_only=False,
    authoring_scope_module_rows,
    clean_str,
    dedupe_authoring_module_rows,
    ensure_module_authoring_tables,
    read_scope_children,
    week_scope_module_ids,
):
    """Module/week/component/mapping rows for a scope.

    The component read excludes settings_json for every caller, deliberately:
    each one either feeds ksb_coverage.py (which never reads it) or only counts
    the rows. Programme summary statistics opt into grouped count/weight facts;
    full coverage callers keep their shared detailed column set.

    ``mapped_components_only`` (KSB coverage): the components returned are the
    ones a returned mapping sits on -- all coverage looks up -- and delivery
    deduplication counts every active component in SQL instead of from the
    rows. For the largest programme that is 3,196 rows instead of 27,483.
    Learner impact and achievement need every component and do not pass it.
    """
    if stats_only and scope != 'programme':
        raise ValueError('Stats-only authoring rows require a programme scope.')
    ensure_module_authoring_tables()
    module_rows = authoring_scope_module_rows(scope, identifier)
    ident = clean_str(identifier)

    module_ids = [clean_str(row.get('module_catalogue_id')) for row in module_rows if clean_str(row.get('module_catalogue_id'))]
    if scope == 'week' and ident:
        # A week scope resolves to every module (authoring_scope_module_rows has
        # no week branch), and the week filter below then throws away all but
        # one week's rows -- after reading every module's weeks, components and
        # mappings. Read only the modules that can hold rows of this week: the
        # week's own module and the module of any component placed in it (a
        # mapping is kept through its component, so that covers mappings too).
        owners = week_scope_module_ids(ident)
        module_ids = [module_id for module_id in module_ids if module_id in owners]
    if not module_ids:
        return [], [], [], []

    week_rows, component_rows, mapping_rows, counts = read_scope_children(
        module_ids, stats_only=stats_only, mapped_components_only=mapped_components_only,
    )

    if scope in {'programme', 'cohort', 'group'}:
        module_rows = dedupe_authoring_module_rows(module_rows, mapping_rows, component_rows, week_rows, **({'counts': counts} if counts is not None else {}))
        module_ids = {clean_str(row.get('module_catalogue_id')) for row in module_rows if clean_str(row.get('module_catalogue_id'))}
        week_rows = [row for row in week_rows if clean_str(row.get('module_catalogue_id')) in module_ids]
        component_rows = [row for row in component_rows if clean_str(row.get('module_catalogue_id')) in module_ids]
        mapping_rows = [row for row in mapping_rows if clean_str(row.get('module_catalogue_id')) in module_ids]

    if scope == 'week':
        week_rows = [row for row in week_rows if clean_str(row.get('id')) == ident]
        week_ids = {clean_str(row.get('id')) for row in week_rows}
        component_rows = [row for row in component_rows if clean_str(row.get('week_id')) in week_ids]
        component_ids = {clean_str(row.get('id')) for row in component_rows}
        mapping_rows = [row for row in mapping_rows if clean_str(row.get('week_id')) in week_ids or clean_str(row.get('component_id')) in component_ids]
        module_ids = {clean_str(row.get('module_catalogue_id')) for row in week_rows}
        module_rows = [row for row in module_rows if clean_str(row.get('module_catalogue_id')) in module_ids]
    elif scope == 'component':
        component_rows = [row for row in component_rows if clean_str(row.get('id')) == ident]
        component_ids = {clean_str(row.get('id')) for row in component_rows}
        week_ids = {clean_str(row.get('week_id')) for row in component_rows}
        module_ids = {clean_str(row.get('module_catalogue_id')) for row in component_rows}
        week_rows = [row for row in week_rows if clean_str(row.get('id')) in week_ids]
        module_rows = [row for row in module_rows if clean_str(row.get('module_catalogue_id')) in module_ids]
        mapping_rows = [row for row in mapping_rows if clean_str(row.get('component_id')) in component_ids]

    return module_rows, week_rows, component_rows, mapping_rows
