"""Curriculum overview assembly over explicit read and projection contracts.

No HTTP, cache, database or provider ownership lives here.
"""


class CurriculumOverviewUnavailable(RuntimeError):
    """Required overview source rows could not be read completely."""

from curriculum_api.catalogue.application.cohort_calendar import serialize_holiday_row as _default_serialize_holiday_row
from curriculum_api.catalogue.application.scope_identity import module_matches_visible_programmes as _default_module_matches_visible_programmes
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def build_curriculum_payload_from_rows(
    rows,
    visibility='operational',
    compact=False,
    *,
    home_summary=False,
    module_list=False,
    delivery_source=None,
    programme_list=False,
    learner_profiles=False,
    CURRICULUM_SCHEMA,
    attach_module_assignment_counts,
    build_cohorts_and_groups,
    build_ksb_data,
    build_modules,
    build_programmes,
    build_staff_profiles,
    clean_str=_default_clean_str,
    cohort_authoring_detail_rows,
    curriculum_sessions_from_rows,
    enrich_modules_with_authoring,
    group_authoring_detail_rows,
    is_archived_module_summary,
    is_operational_training_row,
    module_authoring_row_is_archived,
    module_matches_visible_programmes=_default_module_matches_visible_programmes,
    parse_int=_default_parse_int,
    programme_deleted_row,
    serialize_holiday_row=_default_serialize_holiday_row,
):
    if (home_summary or module_list or programme_list) and not compact:
        raise ValueError('The Home summary requires compact source rows.')
    training_rows = rows['training'] if visibility == 'all' else [row for row in rows['training'] if is_operational_training_row(row)]
    ksb_profiles = rows['ksb_profiles'] if visibility == 'all' else [profile for profile in rows['ksb_profiles'] if profile.get('is_active')]
    authoring_modules = rows['authoring_modules'] if visibility == 'all' else [
        row for row in rows['authoring_modules']
        if not programme_deleted_row(row)
    ]
    modules = build_modules(
        rows['modules'],
        training_rows,
        rows['program_configs'],
        include_unused=visibility == 'all',
    )
    programmes = build_programmes(
        training_rows,
        rows['program_configs'],
        ksb_profiles,
        include_config_only=visibility == 'all',
        # No per-programme KSB statistics in a list payload. `ksbMapped` and the
        # learner-progress figures each re-read a programme's whole authoring
        # tree and its learners' progress; computing them for every programme was
        # 69s of an 84s build, and this payload is shared by /overview/,
        # /modules/ and /programmes/ -- so the Module Builder, which renders
        # neither number, waited for all thirty of them before it could draw a
        # single module card. They are served per programme by
        # curriculum_programme_ksb_stats() instead, and the Programmes page
        # fills its cards in behind the list. See _programme_ksb_stats for the
        # placeholder every programme gets here.
        only_stats_for_ids=frozenset(),
        include_learner_counts=not (home_summary or module_list),
        # A module list only uses programme identities for visibility. Its own
        # week/content figures are calculated by the module enrichment below.
        include_structure_counts=not (home_summary or module_list),
    )
    if visibility != 'all':
        # Delivery rows can outlive an authoring module's archive row. In that
        # state build_modules() still has enough data to produce a plausible
        # published row, although the structure endpoint cannot serve it.
        #
        # ``source_id`` is read here because a training-plan-sourced authoring
        # row carries its own identity there rather than in
        # ``module_catalogue_id``. On a *duplicated* module the same column
        # means something else entirely -- the id of the module it was copied
        # from -- so archiving a copy used to take its still-live original out
        # of every module list with it. An id a live authoring row owns
        # outright is therefore never treated as archived.
        live_catalogue_ids = {
            clean_str(row.get('module_catalogue_id'))
            for row in (rows.get('authoring_modules') or [])
            if not module_authoring_row_is_archived(row)
            and clean_str(row.get('module_catalogue_id'))
        }
        archived_catalogue_ids = {
            clean_str(value)
            for row in (rows.get('authoring_modules') or [])
            if module_authoring_row_is_archived(row)
            for value in (row.get('module_catalogue_id'), row.get('source_id'))
            if clean_str(value)
        } - live_catalogue_ids
        modules = [
            module for module in modules
            if clean_str(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('id'))
            not in archived_catalogue_ids
        ]
        modules = [
            module for module in modules
            if (
                not programme_deleted_row(module)
                and module_matches_visible_programmes(module, programmes)
            )
        ]
    if not compact:
        modules = enrich_modules_with_authoring(modules, include_programme_deleted=visibility == 'all')
    if visibility != 'all':
        # Full enrichment can append authoring-only rows and carry archive
        # status from the authoring summary, so apply the rule again.
        modules = [module for module in modules if not is_archived_module_summary(module)]
    if programme_list:
        # The legacy programme-count fallback needs these identities, not module
        # learner assignments, cohort calendars or the complete KSB library.
        return {'schema': CURRICULUM_SCHEMA, 'programmes': programmes, 'modules': modules}
    if not home_summary:
        identity_options = {'learner_profiles': True} if learner_profiles else {}
        attach_module_assignment_counts(modules, **identity_options)
    if module_list:
        # Programme metadata above is needed for the existing visibility rules;
        # cohorts, group learner counts and the KSB library are not list inputs.
        return {'schema': CURRICULUM_SCHEMA, 'modules': modules}
    cohorts, groups = build_cohorts_and_groups(
        training_rows,
        rows['program_configs'],
        include_archived=visibility == 'all',
        include_learner_counts=not home_summary,
        **({'source': delivery_source} if delivery_source is not None else {}),
    )
    if compact:
        sessions = []
        session_count = sum(parse_int(group.get('sessions'), 0) for group in groups)
    else:
        sessions = curriculum_sessions_from_rows(
            rows, training_rows, authoring_modules, cohorts, groups, rows.get('holidays', []),
        )
        session_count = len(sessions)
    # Every active profile is exposed, whether or not a programme currently
    # points at it. A KSB framework is a reusable standard (an IfATE profile is
    # shared by many programmes and outlives all of them), and this payload backs
    # the framework library page, where an unattached profile is precisely what
    # the user has to be able to see in order to attach it. Filtering the library
    # by programme linkage made a newly-created framework vanish on save.
    # `is_active` above is the intended soft-delete for a profile.
    frameworks, ksb_profiles = ([], []) if home_summary else build_ksb_data(ksb_profiles, modules, training_rows)

    # Bank holidays have no archived state -- nobody authors or retires them --
    # so every visibility sees the same calendar.
    holiday_rows = rows['holidays']

    payload = {
        'schema': CURRICULUM_SCHEMA,
        'visibility': visibility,
        'stats': {
            'programmes': len(programmes),
            'activeProgrammes': len(programmes),
            'cohorts': len(cohorts),
            'groups': len(groups),
            'modules': len(modules),
            'ksbFrameworks': len(frameworks),
            'sessions': session_count,
        },
        'programmes': programmes,
        'modules': modules,
        'ksbFrameworks': frameworks,
        'ksbSets': ksb_profiles,
        'cohorts': cohorts,
        'groups': groups,
        'sessions': sessions,
        'holidays': [] if compact else [serialize_holiday_row(item) for item in holiday_rows],
        'cohortAuthoringDetails': [] if compact else cohort_authoring_detail_rows(),
        'groupAuthoringDetails': [] if compact else group_authoring_detail_rows(),
        'tutors': [] if compact else build_staff_profiles(rows['tutors'], 'tutor', modules, groups),
        'coaches': [] if compact else build_staff_profiles(rows['coaches'], 'coach', modules, groups),
        'tutorModules': [] if compact else rows['tutor_modules'],
    }
    return payload


