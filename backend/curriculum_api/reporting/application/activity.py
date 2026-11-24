"""Build activity and learner consumption projections from supplied read facts."""
from collections import defaultdict


def learner_activity_trace(progress_rows, excluded_progress_rows, reflection_rows, excluded_reflection_rows, evidence_by_progress, *, coverage_normalise_code, float_weight, ksb_sort_key):
    """One entry per Progress activity, carrying everything that describes it.

    Component, Progress, expected OTJH, Reflection, actual OTJH, Evidence, the
    canonical KSB snapshot and the progress status — all keyed on
    ``learner_progress_entries.id``, the one identifier Learner, Coach and
    Curriculum already share. That makes cross-layer checks a lookup rather than
    a match on titles, emails or enrolment source ids.

    Achieved KSB weight stays in ``ksbSnapshot`` (from ``learner_progress_ksbs``)
    and reflection declarations stay in ``declaredReflectionKsbs``. They are
    deliberately separate lists: the same activity's KSBs must not be summed
    twice.
    """
    activities = {}

    def bucket(progress_id, learner_id):
        key = str(progress_id)
        entry = activities.get(key)
        if entry is None:
            entry = {
                'progressId': progress_id,
                'learnerId': learner_id,
                'kind': '',
                'componentId': '',
                'componentTitle': '',
                'componentType': '',
                'module': '',
                # Whether that module is still in the catalogue: 'live',
                # 'deleted', or 'unknown' when the component no longer resolves
                # to one. Empty for an activity with no progress row behind it.
                'moduleStatus': '',
                'moduleCatalogueId': '',
                'week': '',
                'submittedAt': '',
                'progressStatus': '',
                'passed': None,
                'countsTowardAchievement': None,
                'expectedOtjh': None,
                'expectedOtjhSource': 'not_returned',
                'actualOtjh': None,
                'actualOtjhSource': 'not_returned',
                'ksbSnapshot': [],
                'achievedKsbWeightTotal': 0,
                'declaredReflectionKsbs': [],
                'declaredReflectionKsbWeightTotal': 0,
                'reflection': None,
                'evidence': [],
                'evidenceCount': 0,
                # Whether this activity belongs to the scope being reported on.
                # See learner_progress_ksb_consumption(); an out-of-scope
                # activity is real achievement that another scope owns.
                'scopeStatus': 'in_scope',
                # How it was placed there: 'component' (it is in this scope's
                # live content) or 'lineage' (the component is gone, but the
                # progress row was stamped with this scope when it completed).
                'scopeBasis': '',
                # Why an in-scope activity still does not count, when it does
                # not: currently only 'repeat_completion'.
                'exclusionReason': '',
            }
            activities[key] = entry
        if entry.get('learnerId') in (None, '') and learner_id not in (None, ''):
            entry['learnerId'] = learner_id
        return entry

    def fill(entry, key, value):
        if not entry.get(key) and value:
            entry[key] = value

    for row in list(progress_rows or []) + list(excluded_progress_rows or []):
        progress_id = row.get('progressId')
        if progress_id in (None, ''):
            continue
        entry = bucket(progress_id, row.get('learnerId'))
        fill(entry, 'kind', row.get('kind'))
        fill(entry, 'componentId', row.get('componentId'))
        fill(entry, 'componentTitle', row.get('componentTitle'))
        fill(entry, 'componentType', row.get('componentType'))
        fill(entry, 'module', row.get('module'))
        fill(entry, 'moduleStatus', row.get('moduleStatus'))
        fill(entry, 'moduleCatalogueId', row.get('moduleCatalogueId'))
        fill(entry, 'week', row.get('week'))
        fill(entry, 'submittedAt', row.get('submittedAt'))
        entry['progressStatus'] = row.get('achievementStatus') or entry['progressStatus']
        entry['passed'] = row.get('passed')
        # One activity, several KSB rows. Whether it counts is a fact about the
        # activity, not about each code — but a single code can arrive already
        # marked False (its weight was credited on an earlier completion of the
        # same component). Any counted row settles it, so that row cannot drag
        # the whole activity, and its hours, out of the totals.
        if row.get('countsTowardAchievement'):
            entry['countsTowardAchievement'] = True
        elif entry['countsTowardAchievement'] is None:
            entry['countsTowardAchievement'] = row.get('countsTowardAchievement')
        if row.get('scopeStatus'):
            entry['scopeStatus'] = row.get('scopeStatus')
        fill(entry, 'scopeBasis', row.get('scopeBasis'))
        fill(entry, 'exclusionReason', row.get('exclusionReason'))
        if entry['expectedOtjh'] is None and row.get('plannedOtjh') is not None:
            entry['expectedOtjh'] = row.get('plannedOtjh')
            entry['expectedOtjhSource'] = row.get('plannedOtjhSource') or 'not_returned'
        code = coverage_normalise_code(row.get('code'))
        if code and code not in {item['code'] for item in entry['ksbSnapshot']}:
            entry['ksbSnapshot'].append({
                'code': code,
                'weight': float_weight(row.get('weight') or 0),
                'weightClass': row.get('weightClass') or 'soft',
                'countsTowardAchievement': bool(row.get('countsTowardAchievement')),
            })

    for row in list(reflection_rows or []) + list(excluded_reflection_rows or []):
        progress_id = row.get('progressEntryId')
        if progress_id in (None, ''):
            continue
        entry = bucket(progress_id, row.get('learnerId'))
        fill(entry, 'kind', row.get('progressKind'))
        fill(entry, 'componentId', row.get('componentId'))
        fill(entry, 'componentTitle', row.get('componentTitle'))
        fill(entry, 'componentType', row.get('componentType'))
        fill(entry, 'module', row.get('module'))
        fill(entry, 'week', row.get('week'))
        if entry['expectedOtjh'] is None and row.get('expectedOtjh') is not None:
            entry['expectedOtjh'] = row.get('expectedOtjh')
            entry['expectedOtjhSource'] = row.get('expectedOtjhSource') or 'not_returned'
        if entry['progressStatus'] in ('', None) and row.get('achievementStatus'):
            entry['progressStatus'] = row.get('achievementStatus')
        if entry['countsTowardAchievement'] is None:
            entry['countsTowardAchievement'] = row.get('activityCountsTowardAchievement')
        if entry['reflection'] is None:
            entry['actualOtjh'] = row.get('actualOtjh')
            entry['actualOtjhSource'] = row.get('actualOtjhSource') or 'not_returned'
            entry['reflection'] = {
                'submissionId': row.get('submissionId'),
                'status': row.get('status') or '',
                'submittedAt': row.get('submittedAt') or '',
                'dateCompleted': row.get('dateCompleted') or '',
                'text': row.get('reflection') or '',
                'qualityScore': row.get('qualityScore'),
                'actualOtjh': row.get('actualOtjh'),
                'actualOtjhSource': row.get('actualOtjhSource') or 'not_returned',
                'declaredPlannedOtjh': row.get('declaredPlannedOtjh'),
                'progressLinkStatus': row.get('progressLinkStatus') or '',
                'learnerResolution': row.get('learnerResolution') or '',
                'submissionLearnerId': row.get('submissionLearnerId') or '',
                'ksbRole': row.get('ksbRole') or 'supplementary_evidence',
                'countsTowardAchievement': False,
            }
            for item in row.get('declaredKsbs') or []:
                code = coverage_normalise_code(item.get('code'))
                if code and code not in {declared['code'] for declared in entry['declaredReflectionKsbs']}:
                    entry['declaredReflectionKsbs'].append({
                        'code': code,
                        'weight': float_weight(item.get('weight') or 0),
                        'countsTowardAchievement': False,
                    })

    for key, entry in activities.items():
        entry['ksbSnapshot'].sort(key=lambda item: ksb_sort_key(item['code']))
        entry['declaredReflectionKsbs'].sort(key=lambda item: ksb_sort_key(item['code']))
        entry['achievedKsbWeightTotal'] = float_weight(sum(
            float(item['weight'] or 0)
            for item in entry['ksbSnapshot']
            if item['countsTowardAchievement']
        ))
        entry['declaredReflectionKsbWeightTotal'] = float_weight(sum(
            float(item['weight'] or 0) for item in entry['declaredReflectionKsbs']
        ))
        entry['evidence'] = evidence_by_progress.get(key, [])
        entry['evidenceCount'] = len(entry['evidence'])
    return sorted(
        activities.values(),
        key=lambda entry: (str(entry.get('learnerId') or ''), -int(entry.get('progressId') or 0)),
    )


