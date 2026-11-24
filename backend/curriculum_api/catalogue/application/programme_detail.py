"""Programme read operations; legacy adapters supply explicit existing capabilities.

HTTP, cache lifetime, authorization and writes remain in the outer adapters.
"""

from ..domain.programme_scope import owns_record

from curriculum_api.catalogue.application.module_projection import module_rows_with_week_outline as _default_module_rows_with_week_outline
from curriculum_api.catalogue.application.module_projection import normalise_programme_config_cohort as _default_normalise_programme_config_cohort
from curriculum_api.catalogue.application.module_projection import normalise_programme_config_group as _default_normalise_programme_config_group
from curriculum_api.catalogue.application.scope_identity import programme_identifier_looks_exact as _default_programme_identifier_looks_exact
from curriculum_api.catalogue.domain.hierarchy_values import find_programme as _default_find_programme
from curriculum_api.catalogue.domain.hierarchy_values import matches_curriculum_identifier as _default_matches_curriculum_identifier
from curriculum_api.catalogue.domain.hierarchy_values import programme_config_json_list as _default_programme_config_json_list
from curriculum_api.catalogue.domain.module_selection import module_belongs_to_group as _default_module_belongs_to_group
from curriculum_api.catalogue.domain.module_selection import unique_curriculum_items as _default_unique_curriculum_items
from curriculum_api.catalogue.domain.programme_identity import programme_config_identity as _default_programme_config_identity
from curriculum_api.catalogue.domain.programme_identity import programme_identity as _default_programme_identity
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import unique as _default_unique


def build_programme_ksb_stats(
    identifier,
    visibility,
    *,
    PROGRAMME_KSB_STAT_FIELDS,
    build_programmes,
    clean_str=_default_clean_str,
    curriculum_read_scope,
    find_programme=_default_find_programme,
    get_ksb_profile_rows,
    get_program_config_rows,
    get_training_rows,
    is_operational_training_row,
):
    with curriculum_read_scope(targeted_child_reads=True):
        training_rows = get_training_rows()
        ksb_profiles = get_ksb_profile_rows()
        program_configs = get_program_config_rows()
        training_rows = training_rows if visibility == 'all' else [
            row for row in training_rows
            if is_operational_training_row(row)
        ]
        ksb_profiles = ksb_profiles if visibility == 'all' else [
            profile for profile in ksb_profiles
            if profile.get('is_active')
        ]
        resolved = find_programme({'programmes': build_programmes(
            training_rows, program_configs, ksb_profiles,
            include_config_only=visibility == 'all',
            only_stats_for_ids=frozenset(),
            include_learner_counts=False,
            include_structure_counts=False,
        )}, identifier)
        if not resolved:
            return None
        programmes = build_programmes(
            training_rows, program_configs, ksb_profiles,
            include_config_only=visibility == 'all',
            only_stats_for_ids={clean_str(resolved.get('sourceId'))},
            include_learner_counts=False,
            include_structure_counts=False,
        )
    programme = find_programme({'programmes': programmes}, identifier)
    if not programme:
        return None
    return {
        'programmeId': clean_str(programme.get('sourceId') or programme.get('id')),
        **{field: programme.get(field, 0) for field in PROGRAMME_KSB_STAT_FIELDS},
    }


def programme_modules_workspace_payload(
    payload,
    *,
    PROGRAMME_WORKSPACE_MODULE_FIELDS,
    PROGRAMME_WORKSPACE_WEEK_FIELDS,
    WEEK_OUTLINE_MODULE_FLAG,
    WEEK_OUTLINE_WEEK_FLAG,
):
    """Opt-in display/edit metadata, leaving the full detail contract intact.

    Project after duplicate selection and all calculations, so removing rich
    authoring fields cannot change which module wins or any displayed counts.
    Planned sessions stay intact: the workspace uses their dates and warnings.
    """
    modules = []
    for module in payload['flat']['modules']:
        item = {key: value for key, value in module.items() if key in PROGRAMME_WORKSPACE_MODULE_FIELDS}
        if isinstance(module.get('weekStructure'), list):
            item['weekStructure'] = [
                {**{key: value for key, value in week.items() if key in PROGRAMME_WORKSPACE_WEEK_FIELDS},
                 WEEK_OUTLINE_WEEK_FLAG: True}
                if isinstance(week, dict) else week
                for week in module['weekStructure']
            ]
            item[WEEK_OUTLINE_MODULE_FLAG] = True
        modules.append(item)
    return {**payload, 'flat': {**payload['flat'], 'modules': modules}}


