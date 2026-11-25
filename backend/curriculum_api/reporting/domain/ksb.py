"""Pure KSB weighting, achievement caps and family aggregation."""
from collections import defaultdict


def parse_ksb_weights(value, *, coverage_normalise_code, float_weight, parse_json_value):
    parsed = parse_json_value(value, {})
    if isinstance(parsed, dict):
        direct = parsed.get('ksbWeights') if isinstance(parsed.get('ksbWeights'), dict) else parsed
        return {
            coverage_normalise_code(code): float_weight(weight)
            for code, weight in direct.items()
            if coverage_normalise_code(code)
            and isinstance(weight, (int, float, str))
            and str(weight).strip() != ''
        }
    if isinstance(parsed, list):
        weights = {}
        for item in parsed:
            if not isinstance(item, dict):
                continue
            code = coverage_normalise_code(item.get('code') or item.get('ksbCode') or item.get('ksb_code'))
            if code:
                weights[code] = float_weight(item.get('weight') or item.get('value') or 0)
        return weights
    return {}


def merge_ksb_totals(*sources, coverage_normalise_code):
    merged = defaultdict(lambda: defaultdict(float))
    for source in sources:
        for learner_id, weights in (source or {}).items():
            for code, weight in (weights or {}).items():
                merged[learner_id][coverage_normalise_code(code)] += float(weight or 0)
    return {learner_id: dict(weights) for learner_id, weights in merged.items()}


def ksb_type_family(ksb_type, code=''):
    """Which of K/S/B a row belongs to, from whichever field survived.

    Coverage carries the type as a word ('Knowledge', 'Skills', 'behaviour', …)
    and the standards import writes it in more than one of those spellings, so
    the first letter is what is actually reliable. A row with no type at all
    still has a code, and ``S4`` is a skill whatever the metadata says.
    """
    letter = str(ksb_type or '').strip().upper()[:1]
    if letter not in {'K', 'S', 'B'}:
        letter = str(code or '').strip().upper()[:1]
    return {'S': 'skill', 'B': 'behaviour'}.get(letter, 'knowledge')


def ksb_achievement_by_type(rows, *, KSB_TYPE_FAMILIES, float_weight, ksb_type_family):
    """One K/S/B family per entry: how many are achieved, and how many missing.

    The per-KSB table answers "how is S4 going". This answers the question asked
    before that one — "how are the skills going, and which families are we not
    touching at all" — which a 71-row table cannot be read for.

    ``missingCount`` is the count a reader is really after: KSBs this scope is
    responsible for that no learner has earned any of yet, whether that is
    because nothing teaches them (``unmappedCount``, a curriculum gap) or
    because nobody has got there (``notStartedCount``, a delivery gap). The two
    are kept apart because they are fixed by different people.
    """
    buckets = {
        family: {
            'type': family,
            'letter': letter,
            'label': label,
            'ksbCount': 0,
            'requiredCount': 0,
            'mappedCount': 0,
            'unmappedCount': 0,
            'unplannedCount': 0,
            'startedCount': 0,
            'completeCount': 0,
            'notStartedCount': 0,
            'missingCount': 0,
            'learnersAchievedTotal': 0,
            'plannedWeightTotal': 0.0,
            'expectedWeightTotal': 0.0,
            'achievedWeightTotal': 0.0,
            'cappedAchievedWeightTotal': 0.0,
        }
        for family, letter, label in KSB_TYPE_FAMILIES
    }
    for row in rows or []:
        bucket = buckets[ksb_type_family(row.get('ksbType'), row.get('code'))]
        bucket['ksbCount'] += 1
        bucket['plannedWeightTotal'] += float(row.get('plannedWeight') or 0)
        bucket['expectedWeightTotal'] += float(row.get('expectedWeightTotal') or 0)
        bucket['achievedWeightTotal'] += float(row.get('achievedWeightTotal') or 0)
        bucket['cappedAchievedWeightTotal'] += float(row.get('cappedAchievedWeightTotal') or 0)
        bucket['learnersAchievedTotal'] += int(row.get('learnersAchievedCount') or 0)
        status = row.get('status')
        if status == 'unplanned':
            # Earned by a learner but authored nowhere here, so it is not one of
            # this scope's KSBs and cannot be one of its gaps either.
            bucket['unplannedCount'] += 1
            if row.get('learnersAchievedCount'):
                bucket['startedCount'] += 1
            continue
        bucket['requiredCount'] += 1
        if status == 'unmapped':
            bucket['unmappedCount'] += 1
        else:
            bucket['mappedCount'] += 1
        if status == 'complete':
            bucket['completeCount'] += 1
        if row.get('learnersAchievedCount'):
            bucket['startedCount'] += 1
        else:
            bucket['notStartedCount'] += 1
            bucket['missingCount'] += 1
    out = []
    for family, _letter, _label in KSB_TYPE_FAMILIES:
        bucket = buckets[family]
        expected = float_weight(bucket['expectedWeightTotal'])
        capped = float_weight(bucket['cappedAchievedWeightTotal'])
        bucket.update({
            'plannedWeightTotal': float_weight(bucket['plannedWeightTotal']),
            'expectedWeightTotal': expected,
            'achievedWeightTotal': float_weight(bucket['achievedWeightTotal']),
            'cappedAchievedWeightTotal': capped,
            'progressPercentage': round(min(capped / expected, 1) * 100, 1) if expected else 0,
        })
        out.append(bucket)
    return out