def learner_activity_plan(learners, component_rows, module_rows, week_rows, activities, plan, learner_plans=None, *, clean_str, frontend_component_type, learner_authored_plan, learner_plan_group_key, learner_plans_for_scope, normalise, otjh_number, parse_int):
    """Project authored components onto every learner assigned to the scope.

    The historical activity trace contains rows only after a learner has made
    progress. This separate, in-memory projection keeps assigned components
    visible as ``not_started`` without manufacturing progress records or doing
    one query per learner/component.
    """
    learners = list(learners or [])
    component_rows = list(component_rows or [])
    module_rows = list(module_rows or [])
    week_rows = list(week_rows or [])
    learner_plans = learner_plans or learner_plans_for_scope(plan or {}, learners)
    modules_by_id = {
        clean_str(row.get('module_catalogue_id')): row
        for row in module_rows if clean_str(row.get('module_catalogue_id'))
    }
    weeks_by_id = {
        clean_str(row.get('id')): row
        for row in week_rows if clean_str(row.get('id'))
    }
    by_learner_component = defaultdict(list)
    for activity in activities or []:
        learner_id = activity.get('learnerId')
        component_id = clean_str(activity.get('componentId'))
        if learner_id in (None, '') or not component_id:
            continue
        if activity.get('scopeStatus') not in (None, '', 'in_scope', 'unfiltered', 'lineage'):
            continue
        by_learner_component[(str(learner_id), component_id)].append(activity)

    def component_group_key(module):
        group_id = clean_str(module.get('group_id'))
        if group_id:
            key = (plan or {}).get('groupKeyById', {}).get(group_id)
            if key:
                return key
        return normalise(module.get('group_name') or group_id)

    def include_component(learner, learner_plan, module):
        basis = clean_str((learner_plan or {}).get('basis'))
        if basis in {'module', 'scope'}:
            return True
        if basis == 'none':
            return False
        return component_group_key(module) == learner_plan_group_key(plan or {}, learner)

    rows = []
    for learner in learners:
        learner_id = learner.get('id')
        learner_plan = learner_plans.get(learner_id) or learner_authored_plan(plan or {}, learner)
        for component in component_rows:
            component_id = clean_str(component.get('id'))
            module_id = clean_str(component.get('module_catalogue_id'))
            module = modules_by_id.get(module_id, {})
            if not component_id or not include_component(learner, learner_plan, module):
                continue
            linked = list(by_learner_component.get((str(learner_id), component_id), ()))
            linked.sort(key=lambda item: (
                clean_str(item.get('submittedAt')),
                int(item.get('progressId') or 0) if str(item.get('progressId') or '').isdigit() else 0,
            ), reverse=True)
            latest = linked[0] if linked else {}
            statuses = {clean_str(item.get('progressStatus')).lower() for item in linked}
            calculated_status = (
                'completed' if 'achieved' in statuses else
                'in_progress' if statuses else 'not_started'
            )
            try:
                points = int(component.get('points')) if component.get('points') not in (None, '') else 0
            except (TypeError, ValueError):
                points = 0
            week_id = clean_str(component.get('week_id'))
            week = weeks_by_id.get(week_id, {})
            rows.append({
                'activityPlanId': f'{learner_id}:{component_id}',
                'learnerId': learner_id,
                'learnerName': learner.get('name') or '',
                'email': learner.get('email') or '',
                'cohort': learner.get('cohort') or '',
                'group': learner.get('group') or '',
                'componentId': component_id,
                'componentTitle': component.get('title') or '',
                'componentType': frontend_component_type(component.get('type')),
                'moduleCatalogueId': module_id,
                'module': module.get('title') or '',
                'weekId': week_id,
                'week': week.get('title') or '',
                'displayOrder': parse_int(component.get('display_order'), 0),
                'expectedOtjh': otjh_number(component.get('expected_otjh')),
                'points': points,
                'calculatedStatus': calculated_status,
                'displayStatus': calculated_status,
                'statusSource': 'calculated',
                'progressId': latest.get('progressId'),
                'progressIds': [item.get('progressId') for item in linked if item.get('progressId') not in (None, '')],
                'progressStatus': latest.get('progressStatus') or '',
                'submittedAt': latest.get('submittedAt') or '',
                'countsTowardAchievement': any(item.get('countsTowardAchievement') for item in linked) if linked else None,
                'source': 'curriculum_component',
            })
    return rows


