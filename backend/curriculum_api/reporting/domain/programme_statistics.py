"""Pure mapped-code, expected-weight and learner achievement calculations."""


def mapped_ksb_count(module_rows, mapping_rows, required, *, clean_str, coverage_normalise_code):
    module_ids = {clean_str(row.get('module_catalogue_id')) for row in module_rows if clean_str(row.get('module_catalogue_id'))}
    mapped = set()
    for row in mapping_rows:
        if clean_str(row.get('module_catalogue_id')) not in module_ids:
            continue
        if not clean_str(row.get('component_id')):
            continue
        code = coverage_normalise_code(row.get('ksb_code'))
        if not code:
            continue
        matched_code = code
        if required and matched_code not in required:
            parent_code = code.split('.', 1)[0]
            if parent_code in required:
                matched_code = parent_code
            else:
                continue
        mapped.add(matched_code)
    return len(mapped)


def expected_ksb_weights(coverage, *, coverage_normalise_code):
    # Denominator: mapped weight per KSB. A code the design never mapped carries
    # no expected weight, so it cannot drag the percentage down.
    expected = {}
    for item in coverage.get('items', []):
        code = coverage_normalise_code(item.get('code'))
        if not code:
            continue
        weight = float(item.get('raw_total_weight') or item.get('rawTotalWeight') or 0)
        if weight > 0:
            expected[code] = expected.get(code, 0.0) + weight
    return expected


def apply_programme_progress(
    result,
    expected,
    learner_ids,
    progress_totals,
    declared,
    *,
    float_weight,
    merge_ksb_totals,
):
    achieved = merge_ksb_totals(progress_totals)
    consumed_total = 0.0
    started_codes = set()
    complete_codes = set()
    achieved_pairs = set()
    # Summed per learner against a per-learner denominator: the programme figure
    # is the cohort's average completion of the mapped weight, not one learner's
    # progress diluted across the roster.
    for learner_id in learner_ids:
        weights = achieved.get(learner_id, {}) or {}
        learner_codes = {
            code for code, weight in weights.items()
            if float(weight or 0) > 0
        }
        learner_codes.update(declared.get(learner_id, set()))
        achieved_pairs.update((learner_id, code) for code in learner_codes if code in expected)
        for code, expected_weight in expected.items():
            consumed_weight = float(weights.get(code, 0) or 0)
            if consumed_weight <= 0:
                continue
            started_codes.add(code)
            if consumed_weight >= expected_weight:
                complete_codes.add(code)
            consumed_total += min(consumed_weight, expected_weight)

    expected_total = sum(expected.values()) * len(learner_ids)
    result['learnerKsbConsumedWeight'] = float_weight(consumed_total)
    result['learnerKsbExpectedWeight'] = float_weight(expected_total)
    result['learnerKsbProgressPercentage'] = (
        min(round((consumed_total / expected_total) * 100), 100) if expected_total else 0
    )
    result['learnerKsbCodesStarted'] = len(started_codes)
    result['learnerKsbCodesComplete'] = len(complete_codes)
    result['learnerKsbAchievedCount'] = len(achieved_pairs)
    result['learnerKsbTargetCount'] = len(expected) * len(learner_ids)
    result['learnerKsbAchievementPercentage'] = (
        min(round((len(achieved_pairs) / result['learnerKsbTargetCount']) * 100), 100)
        if result['learnerKsbTargetCount'] else 0
    )
    return result


def sum_ordered_progress_weights(rows, *, coverage_normalise_code, float_weight):
    totals = {}
    for row in rows:
        code = coverage_normalise_code(row['ksb_code'])
        total = 0.0
        for weight in row['weights']:
            total += float_weight(weight or 0)
        totals.setdefault(row['learner_id'], {})[code] = total
    return totals
