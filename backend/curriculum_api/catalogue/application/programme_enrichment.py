"""Programme read operations; legacy adapters supply explicit existing capabilities.

HTTP, cache lifetime, authorization and writes remain in the outer adapters.
"""

from curriculum_api.catalogue.application.scope_identity import module_matches_programme as _default_module_matches_programme
from curriculum_api.catalogue.domain.hierarchy_values import infer_level as _default_infer_level
from curriculum_api.catalogue.domain.hierarchy_values import programme_summary_is_archived as _default_programme_summary_is_archived
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def archived_programme_keys(*, get_program_config_rows, is_archived_program_config, logger, normalise):
    """Identity keys of every explicitly archived programme.

    build_programmes() already drops archived programmes from the operational
    list, but the module-only reconstruction below would rebuild a card for any
    programme whose modules/cohorts/groups still exist. Archiving deliberately
    leaves those children in place, so the reconstruction has to be told to skip
    them or an archived programme reappears on the next refresh.
    """
    keys = set()
    try:
        for config in get_program_config_rows():
            if not is_archived_program_config(config):
                continue
            for value in (config.get('programme_id'), config.get('program_id'),
                          config.get('id'), config.get('name')):
                key = normalise(value)
                if key:
                    keys.add(key)
    except Exception:
        logger.warning('Could not resolve archived programme keys.', exc_info=True)
    return keys


def enrich_programmes_with_module_counts(
    programmes,
    modules,
    modules_enriched=False,
    include_archived=False,
    *,
    include_structure_counts=True,
    archived_programme_keys,
    authoring_programme_structure_counts,
    clean_str=_default_clean_str,
    enrich_modules_with_authoring,
    infer_level=_default_infer_level,
    is_archived_module_summary,
    module_matches_programme=_default_module_matches_programme,
    normalise=_default_normalise,
    parse_int=_default_parse_int,
    programme_structure_counts,
    programme_summary_is_archived=_default_programme_summary_is_archived,
):
    all_modules = modules if modules_enriched else enrich_modules_with_authoring(modules)
    live_modules = [module for module in all_modules if not is_archived_module_summary(module)]
    # `include_archived` is what keeps archived PROGRAMMES in the list, for the
    # archive view. It must not put archived MODULES into a live programme's
    # count: a module archived on its own has left that programme's module list,
    # and the workspace shows it gone — while the card went on counting it, so
    # the same programme read "3 modules" on the list and "No modules yet" on its
    # own page. An archived programme still counts its own, because everything
    # beneath it was archived with it and a card reading 0 would say that
    # deleting it removes nothing.
    enriched_modules = all_modules if include_archived else live_modules
    archived_keys = set() if include_archived else archived_programme_keys()
    structure_counts_by_id, structure_counts_by_name = (
        authoring_programme_structure_counts() if include_structure_counts else ({}, {})
    )
    enriched_programmes = []
    existing_programme_keys = set()
    for programme in programmes:
        existing_programme_keys.update({
            normalise(programme.get('id')),
            normalise(programme.get('sourceId')),
            normalise(programme.get('name')),
            normalise(programme.get('standard')),
        })
        # A programme with authoring rows of its own arrives already counted from
        # curriculum.cohorts/groups/modules -- the very rows its workspace lists
        # -- so nothing derived from the module list can improve on those figures,
        # and anything it derives differently is a card that disagrees with the
        # page. The arithmetic below still answers for a legacy programme that
        # has no authoring rows, whose count arrives as len(delivery_rows).
        if not include_structure_counts or programme_structure_counts(programme, structure_counts_by_id, structure_counts_by_name):
            enriched_programmes.append(programme)
            continue
        countable_modules = all_modules if programme_summary_is_archived(programme) else live_modules
        free_programme_modules = [module for module in countable_modules if module_matches_programme(programme, module)]
        if clean_str(programme.get('structureType')).lower() == 'free':
            enriched_programmes.append(programme)
            continue
        if not free_programme_modules:
            # No module of its own left, so the card says none. The count it
            # arrives with was `len(delivery_rows)` -- the legacy training rows,
            # which outlive the module they were created for and are not what the
            # programme's own page lists. Leaving that number in place is what
            # made one programme read "3 modules" on its card and "No modules
            # yet" on its page. Cohorts, groups and learners are left alone:
            # those are counted from their own rows, not from a module.
            enriched_programmes.append({**programme, 'modules': 0})
            continue

        cohort_keys = {
            normalise(module.get('cohortId') or module.get('cohort'))
            for module in free_programme_modules
            if normalise(module.get('cohortId') or module.get('cohort'))
        }
        group_keys = {
            normalise(module.get('groupId') or module.get('group'))
            for module in free_programme_modules
            if normalise(module.get('groupId') or module.get('group'))
        }
        enriched_programmes.append({
            **programme,
            'modules': len(free_programme_modules),
            'cohorts': max(parse_int(programme.get('cohorts'), 0), len(cohort_keys)),
            'groups': max(parse_int(programme.get('groups'), 0), len(group_keys)),
            # Weeks come from the same modules the count above is taken from, the
            # way the module-only reconstruction below already does it. Reading
            # them off the delivery rows instead is what left an archived
            # programme's card saying "0 weeks" beside a page listing twenty.
            'weeks': (
                sum(parse_int(module.get('weeks') or module.get('sessionsNumber'), 0) for module in free_programme_modules)
                or parse_int(programme.get('weeks'), 0)
            ),
        })

    module_only_programmes = {}
    for module in enriched_modules:
        programme_name = clean_str(module.get('programme') or module.get('programmeName'))
        if not programme_name or normalise(programme_name) in {'unassignedprogramme', 'unassigned'}:
            continue
        module_programme_id = clean_str(module.get('programmeId') or module.get('programme_id'))
        module_keys = {normalise(programme_name), normalise(module_programme_id)}
        if existing_programme_keys.intersection(module_keys):
            continue
        # Never resurrect an archived programme from its surviving children.
        if archived_keys.intersection(module_keys):
            continue
        key = normalise(module_programme_id) or normalise(programme_name)
        module_only_programmes.setdefault(key, {
            'name': programme_name,
            'sourceId': module_programme_id or programme_name,
            'modules': [],
        })['modules'].append(module)

    for item in module_only_programmes.values():
        free_programme_modules = item['modules']
        source_id = item['sourceId']
        programme_name = item['name']
        cohort_keys = {
            normalise(module.get('cohortId') or module.get('cohort'))
            for module in free_programme_modules
            if normalise(module.get('cohortId') or module.get('cohort'))
        }
        group_keys = {
            normalise(module.get('groupId') or module.get('group'))
            for module in free_programme_modules
            if normalise(module.get('groupId') or module.get('group'))
        }
        session_count = sum(parse_int(module.get('weeks') or module.get('sessionsNumber') or module.get('sessions'), 0) for module in free_programme_modules)
        enriched_programmes.append({
            'id': source_id,
            'sourceId': source_id,
            'name': programme_name,
            'standard': programme_name,
            'level': infer_level(programme_name),
            'status': 'planned',
            'modules': len(free_programme_modules),
            'groups': len(group_keys),
            'weeks': session_count,
            'ksbMapped': 0,
            'ksbTotal': 0,
            # A planned programme has no authoring rows and no roster yet, so
            # learner-consumed progress is genuinely zero rather than unknown.
            # The keys are still emitted so every programme card reads one shape.
            'learnerKsbProgressPercentage': 0,
            'learnerKsbConsumedWeight': 0.0,
            'learnerKsbExpectedWeight': 0.0,
            'learnerKsbLearnerCount': 0,
            'learnerKsbCodesStarted': 0,
            'learnerKsbCodesComplete': 0,
            'learnerKsbCodesTotal': 0,
            'learnerKsbAchievedCount': 0,
            'learnerKsbTargetCount': 0,
            'learnerKsbAchievementPercentage': 0,
            'learners': 0,
            'cohorts': len(cohort_keys),
            'lastUpdated': max([clean_str(module.get('lastUpdated')) for module in free_programme_modules] or ['']),
            'owner': '',
            'color': clean_str(free_programme_modules[0].get('color')) or '#6941c6',
            'description': '',
            'structureType': 'scheduled',
            'freeComponents': 0,
        })
    return enriched_programmes