def build_curriculum_rows(source, *, project_training, project_catalogue):
    """Project a complete read bundle into the existing shared-row contract."""
    return {
        # Internal read bundle: required overview enrichment must reuse these
        # successful reads rather than consult tolerant post-save readers.
        '_delivery_rows': {
            'modules': source['authoring_modules'],
            'cohorts': source['cohort_rows'],
            'groups': source['group_rows'],
        },
        'training': project_training(
            ensure_tables=False, module_rows=source['authoring_modules'],
            group_rows=source['group_rows'], cohort_rows=source['cohort_rows'],
        ),
        'modules': project_catalogue(
            module_rows=source['authoring_modules'], week_rows=source['week_rows'],
        ),
        **{key: source[key] for key in (
            'authoring_modules', 'ksb_profiles', 'program_configs',
            'holidays', 'tutors', 'coaches', 'tutor_modules',
        )},
    }


def required_delivery_source(rows, *, compact, read_holidays, serialize_cohort, project_groups):
    """Project the same verified rows into delivery and authoring detail contracts."""
    source = rows['_delivery_rows']
    try:
        holidays = read_holidays() if compact else rows['holidays']
        return {
            'modules': source['modules'],
            'cohorts': [serialize_cohort(row, holidays) for row in source['cohorts']],
            'groups': project_groups(source['groups'], source['modules']),
        }
    except Exception as exc:
        raise CurriculumOverviewUnavailable('Curriculum overview unavailable. Please retry.') from exc


def get_curriculum_rows(compact=False, *,
    AUTHORING_WEEKS_TABLE,
    WEEK_INDEX_COLUMNS,
    get_authoring_module_rows,
    get_coach_rows,
    get_holiday_rows,
    get_ksb_profile_rows,
    get_module_rows,
    get_program_config_rows,
    get_training_rows,
    get_tutor_module_rows,
    get_tutor_rows,
    prefetch_authoring_reads,
    training_index_reads,
):
    # The authoring reads the readers below make, in one round trip rather than
    # five; each reader still makes its own call and finds its rows memoised.
    prefetch_authoring_reads([
        *training_index_reads(),
        ((AUTHORING_WEEKS_TABLE,), {'columns': WEEK_INDEX_COLUMNS}),
    ])
    rows = {
        'training': get_training_rows(),
        'modules': get_module_rows(),
        'authoring_modules': get_authoring_module_rows(),
        'ksb_profiles': get_ksb_profile_rows(),
        'program_configs': get_program_config_rows(),
    }
    if compact:
        return {
            **rows,
            'holidays': [],
            'tutors': [],
            'coaches': [],
            'tutor_modules': [],
        }
    return {
        **rows,
        'holidays': get_holiday_rows(),
        'tutors': get_tutor_rows(),
        'coaches': get_coach_rows(),
        'tutor_modules': get_tutor_module_rows(),
    }