def _build_curriculum_programme_tree_detail_payload(
    identifier,
    visibility,
    include_stats=True,
    include_components=True,
    include_tree=True,
    include_week_components=True,
    section=None,
    *,
    workspace_view=False,
    CURRICULUM_SCHEMA,
    PROGRAMME_MODULE_IDENTITY_FIELDS,
    build_cohorts_and_groups,
    build_modules,
    build_programmes,
    read_programme_sessions,
    clean_str=_default_clean_str,
    component_builder_rows,
    find_programme=_default_find_programme,
    get_cached_curriculum_rows,
    is_operational_training_row,
    matches_curriculum_identifier=_default_matches_curriculum_identifier,
    module_belongs_to_group=_default_module_belongs_to_group,
    module_rows_with_week_outline=_default_module_rows_with_week_outline,
    normalise_programme_config_cohort=_default_normalise_programme_config_cohort,
    normalise_programme_config_group=_default_normalise_programme_config_group,
    program_config_by_id,
    programme_config_for_programme,
    programme_config_identity=_default_programme_config_identity,
    programme_config_json_list=_default_programme_config_json_list,
    programme_identity=_default_programme_identity,
    programme_identifier_looks_exact=_default_programme_identifier_looks_exact,
    programme_module_candidates,
    repair_curriculum_parent_links,
    unique=_default_unique,
    unique_curriculum_items=_default_unique_curriculum_items,
):
    curriculum_rows = get_cached_curriculum_rows(compact=True)
    training_rows = curriculum_rows['training'] if visibility == 'all' else [
        row for row in curriculum_rows['training']
        if is_operational_training_row(row)
    ]
    ksb_profiles = curriculum_rows['ksb_profiles'] if visibility == 'all' else [
        profile for profile in curriculum_rows['ksb_profiles']
        if profile.get('is_active')
    ]
    # build_programmes() computes ksbMapped/learner-progress only for the ids it
    # is given, and here only one programme is ever returned. The first pass
    # skips every programme's stats (cheap: no extra reads) just to resolve which
    # one this identifier means, using the
    # same matching find_programme always applies; the second pass computes the
    # real numbers only for that resolved programme. See _programme_ksb_stats.
    #
    # The modules section answers with modules and sessions alone. The
    # programme's learner and structure counts are never part of it, and
    # find_programme() matches on id, sourceId and name only, so it skips the
    # learner tally and the whole-table cohort/group/module/week count reads.
    modules_section = section == 'modules'
    cheap_programmes = build_programmes(
        training_rows,
        curriculum_rows['program_configs'],
        ksb_profiles,
        include_config_only=visibility == 'all',
        only_stats_for_ids=frozenset(),
        **({'include_learner_counts': False, 'include_structure_counts': False} if modules_section else {}),
    )
    resolved_programme = find_programme({'programmes': cheap_programmes}, identifier)
    if not resolved_programme:
        return None
    # Without stats the second pass is the first pass again -- the same call
    # with the same arguments -- so its result is reused instead of rebuilt.
    programmes = build_programmes(
        training_rows,
        curriculum_rows['program_configs'],
        ksb_profiles,
        include_config_only=visibility == 'all',
        only_stats_for_ids={clean_str(resolved_programme.get('sourceId'))},
    ) if include_stats else cheap_programmes
    programme = find_programme({'programmes': programmes}, identifier)
    if not programme:
        return None
    repair_curriculum_parent_links(
        clean_str(programme.get('id') or programme.get('sourceId')), allow_writes=False
    )

    program_configs = curriculum_rows['program_configs']
    known_programme_ids = {programme_config_identity(item) for item in program_configs
                           if programme_config_identity(item)}

    def owned(identifier, name):
        return owns_record(
            programme, identifier, name, known_ids=known_programme_ids,
            clean_str=clean_str, matches_curriculum_identifier=matches_curriculum_identifier,
            identifier_looks_exact=programme_identifier_looks_exact,
        )

    config = programme_config_for_programme(program_configs, programme)
    if config and not owned(programme_config_identity(config), config.get('name')):
        config = None
    configs_by_id = program_config_by_id(program_configs)
    programme_training_rows = []
    for row in training_rows:
        identity = programme_identity(row, configs_by_id)
        if owned(identity.get('sourceId'), identity.get('name')):
            programme_training_rows.append(row)
    # ``build_cohorts_and_groups`` intentionally reads the normalized tables as
    # its source of truth and therefore returns rows for every programme.  A
    # detail response must scope those rows again; otherwise opening one
    # programme can expose unrelated cohorts/groups and inflate every UI count.
    config_cohort_items = [item for item in programme_config_json_list(config, 'cohorts') if isinstance(item, dict)]
    all_cohorts, all_groups = build_cohorts_and_groups(
        programme_training_rows,
        program_configs,
        include_archived=visibility == 'all',
        # The modules section reads its cohorts for their holidays alone. Their
        # learner counts reach it only through unique_curriculum_items' richness
        # when a config-stored cohort shares an id, so they are skipped only
        # when the config stores none.
        **({'include_learner_counts': False} if modules_section and not config_cohort_items else {}),
    )
    def belongs_to_selected_programme(item):
        return owned(item.get('programmeId'), item.get('programme'))

    config_cohorts = [
        normalise_programme_config_cohort(item, programme)
        for item in programme_config_json_list(config, 'cohorts')
        if isinstance(item, dict)
    ]
    config_groups = [
        normalise_programme_config_group(item, programme)
        for item in programme_config_json_list(config, 'groups')
        if isinstance(item, dict)
    ]
    config_week_templates = [
        item for item in programme_config_json_list(config, 'week_templates')
        if isinstance(item, dict)
    ]

    cohorts = unique_curriculum_items(
        [cohort for cohort in all_cohorts if belongs_to_selected_programme(cohort)] + config_cohorts,
        ['id', 'cohortId', 'cohort_id'],
    )
    cohort_ids = {cohort.get('id') for cohort in cohorts if cohort.get('id')}
    groups = unique_curriculum_items([
        group for group in all_groups
        if group.get('cohortId') in cohort_ids and belongs_to_selected_programme(group)
    ] + config_groups, ['id', 'groupId', 'group_id'])
    group_ids = {group.get('id') for group in groups if group.get('id')}
    if section == 'shell':
        return {
            'schema': CURRICULUM_SCHEMA,
            'programme': programme,
            'flat': {
                'cohorts': cohorts,
                'groups': groups,
                'groupIds': sorted(group_ids, key=str),
                'weekTemplates': config_week_templates,
            },
        }

    modules = build_modules(
        curriculum_rows['modules'],
        programme_training_rows,
        program_configs,
        include_unused=False,
    )
    # One normalized structure snapshot supplies both compatibility shapes.
    # Config documents cannot inject stale content or invent module membership.
    candidates = programme_module_candidates(
        modules, programme, config, workspace_view=workspace_view,
        module_rows=curriculum_rows.get('authoring_modules'),
        known_programme_ids=known_programme_ids,
    )
    modules = unique_curriculum_items(candidates, PROGRAMME_MODULE_IDENTITY_FIELDS)
    # Resolve the canonical programme first, then read only its authored sessions.
    sessions = read_programme_sessions(programme, visibility)
    module_catalogue_ids = unique([
        module.get('moduleCatalogueId')
        or module.get('catalogueId')
        or module.get('moduleId')
        or module.get('id')
        for module in modules
        if (
            module.get('moduleCatalogueId')
            or module.get('catalogueId')
            or module.get('moduleId')
            or module.get('id')
        )
    ])
    components = component_builder_rows(module_catalogue_ids) if include_components else None
    # After every count above is derived from the full structure: the outline
    # changes what is sent, never what is computed.
    if not include_week_components:
        modules = module_rows_with_week_outline(modules)
    if section == 'modules':
        return {
            'schema': CURRICULUM_SCHEMA,
            'flat': {
                'modules': modules,
                'sessions': sessions,
            },
        }

    nested_cohorts = []
    for cohort in (cohorts if include_tree else []):
        nested_groups = []
        for group in [item for item in groups if item.get('cohortId') == cohort['id']]:
            group_modules = [
                module for module in modules
                if module_belongs_to_group(module, group)
            ]
            nested_groups.append({**group, 'modules': group_modules})
        nested_cohorts.append({**cohort, 'groups': nested_groups})

    return {
        'schema': CURRICULUM_SCHEMA,
        'programme': programme,
        **({'cohorts': nested_cohorts} if include_tree else {}),
        'flat': {
            'cohorts': cohorts,
            'groups': groups,
            # Sorted: a set's iteration order differs between worker processes,
            # which gave the same document a different ETag on each worker.
            'groupIds': sorted(group_ids, key=str),
            'modules': modules,
            'sessions': sessions,
            **({'components': components} if include_components else {}),
            'weekTemplates': config_week_templates,
        },
    }