def programme_list_needs_module_enrichment(
    programmes,
    source,
    counts,
    *,
    include_archived,
    is_archived_program_config,
    module_matches_programme=_default_module_matches_programme,
    normalise=_default_normalise,
    programme_structure_counts,
):
    known = {
        normalise(programme.get(key)) for programme in programmes
        for key in ('id', 'sourceId', 'name', 'standard')
    }
    if not include_archived:
        known.update(
            normalise(config.get(key)) for config in source['program_configs']
            if is_archived_program_config(config)
            for key in ('programme_id', 'program_id', 'id', 'name')
        )
    if any(
        normalise(row.get('programme_name')) not in known | {'', 'unassigned', 'unassignedprogramme'}
        for row in source['modules']
    ):
        return True
    for programme in programmes:
        if programme_structure_counts(programme, *counts):
            continue
        # Enrichment leaves authoritative counts alone. A truly empty programme
        # also stays empty; ambiguous/archived ownership keeps the full path.
        if programme['modules'] or any(
            module_matches_programme(programme, {
                'programmeId': row.get('programme_id'), 'programme': row.get('programme_name'),
            }) for row in source['modules']
        ):
            return True
    return False


def home_programmes_need_enrichment(
    overview,
    authoring_rows,
    program_configs,
    *,
    include_archived=False,
    is_archived_program_config,
    normalise=_default_normalise,
):
    """Conservatively detect whether enrichment can introduce a programme.

    Existing programme counts are not Home inputs. If every possible programme
    name is already represented, the content-count queries used to rank module
    matches cannot affect the projected result. Unknown names keep the complete
    matching/archive logic, including programmes that exist only through modules.
    """
    known = {
        normalise(programme.get(field))
        for programme in overview['programmes']
        for field in ('id', 'sourceId', 'name', 'standard')
    }
    if not include_archived:
        # Enrichment cannot resurrect programmes explicitly archived by staff.
        known.update(
            normalise(config.get(field))
            for config in program_configs if is_archived_program_config(config)
            for field in ('programme_id', 'program_id', 'id', 'name')
        )
    names = [module.get('programme') or module.get('programmeName') for module in overview['modules']]
    names.extend(row.get('programme_name') for row in authoring_rows)
    return any(
        normalise(name) not in known | {'', 'unassigned', 'unassignedprogramme'}
        for name in names
    )