def learner_consumption_payload(learners, coverage_items, progress_totals, reflection_declared_totals, expected_by_learner=None, *, coverage_normalise_code, float_weight, ksb_sort_key, merge_ksb_totals):
    """Per-learner KSB consumption, with achieved and declared weight kept apart.

    ``consumedWeight`` is the canonical achieved weight and comes from the
    Component Progress snapshot alone. ``declaredReflectionWeight`` is what the
    learner's reflection claimed for the same activity — reported alongside as
    supplementary evidence, never added in. Summing both would double-count one
    activity's KSBs, which is the whole reason they are two fields.

    ``expected_by_learner`` maps a learner id to the weight that learner is
    actually assigned, which is not the same as the scope total whenever the scope
    spans more than one group: a module belongs to one group, so a cohort holds
    one module instance per group and summing them all over-states every
    learner's denominator. Omit it and the scope total stands in for everyone,
    which is only correct for a single-group scope.
    """
    expected = {
        coverage_normalise_code(item.get('code')): float(item.get('raw_total_weight') or item.get('rawTotalWeight') or 0)
        for item in coverage_items
        if coverage_normalise_code(item.get('code'))
    }
    expected_by_learner = expected_by_learner or {}
    achieved = merge_ksb_totals(progress_totals)
    declared = merge_ksb_totals(reflection_declared_totals)
    output = []
    for learner in learners:
        learner_id = learner.get('id')
        weights = achieved.get(learner_id, {})
        declared_weights = declared.get(learner_id, {})
        consumed_total = sum(float(value or 0) for value in weights.values())
        learner_expected = expected_by_learner.get(learner_id)
        learner_expected = expected if learner_expected is None else {
            coverage_normalise_code(code): float(value or 0)
            for code, value in learner_expected.items()
            if coverage_normalise_code(code)
        }
        expected_total = sum(learner_expected.values())
        ksb_rows = []
        for code in sorted(set(learner_expected) | set(weights), key=ksb_sort_key):
            expected_weight = learner_expected.get(code, 0)
            consumed_weight = float(weights.get(code, 0) or 0)
            pct = round((consumed_weight / expected_weight) * 100, 1) if expected_weight else (100 if consumed_weight else 0)
            ksb_rows.append({
                'code': code,
                'expectedWeight': float_weight(expected_weight),
                'consumedWeight': float_weight(consumed_weight),
                'cappedConsumedWeight': float_weight(min(consumed_weight, expected_weight) if expected_weight else consumed_weight),
                'declaredReflectionWeight': float_weight(float(declared_weights.get(code, 0) or 0)),
                'progressPercentage': min(pct, 100),
                'rawProgressPercentage': pct,
                'status': 'complete' if expected_weight and consumed_weight >= expected_weight else ('in_progress' if consumed_weight else 'not_started'),
            })
        output.append({
            'learnerId': learner_id,
            'learnerName': learner.get('name') or '',
            'email': learner.get('email') or '',
            'cohort': learner.get('cohort') or '',
            'group': learner.get('group') or '',
            'consumedWeightTotal': float_weight(consumed_total),
            'consumedWeightSource': 'learner_progress_ksbs',
            'declaredReflectionWeightTotal': float_weight(sum(float(value or 0) for value in declared_weights.values())),
            'expectedWeightTotal': float_weight(expected_total),
            'cappedConsumedWeightTotal': float_weight(sum(row['cappedConsumedWeight'] for row in ksb_rows)),
            'progressPercentage': round((sum(row['cappedConsumedWeight'] for row in ksb_rows) / expected_total) * 100, 1) if expected_total else 0,
            'ksbs': ksb_rows,
        })
    return output