def scope_ksb_achievement(coverage_items, learner_consumption, learners, plan, learner_plans, *, clean_str, coverage_normalise_code, float_weight, ksb_achievement_by_type, ksb_sort_key, ksb_type_family):
    """Per-KSB achieved weight for one scope — the heatmap's achieved layer.

    ``plannedWeight`` is what this scope authored for the KSB, once.
    ``expectedWeightTotal`` is what its learners are between them assigned: the
    weight authored in each learner's own group, summed. Those differ whenever a
    scope spans more than one group, and using the first as a denominator for the
    second is how a cohort percentage ends up a fraction of the truth.

    ``cappedAchievedWeightTotal`` caps each learner at their own expectation,
    which is what a percentage may be taken of; ``achievedWeightTotal`` is the
    uncapped sum, reported so over-delivery stays visible rather than clipped.

    Codes are keyed by code alone. A code authored against two different KSB
    sources appears once, because ``ksb_learner_progress`` records a code and
    not the source it was authored from — the same collapse
    ``learner_consumption_payload`` already makes.
    """
    definitions = {}
    required_codes = set()
    for item in coverage_items or []:
        code = coverage_normalise_code(item.get('code'))
        if not code:
            continue
        required_codes.add(code)
        definitions.setdefault(code, {
            'title': clean_str(item.get('title')) or code,
            # The standard's wording for the KSB. The table shows it under the
            # code, so a row reads as the outcome rather than as "K1".
            'description': clean_str(item.get('description')),
            'ksbType': clean_str(item.get('ksb_type') or item.get('ksbType')),
            'sourceType': clean_str(item.get('source_type') or item.get('sourceType')),
            'sourceId': clean_str(item.get('source_id') or item.get('sourceId')),
            'sourceLabel': clean_str(item.get('source_label') or item.get('sourceLabel')),
        })
    planned = dict(plan.get('scopeKsbWeights', {}))

    expected_totals = defaultdict(float)
    learners_expected = defaultdict(set)
    for learner in learners or []:
        weights = (learner_plans.get(learner.get('id')) or {}).get('ksbWeights') or {}
        for code, value in weights.items():
            code = coverage_normalise_code(code)
            if not code or not value:
                continue
            expected_totals[code] += float(value)
            learners_expected[code].add(learner.get('id'))

    achieved = defaultdict(float)
    capped = defaultdict(float)
    declared = defaultdict(float)
    learners_with = defaultdict(set)
    learners_complete = defaultdict(set)
    for row in learner_consumption or []:
        learner_id = row.get('learnerId')
        for item in row.get('ksbs') or []:
            code = coverage_normalise_code(item.get('code'))
            if not code:
                continue
            consumed = float(item.get('consumedWeight') or 0)
            achieved[code] += consumed
            capped[code] += float(item.get('cappedConsumedWeight') or 0)
            declared[code] += float(item.get('declaredReflectionWeight') or 0)
            if consumed > 0:
                learners_with[code].add(learner_id)
            if item.get('status') == 'complete':
                learners_complete[code].add(learner_id)

    learner_count = len(learners or [])
    rows = []
    for code in sorted(required_codes | set(achieved), key=ksb_sort_key):
        planned_weight = float_weight(planned.get(code, 0))
        expected_total = float_weight(expected_totals.get(code, 0))
        capped_total = float_weight(capped.get(code, 0))
        # How many learners this KSB is actually authored for. A cohort where only
        # one group teaches a KSB must not read as the whole cohort failing it.
        expected_learners = len(learners_expected.get(code, ())) or (learner_count if planned_weight else 0)
        definition = definitions.get(code, {})
        if code not in required_codes:
            status = 'unplanned'
        elif not planned_weight:
            status = 'unmapped'
        elif expected_learners and len(learners_complete.get(code, ())) >= expected_learners:
            status = 'complete'
        elif learners_with.get(code):
            status = 'in_progress'
        else:
            status = 'not_started'
        rows.append({
            'code': code,
            'title': definition.get('title') or code,
            'description': definition.get('description') or '',
            'ksbType': definition.get('ksbType') or '',
            # 'K' | 'S' | 'B'. `ksbType` is a word whose spelling varies by
            # import, so anything grouping or filtering by family uses this.
            'ksbTypeCode': ksb_type_family(definition.get('ksbType'), code)[0].upper(),
            'sourceType': definition.get('sourceType') or '',
            'sourceId': definition.get('sourceId') or '',
            'sourceLabel': definition.get('sourceLabel') or '',
            'plannedWeight': planned_weight,
            'expectedWeightTotal': expected_total,
            'achievedWeightTotal': float_weight(achieved.get(code, 0)),
            'cappedAchievedWeightTotal': capped_total,
            'declaredReflectionWeightTotal': float_weight(declared.get(code, 0)),
            'learnerCount': expected_learners,
            'learnersAchievedCount': len(learners_with.get(code, ())),
            'learnersCompleteCount': len(learners_complete.get(code, ())),
            'achievementPercentage': (
                round(min(capped_total / expected_total, 1) * 100, 1) if expected_total else 0
            ),
            'status': status,
        })
    expected_total = float_weight(sum(row['expectedWeightTotal'] for row in rows))
    capped_total = float_weight(sum(row['cappedAchievedWeightTotal'] for row in rows))
    return {
        'learnerCount': learner_count,
        'requiredCount': len(required_codes),
        'ksbCount': len(rows),
        'mappedCount': len([row for row in rows if row['status'] != 'unplanned' and row['plannedWeight']]),
        'unmappedCount': len([row for row in rows if row['status'] == 'unmapped']),
        # Consumed by a learner but authored nowhere in this scope. A visible
        # figure rather than a row that silently reads as achievement.
        'unplannedCount': len([row for row in rows if row['status'] == 'unplanned']),
        'startedCount': len([row for row in rows if row['learnersAchievedCount']]),
        'notStartedCount': len([row for row in rows if not row['learnersAchievedCount']]),
        # This scope's own KSBs that no learner has earned any of yet — the
        # 'missing' count. Excludes 'unplanned', which is not one of its KSBs.
        'missingCount': len([
            row for row in rows
            if row['status'] != 'unplanned' and not row['learnersAchievedCount']
        ]),
        'completeCount': len([row for row in rows if row['status'] == 'complete']),
        'plannedWeightTotal': float_weight(sum(row['plannedWeight'] for row in rows)),
        'expectedWeightTotal': expected_total,
        'achievedWeightTotal': float_weight(sum(row['achievedWeightTotal'] for row in rows)),
        'cappedAchievedWeightTotal': capped_total,
        'declaredReflectionWeightTotal': float_weight(sum(row['declaredReflectionWeightTotal'] for row in rows)),
        'progressPercentage': (
            round(min(capped_total / expected_total, 1) * 100, 1) if expected_total else 0
        ),
        'learnersWithAchievement': len({
            row.get('learnerId') for row in learner_consumption or []
            if float(row.get('consumedWeightTotal') or 0) > 0
        }),
        'rows': rows,
        # Knowledge / Skills / Behaviours, each with its own achieved and missing
        # counts. The standard states them as three families and a coach reads
        # them that way; the row table alone cannot be read for it.
        'byType': ksb_achievement_by_type(rows),
        'sources': {
            'plannedWeight': 'curriculum.ksb_component_mappings.weight (whole scope)',
            'expectedWeight': 'curriculum.ksb_component_mappings.weight (of each learner\'s group)',
            'achievedWeight': 'Learner.ksb_learner_progress.weight',
            'declaredWeight': 'Learner.learning_reflection_submissions.ksb_weights',
        },
    }
