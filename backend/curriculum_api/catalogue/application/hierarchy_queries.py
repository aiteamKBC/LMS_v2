"""Resolve programme/cohort/group read results and learner-count fingerprints."""

from curriculum_api.catalogue.domain.delivery_identity import actual_cohort_identity as _default_actual_cohort_identity
from curriculum_api.catalogue.domain.delivery_identity import actual_group_identity as _default_actual_group_identity
from curriculum_api.catalogue.domain.hierarchy_values import find_programme as _default_find_programme
from curriculum_api.catalogue.domain.hierarchy_values import programme_config_id as _default_programme_config_id
from curriculum_api.catalogue.domain.programme_identity import programme_identity as _default_programme_identity
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import slugify as _default_slugify


def rows_for_programme(
    identifier,
    visibility='all',
    *,
    build_curriculum_payload_from_rows,
    clean_str=_default_clean_str,
    curriculum_read_scope,
    find_programme=_default_find_programme,
    get_curriculum_rows,
    program_config_by_id,
    programme_identity=_default_programme_identity,
):
    with curriculum_read_scope():
        curriculum_rows = get_curriculum_rows()
        payload = build_curriculum_payload_from_rows(curriculum_rows, visibility)
        programme = find_programme(payload, identifier)
        if not programme:
            return None, []
        rows = []
        configs_by_id = program_config_by_id(curriculum_rows['program_configs'])
        for row in curriculum_rows['training']:
            identity = programme_identity(row, configs_by_id)
            if (
                clean_str(identity['sourceId']) == clean_str(programme['sourceId'])
                or clean_str(identity['name']) == clean_str(programme['name'])
            ):
                rows.append(row)
        return programme, rows


def find_training_rows_by_cohort(
    cohort_id,
    *,
    actual_cohort_identity=_default_actual_cohort_identity,
    build_cohorts_and_groups,
    clean_str=_default_clean_str,
    get_program_config_rows,
    get_training_rows,
    program_config_by_id,
    programme_identity=_default_programme_identity,
):
    rows = get_training_rows()
    program_configs = get_program_config_rows()
    cohorts, _ = build_cohorts_and_groups(rows, program_configs)
    cohort = next((item for item in cohorts if clean_str(item['id']) == clean_str(cohort_id)), None)
    if not cohort:
        return None, []
    matches = []
    configs_by_id = program_config_by_id(program_configs)
    for row in rows:
        identity = programme_identity(row, configs_by_id)
        candidate = actual_cohort_identity(row, identity['name'])
        if candidate and candidate['id'] == cohort['id']:
            matches.append(row)
    return cohort, matches


def find_group_with_parent(
    group_id,
    *,
    actual_cohort_identity=_default_actual_cohort_identity,
    actual_group_identity=_default_actual_group_identity,
    build_cohorts_and_groups,
    clean_str=_default_clean_str,
    get_program_config_rows,
    get_training_rows,
    program_config_by_id,
    programme_identity=_default_programme_identity,
):
    rows = get_training_rows()
    program_configs = get_program_config_rows()
    cohorts, groups = build_cohorts_and_groups(rows, program_configs)
    group = next((item for item in groups if clean_str(item['id']) == clean_str(group_id)), None)
    if not group:
        return None, None, []
    cohort = next((item for item in cohorts if item['id'] == group['cohortId']), None)
    configs_by_id = program_config_by_id(program_configs)
    training_rows = []
    for row in rows:
        identity = programme_identity(row, configs_by_id)
        row_cohort = actual_cohort_identity(row, identity['name'])
        candidate = actual_group_identity(row, row_cohort['id']) if row_cohort else None
        if candidate and candidate['id'] == group['id']:
            training_rows.append(row)
    return group, cohort, training_rows


def programme_config_by_identifier(
    identifier,
    *,
    clean_str=_default_clean_str,
    get_program_config_rows,
    programme_config_id=_default_programme_config_id,
    slugify=_default_slugify,
):
    ident = clean_str(identifier)
    fallback = None
    for config in get_program_config_rows():
        config_id = programme_config_id(config)
        exact_candidates = {
            config_id,
            clean_str(config.get('programme_id')),
            clean_str(config.get('program_id')),
            clean_str(config.get('id')),
            f'program-{slugify(config_id)}',
        }
        name_candidates = {
            slugify(config_id),
            slugify(config.get('programme_id')),
            slugify(config.get('program_id')),
            slugify(config.get('name')),
            f'program-{slugify(config.get("name"))}',
        }
        if ident in exact_candidates:
            return config
        if not fallback and ident in name_candidates:
            fallback = config
    return fallback


def first_programme_response(
    *identifiers,
    build_curriculum_payload,
    clean_str=_default_clean_str,
    find_programme=_default_find_programme,
):
    """First programme matching any of ``identifiers``, from a single payload build.

    ``programme_response(a) or programme_response(b)`` assembled the whole
    curriculum payload once per identifier tried; the fallbacks only ever differ
    in what they look up, never in the data they look it up in.
    """
    wanted = [clean_str(identifier) for identifier in identifiers if clean_str(identifier)]
    if not wanted:
        return None
    payload = build_curriculum_payload('all', force=True)
    for identifier in wanted:
        programme = find_programme(payload, identifier)
        if programme:
            return programme
    return None


def programme_shell_learner_fingerprint(
    *, active_learner_delivery_counts, active_learner_programme_counts,
):
    """The learner data the shell's 60s ttl stands in for, as it stands now.

    Every learner figure in the shell -- the programme's own count and each
    cohort's and group's -- is folded from these two grouped reads and nothing
    else (build_programmes, build_cohorts_and_groups). Both are memoised in the
    read scope, so the build that follows this call reads exactly these rows.
    The rest of the shell is curriculum data, retired by the programme's cache
    generation like the modules section's.
    """
    def ordered(counts):
        return tuple(sorted(counts.items(), key=repr))

    by_id, by_name = active_learner_programme_counts()
    cohort_counts, group_counts = active_learner_delivery_counts()
    return tuple(ordered(counts) for counts in (by_id, by_name, cohort_counts, group_counts))


def programme_response(
    identifier,
    *,
    build_curriculum_payload,
    find_programme
):
    payload = build_curriculum_payload('all', force=True)
    programme = find_programme(payload, identifier)
    if not programme:
        return None
    return programme
