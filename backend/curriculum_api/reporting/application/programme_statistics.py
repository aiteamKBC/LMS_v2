"""Coordinate programme design counts and learner achievement statistics."""
import hashlib
import json
from collections import Counter

from ..domain.programme_statistics import mapped_ksb_count, expected_ksb_weights, apply_programme_progress, sum_ordered_progress_weights


def _programme_ksb_stats(
    source_id,
    required_ksb_codes,
    only_stats_for_ids,
    *,
    clean_str,
    programme_component_ksb_mapping_count,
    programme_learner_ksb_progress,
):
    """The two per-programme reads build_programmes() would otherwise run for
    every programme in the system just to keep the one the caller wants.

    ``programme_component_ksb_mapping_count`` and ``programme_learner_ksb_progress``
    each re-read authoring data for one programme. On ~20 programmes that is ~40
    round trips to a remote database when only one programme's numbers are ever
    used -- see ``_build_curriculum_programme_tree_detail_payload``, which used to
    pay this cost for every programme in the system just to find the one it was
    asked for. ``only_stats_for_ids`` restricts the real computation to that set;
    every other programme gets the same placeholder its card would show before
    anything was ever mapped.
    """
    if only_stats_for_ids is not None and clean_str(source_id) not in only_stats_for_ids:
        return {
            'ksbMapped': 0,
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
        }
    return {
        'ksbMapped': programme_component_ksb_mapping_count(source_id, required_ksb_codes),
        **programme_learner_ksb_progress(source_id, required_ksb_codes),
    }


def programme_component_ksb_mapping_count(
    programme_id,
    required_codes=None,
    *,
    _ProgrammeKsbDesignUnavailable,
    _programme_component_ksb_mapping_count,
    coverage_normalise_code,
    logger,
    programme_ksb_design_value,
):
    """Distinct required KSBs actually mapped to this programme's components."""
    required = {coverage_normalise_code(code) for code in (required_codes or []) if coverage_normalise_code(code)}
    try:
        return programme_ksb_design_value(
            'mapped', programme_id,
            lambda: _programme_component_ksb_mapping_count(programme_id, required),
            extra_key=hashlib.sha256(json.dumps(sorted(required)).encode()).hexdigest()[:16],
        )
    except _ProgrammeKsbDesignUnavailable as failure:
        logger.warning('Could not count programme component KSB mappings for %s: %s', programme_id, failure.exc)
        return 0


def _programme_component_ksb_mapping_count(
    programme_id,
    required,
    *,
    _ProgrammeKsbDesignUnavailable,
    authoring_scope_data,
    clean_str,
    coverage_normalise_code,
):
    try:
        module_rows, _week_rows, _component_rows, mapping_rows = authoring_scope_data('programme', programme_id, stats_only=True)
    except Exception as exc:
        raise _ProgrammeKsbDesignUnavailable('scope', exc) from exc
    return mapped_ksb_count(module_rows, mapping_rows, required, clean_str=clean_str, coverage_normalise_code=coverage_normalise_code)


def _programme_ksb_expected_weights(
    programme_id,
    *,
    _ProgrammeKsbDesignUnavailable,
    authoring_scope_data,
    build_coverage,
    coverage_normalise_code,
    infer_source_from_scope,
    mappings_with_inferred_sources,
    required_ksbs_for_resolved_source,
):
    """The design side of programme_learner_ksb_progress: mapped weight per KSB.

    ``{}`` when there is nothing to measure (no modules, nothing mapped); raises
    _ProgrammeKsbDesignUnavailable when a read fails, so a failure is never
    cached as an empty design.
    """
    try:
        module_rows, week_rows, component_rows, mapping_rows = authoring_scope_data('programme', programme_id, stats_only=True)
    except Exception as exc:
        raise _ProgrammeKsbDesignUnavailable('scope', exc) from exc
    if not module_rows:
        return {}
    try:
        mapping_rows = mappings_with_inferred_sources(mapping_rows, module_rows)
        required_ksbs = required_ksbs_for_resolved_source(*infer_source_from_scope(module_rows, 'programme', programme_id))
        coverage = build_coverage(
            required_ksbs,
            mapping_rows,
            module_rows,
            week_rows,
            component_rows,
            include_mapping_only=not bool(required_ksbs),
            totals_only=True,
        )
    except Exception as exc:
        raise _ProgrammeKsbDesignUnavailable('coverage', exc) from exc

    return expected_ksb_weights(coverage, coverage_normalise_code=coverage_normalise_code)


