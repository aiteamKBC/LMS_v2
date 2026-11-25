"""Application placement lineage. Explicit read capabilities preserve legacy contracts."""

from curriculum_api.catalogue.domain.programme_identity import programme_config_identity as _default_programme_config_identity
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import unique as _default_unique


def scope_placement_lineage(
    scope,
    identifier,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    COMPONENT_HEAVY_COLUMNS,
    authoring_fetch_all,
    clean_str=_default_clean_str,
    programme_config_by_identifier,
    programme_config_identity=_default_programme_config_identity,
    resolve_authoring_catalogue_id,
    resolve_cohort_row,
    resolve_group_row,
):
    """Resolve any curriculum scope to its Programme -> Component lineage.

    IDs identify the placement; names remain display/context fields. The current
    roster narrowing uses stable cohort/group IDs, without a label fallback.
    ``found`` distinguishes an existing empty scope from a missing record.

    This resolves placement metadata, not effective module membership. The
    existing membership policy separately applies normalized plan selections,
    direct assignments and manual/inherited mode. ``placementBasis`` describes
    the resolved placement and must not substitute for that membership policy.
    """
    scope = clean_str(scope) or 'programme'
    ident = clean_str(identifier)
    lineage = {
        'scope': scope,
        'identifier': ident,
        'found': False,
        'programmeId': '',
        'programmeName': '',
        'cohortId': '',
        'cohortName': '',
        'groupId': '',
        'groupName': '',
        'learnerRosterMode': 'inherited',
        'moduleCatalogueId': '',
        'moduleTitle': '',
        'weekId': '',
        'weekTitle': '',
        'componentId': '',
        'componentTitle': '',
        'programmeConfigId': '',
        'placementBasis': 'programme',
    }
    if not ident:
        return lineage

    def apply_module_row(row):
        lineage['moduleCatalogueId'] = clean_str(row.get('module_catalogue_id'))
        lineage['moduleTitle'] = clean_str(row.get('title'))
        lineage['programmeId'] = lineage['programmeId'] or clean_str(row.get('programme_id'))
        lineage['programmeName'] = lineage['programmeName'] or clean_str(row.get('programme_name'))
        lineage['cohortId'] = lineage['cohortId'] or clean_str(row.get('cohort_id'))
        lineage['cohortName'] = lineage['cohortName'] or clean_str(row.get('cohort_name'))
        lineage['groupId'] = lineage['groupId'] or clean_str(row.get('group_id'))
        lineage['groupName'] = lineage['groupName'] or clean_str(row.get('group_name'))
        lineage['learnerRosterMode'] = clean_str(row.get('learner_roster_mode') or 'inherited').lower() or 'inherited'

    if scope == 'programme':
        config = programme_config_by_identifier(ident)
        lineage['found'] = bool(config)
        # The identifier as given, deliberately: `assigned_learners_for_programme`
        # compares it against `Learner.learners.programme_id`, and swapping in the
        # canonical config id would change which learners a programme claims.
        lineage['programmeId'] = ident
        lineage['programmeConfigId'] = clean_str(programme_config_identity(config)) if config else ''
        lineage['programmeName'] = clean_str(config.get('name')) if config else ''
        lineage['placementBasis'] = 'programme'
        return lineage

    if scope == 'cohort':
        row = resolve_cohort_row(ident)
        if row:
            lineage['found'] = True
            lineage['cohortId'] = clean_str(row.get('cohort_id'))
            lineage['cohortName'] = clean_str(row.get('cohort_name'))
            lineage['programmeId'] = clean_str(row.get('programme_id'))
            lineage['programmeName'] = clean_str(row.get('programme_name'))
        lineage['placementBasis'] = 'cohort'
        return lineage

    if scope == 'group':
        row = resolve_group_row(ident)
        if row:
            lineage['found'] = True
            lineage['groupId'] = clean_str(row.get('group_id'))
            lineage['groupName'] = clean_str(row.get('group_name'))
            lineage['cohortId'] = clean_str(row.get('cohort_id'))
            lineage['cohortName'] = clean_str(row.get('cohort_name'))
            lineage['programmeId'] = clean_str(row.get('programme_id'))
            lineage['programmeName'] = clean_str(row.get('programme_name'))
        lineage['placementBasis'] = 'group'
        return lineage

    if scope in {'module', 'week', 'component'}:
        module_id = ''
        if scope == 'component':
            rows = authoring_fetch_all(
                AUTHORING_COMPONENTS_TABLE, 'id = %s', [ident],
                exclude_columns=COMPONENT_HEAVY_COLUMNS,
            )
            if rows:
                lineage['componentId'] = clean_str(rows[0].get('id'))
                lineage['componentTitle'] = clean_str(rows[0].get('title'))
                lineage['weekId'] = clean_str(rows[0].get('week_id'))
                module_id = clean_str(rows[0].get('module_catalogue_id'))
        if scope == 'week' or (scope == 'component' and lineage['weekId']):
            week_ident = ident if scope == 'week' else lineage['weekId']
            rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE, 'id = %s', [week_ident])
            if rows:
                lineage['weekId'] = clean_str(rows[0].get('id'))
                lineage['weekTitle'] = clean_str(rows[0].get('title'))
                module_id = module_id or clean_str(rows[0].get('module_catalogue_id'))
        if scope == 'module':
            module_id = resolve_authoring_catalogue_id(ident) or ident
        if module_id:
            rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id])
            if rows:
                lineage['found'] = True
                apply_module_row(rows[0])
        # A group is the level enrolment places learners into, so that is the
        # roster a module/week/component inherits. Without one, the cohort — and
        # failing that the programme — is the widest honest answer.
        lineage['placementBasis'] = (
            'group' if lineage['groupName'] else ('cohort' if lineage['cohortName'] else 'programme')
        )
        return lineage

    return lineage


def programme_identity_candidates(
    programme_id,
    *,
    authoring_scope_module_rows,
    clean_str=_default_clean_str,
    get_program_config_rows,
    programme_config_identity=_default_programme_config_identity,
    unique=_default_unique,
):
    candidates = unique([programme_id])
    configs = get_program_config_rows()
    config = next(
        (row for row in configs if programme_config_identity(row) == clean_str(programme_id)),
        None,
    )
    if config:
        candidates.extend(unique([config.get('name'), config.get('sub'), config.get('standard')]))
    # Only the modules' programme names are wanted here, so the module rows are
    # read without the weeks, components and mappings authoring_scope_data()
    # would fetch beneath them. Its signature dedupe is not needed either: the
    # signature includes the normalised programme name, and callers only ever
    # compare normalise(candidate), so the set of names that can match is the
    # same. Rows without a catalogue id are skipped, as authoring_scope_data()
    # returns none for them.
    module_rows = [
        row for row in authoring_scope_module_rows('programme', programme_id)
        if clean_str(row.get('module_catalogue_id'))
    ]
    candidates.extend(unique(row.get('programme_name') for row in module_rows))
    return [value for value in unique(candidates) if value]
