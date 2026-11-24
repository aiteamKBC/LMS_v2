"""Construct programme cards using explicitly supplied existing read capabilities.

Owns grouping, ordering, visibility and payload construction. Identity selection belongs to the domain;
KSB and count readers remain at the composition boundary; no Django or views
imports, database startup or writer capabilities are introduced here.
"""
from collections import Counter, defaultdict
from ..domain.programme_identity import (
    programme_config_identity, programme_identity, unique_program_configs_for_display,
)

from curriculum_api.catalogue.domain.delivery_identity import actual_cohort_identity as _default_actual_cohort_identity
from curriculum_api.catalogue.domain.delivery_identity import actual_group_identity as _default_actual_group_identity
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at as _default_format_created_at
from curriculum_api.catalogue.domain.hierarchy_values import infer_level as _default_infer_level
from curriculum_api.catalogue.domain.hierarchy_values import is_actual_delivery_row as _default_is_actual_delivery_row
from curriculum_api.catalogue.domain.hierarchy_values import parse_required_otjh as _default_parse_required_otjh
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import slugify as _default_slugify
from curriculum_api.catalogue.domain.values import unique as _default_unique


def build_programmes(
    training_rows,
    program_configs,
    ksb_profiles,
    include_config_only=False,
    only_stats_for_ids=None,
    *,
    include_learner_counts=True,
    include_structure_counts=True,
    structure_counts=None,
    learner_counts=None,
    _programme_ksb_stats,
    active_learner_programme_counts,
    actual_cohort_identity=_default_actual_cohort_identity,
    actual_group_identity=_default_actual_group_identity,
    applied_standard_name,
    applied_standard_required_codes,
    authoring_programme_structure_counts,
    clean_str=_default_clean_str,
    format_created_at=_default_format_created_at,
    format_date=_default_format_date,
    infer_level=_default_infer_level,
    is_actual_delivery_row=_default_is_actual_delivery_row,
    is_archived_program_config,
    is_operational_training_row,
    ksb_profile_required_codes,
    ksb_profile_source_id,
    normalise=_default_normalise,
    normalise_ksb_profile_source_value,
    parse_int=_default_parse_int,
    parse_required_otjh=_default_parse_required_otjh,
    program_config_by_id,
    programme_applied_ksb_profile,
    programme_config_status,
    programme_structure_counts,
    slugify=_default_slugify,
    unique=_default_unique,
):
    configs_by_id = program_config_by_id(program_configs)
    grouped = defaultdict(list)
    group_meta = {}
    order = {}
    # Cohorts, groups, modules and weeks all come from the same read of the
    # tables that own them, so the card cannot disagree with the programme's own
    # page about any of the four.
    structure_counts_by_id, structure_counts_by_name = structure_counts if structure_counts is not None else (
        authoring_programme_structure_counts() if include_structure_counts else ({}, {})
    )
    standard_codes = {}

    display_program_configs = unique_program_configs_for_display(
        program_configs, normalise=normalise, clean_str=clean_str, parse_int=parse_int,
        is_archived_program_config=is_archived_program_config,
    )
    row_programme_names = set()
    row_programme_source_ids = set()
    for row in training_rows:
        identity = programme_identity(row, configs_by_id, clean_str=clean_str, normalise=normalise, slugify=slugify)
        row_programme_names.add(normalise(identity['name']))
        row_programme_source_ids.add(clean_str(identity['sourceId']))

    for config in display_program_configs:
        config_id = programme_config_identity(config, clean_str=clean_str)
        if not config_id:
            continue
        config_name = clean_str(config.get('name'))
        # Skip if this programme is already in the grouped dict (from training rows)
        # Only skip if the ID exactly matches an existing key
        already_grouped = any(
            clean_str(meta.get('sourceId')) == config_id
            for meta in group_meta.values()
        )
        if already_grouped:
            continue
        key = f'id:{config_id}'
        grouped[key] = []
        group_meta[key] = {
            'name': config.get('name'),
            'sourceId': config_id,
            'config': config,
        }
        order[key] = len(order)

    for config in display_program_configs:
        config_id = programme_config_identity(config, clean_str=clean_str)
        if config_id:
            order.setdefault(f'id:{config_id}', len(order))

    for row in training_rows:
        identity = programme_identity(row, configs_by_id, clean_str=clean_str, normalise=normalise, slugify=slugify)
        key = identity['key']
        grouped[key].append(row)
        group_meta.setdefault(key, {
            'name': identity['name'],
            'sourceId': identity['sourceId'],
            'config': identity['config'],
        })
        existing_order = order.get(key)
        row_order = row.get('programme_display_order')
        if existing_order is None:
            order[key] = row_order if row_order is not None else len(order)
        elif row_order is not None:
            order[key] = min(existing_order, row_order)

    # Ensure programmes without training rows are included
    for config in display_program_configs:
        config_id = programme_config_identity(config, clean_str=clean_str)
        config_name = config.get('name')
        key = f'id:{config_id}' if config_id else f'name:{normalise(config_name)}'
        if key not in grouped:
            grouped[key] = []
            group_meta[key] = {
                'name': config_name,
                'sourceId': config_id,
                'config': config,
            }
            if key not in order:
                order[key] = len(order)

    programme_learner_counts_by_id, programme_learner_counts_by_name = learner_counts if learner_counts is not None else (
        active_learner_programme_counts() if include_learner_counts else ({}, {})
    )
    programmes = []
    for key, rows in sorted(grouped.items(), key=lambda item: order.get(item[0], 999)):
        meta = group_meta.get(key, {})
        config = meta.get('config')
        name = meta.get('name') or (Counter(row.get('Program') for row in rows if row.get('Program')).most_common(1)[0][0] if rows else 'Unassigned Programme')
        source_id = meta.get('sourceId') or slugify(name)
        # The stored source decides which manual profile, if any, speaks for this
        # programme; matching by name is only the fallback for a row storing none.
        profile = programme_applied_ksb_profile(
            config, ksb_profiles, name, *(unique(row.get('Program') for row in rows) if rows else []),
        )
        operational_rows = [row for row in rows if is_operational_training_row(row)]
        metric_rows = operational_rows if operational_rows else []
        delivery_rows = [row for row in metric_rows if is_actual_delivery_row(row, configs_by_id)]
        module_names = unique(row.get('module_name') for row in delivery_rows)
        cohort_names = unique(row.get('Cohort_name') for row in delivery_rows)
        group_keys = set()
        for row in delivery_rows:
            row_cohort = actual_cohort_identity(row, programme_identity(row, configs_by_id, clean_str=clean_str, normalise=normalise, slugify=slugify)['name'])
            row_group = actual_group_identity(row, row_cohort['id']) if row_cohort else None
            if row_group:
                group_keys.add(row_group['id'])
        required_ksb_codes = applied_standard_required_codes(config, standard_codes)
        if required_ksb_codes is None:
            required_ksb_codes = ksb_profile_required_codes(profile)
        ksb_total = len(required_ksb_codes)
        profile_source = ksb_profile_source_id(profile) if profile else ''
        config_archived = is_archived_program_config(config)
        config_active = not config_archived
        archived = (rows and not operational_rows and not config) or (not rows and config_archived)
        # An explicitly archived programme is hidden from the operational list.
        # include_config_only is set when visibility == 'all', which is the
        # caller asking to see archived records too.
        if (config_archived or not config_active) and not include_config_only:
            continue
        # programmes.sub/standard/structure_type were dropped. The standard now
        # names the applied source -- the standard, else the applied profile --
        # falling back to the programme name; every programme is 'scheduled'.
        standard = applied_standard_name(config, standard_codes) or (profile.get('name') if profile else None) or name
        level = (config or {}).get('level') or infer_level(standard) or infer_level(name)
        structure_type = 'scheduled'
        # The authoring tables answer for every programme that has any row of its
        # own. A programme that exists only as legacy delivery rows has no entry
        # there and keeps the figures derived from those rows just above.
        structure_counts = programme_structure_counts(
            {'id': source_id, 'sourceId': source_id, 'name': name},
            structure_counts_by_id,
            structure_counts_by_name,
        ) or {}
        # curriculum.free_course_weeks is NOT read here. It carries no
        # programme_id -- ownership is only expressed through
        # free_programme_components (see free_programme_owned_ids) -- so the
        # per-programme tally this used to attempt was always zero, and the
        # branch that would have read it was unreachable behind the fixed
        # structure_type above. What it did cost was a `select *` over a table
        # whose cover_image_url column holds base64 image payloads: ~1.9 MB and
        # several seconds on every cold overview build, for a number nothing
        # could use.
        programme_modules_count = structure_counts.get('modules', len(delivery_rows))
        programme_cohorts_count = structure_counts.get('cohorts', len(cohort_names))
        programme_groups_count = structure_counts.get('groups', len(group_keys))
        programme_weeks_count = structure_counts.get(
            'weeks', sum(parse_int(row.get('sessions_number')) for row in delivery_rows)
        )
        programme_status = 'archived' if archived or config_archived else programme_config_status(config)
        if programme_status == 'draft' and not include_config_only:
            continue

        programmes.append({
            'id': source_id,
            'sourceId': source_id,
            'name': name,
            'standard': standard,
            'level': level,
            'status': programme_status,
            'isArchived': config_archived,
            'isActive': config_active,
            'modules': programme_modules_count,
            'groups': programme_groups_count,
            'weeks': programme_weeks_count,
            **_programme_ksb_stats(source_id, required_ksb_codes, only_stats_for_ids),
            'ksbTotal': ksb_total,
            'learners': (
                programme_learner_counts_by_id.get(clean_str(source_id), 0)
                + programme_learner_counts_by_name.get(normalise(name), 0)
            ),
            'cohorts': programme_cohorts_count,
            'lastUpdated': format_date((profile or config or {}).get('updated_at') or (profile or config or {}).get('created_at')),
            # When the record was first written, for a "recently added" sort. Blank
            # for rows predating the column, which sort last rather than first.
            'createdAt': format_created_at((config or {}).get('created_at') or (profile or {}).get('created_at')),
            'owner': (profile or {}).get('created_by') or '',
            'color': (config or {}).get('color') or (rows[0].get('_meta', {}).get('cohort_color') if rows else '#6941c6'),
            'description': (config or {}).get('description') or (profile or {}).get('description') or '',
            'structureType': structure_type,
            'ksbProfileSourceId': normalise_ksb_profile_source_value((config or {}).get('ksb_profile_source_id') or ''),
            'requiredOtjh': parse_required_otjh((config or {}).get('required_otjh')),
            # Always 0, exactly as before: the tally this reported was keyed on
            # a free_course_weeks.programme_id column that does not exist, so no
            # row ever matched. The field stays in the payload because the
            # frontend type declares it (CurriculumProgramme.freeComponents).
            'freeComponents': 0,
            # The card's place in the hand-picked order. Reading it back is what
            # lets the grid tell a saved order from the alphabetical fallback.
            'displayOrder': parse_int((config or {}).get('display_order'), 0),
        })
    return programmes