def programme_learner_ksb_progress(
    programme_id,
    required_codes=None,
    *,
    _ProgrammeKsbDesignUnavailable,
    _programme_ksb_expected_weights,
    assigned_learners_for_programme,
    float_weight,
    learner_declared_ksb_codes,
    learner_progress_ksb_totals,
    logger,
    merge_ksb_totals,
    programme_ksb_design_value,
):
    """Learner-achieved KSB progress across a whole programme, as a percentage.

    This is the "what have the learners actually consumed" figure, and it is
    deliberately NOT the same question as
    ``programme_component_ksb_mapping_count`` (which measures how much of the
    standard the *design* touches). The rules here are the same ones the
    programme learner-KSB-impact endpoint applies, so the card and the drill-down
    can never disagree:

      * weighted progress continues to come from the Component Progress
        snapshot (``ksb_learner_progress``); the separate learner/KSB count
        also accepts an explicit KSB declaration in a submitted reflection.
      * per KSB, achieved weight is capped at the mapped weight, so one
        over-weighted activity cannot push the programme past 100%.
      * the denominator is the mapped weight of the programme's components, i.e.
        what the design actually asks the programme learners to consume.

    Returns a dict; every field is 0/empty when there is nothing to measure, so
    the caller never has to special-case a missing programme.
    """
    empty = {
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
    }
    try:
        expected = programme_ksb_design_value(
            'expected', programme_id, lambda: _programme_ksb_expected_weights(programme_id),
        )
    except _ProgrammeKsbDesignUnavailable as failure:
        if failure.message == 'scope':
            logger.warning('Could not load authoring scope for programme KSB progress %s: %s', programme_id, failure.exc)
        else:
            logger.warning('Could not build coverage for programme KSB progress %s: %s', programme_id, failure.exc)
        return empty
    if not expected:
        return empty

    # Keep the learner roster identical to the programme card's Learners
    # metric. This makes the KSB denominator and the visible learner count use
    # the same assignment source.
    learners = assigned_learners_for_programme(programme_id, '')
    learner_ids = [
        int(row.get('id')) for row in learners
        if str(row.get('id') or '').isdigit()
    ]
    result = dict(empty)
    result['learnerKsbLearnerCount'] = len(learner_ids)
    result['learnerKsbCodesTotal'] = len(expected)
    result['learnerKsbExpectedWeight'] = float_weight(sum(expected.values()) * max(len(learner_ids), 1))
    if not learner_ids:
        return result

    declared = learner_declared_ksb_codes(learner_ids, list(expected))
    try:
        # Totals only: this returns a percentage and four counts, never a row.
        # See learner_progress_ksb_totals() for why the drill-down read is the
        # wrong one to ask here.
        progress_totals = learner_progress_ksb_totals(learner_ids, list(expected), compact=True)
    except Exception as exc:
        logger.warning('Could not load learner KSB consumption for programme %s: %s', programme_id, exc)
        progress_totals = {}

    return apply_programme_progress(result, expected, learner_ids, progress_totals, declared, float_weight=float_weight, merge_ksb_totals=merge_ksb_totals)


def grouped_scope_rows(
    module_ids,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_WEEKS_TABLE,
    COMPONENT_COUNT_FIELDS,
    _grouped_rows,
    active_component_rows,
    active_mapping_rows,
    active_week_rows,
):
    """Lossless counts/weights for programme stats, before delivery deduplication."""
    # 'status' (the archive state) is added to every read by _grouped_rows.
    specs = (
        (AUTHORING_WEEKS_TABLE, ('module_catalogue_id',), active_week_rows),
        (AUTHORING_COMPONENTS_TABLE, COMPONENT_COUNT_FIELDS, active_component_rows),
        (AUTHORING_KSB_MAPPINGS_TABLE, ('module_catalogue_id', 'ksb_code', 'source_type', 'source_id', 'weight'), active_mapping_rows),
    )
    ids = sorted(set(module_ids))
    return tuple(_grouped_rows(table, fields, active, ids) for table, fields, active in specs)


def grouped_component_counts(
    module_ids,
    *,
    AUTHORING_COMPONENTS_TABLE,
    COMPONENT_COUNT_FIELDS,
    _grouped_rows,
    active_component_rows,
    clean_str,
):
    """``Counter({module_catalogue_id: active component count})``, counted in SQL.

    What delivery deduplication ranks a module by, without moving every
    component row: the same grouped read and active filter as the programme
    statistics above.
    """
    counts = Counter()
    ids = sorted(set(module_ids))
    if not ids:
        return counts
    for row in _grouped_rows(AUTHORING_COMPONENTS_TABLE, COMPONENT_COUNT_FIELDS, active_component_rows, ids):
        counts[clean_str(row.get('module_catalogue_id'))] += row['_stats_count']
    return counts


def progress_totals(
    learner_ids,
    codes,
    *,
    coverage_normalise_code,
    float_weight,
    latest_progress_weights,
    progress_counts_as_achieved,
    progress_outcomes,
):
    """Select the same latest achieved attempt, transferring ordered weights.

    Python's authoritative completion rule evaluates the small kind/pass set.
    SQL then deduplicates eligible attempts and packs their weights by learner
    and code. Keeping weights ordered (rather than SUM/ROUND in SQL) preserves
    the existing per-row Decimal rounding and floating-point addition exactly.
    """
    outcomes = progress_outcomes(learner_ids)
    eligible = [row for row in outcomes if progress_counts_as_achieved(
        kind=row['kind'], passed=row['passed'],
    )]
    if not eligible:
        return {}
    rows = latest_progress_weights(eligible, learner_ids, codes)
    return sum_ordered_progress_weights(rows, coverage_normalise_code=coverage_normalise_code, float_weight=float_weight)
