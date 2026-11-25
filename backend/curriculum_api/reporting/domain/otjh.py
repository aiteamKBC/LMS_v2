"""Pure authored OTJH plans and reflection-hour aggregation."""
from collections import defaultdict
import re


def otjh_number(value, *, float_weight):
    if value in (None, ''):
        return None
    parsed = float_weight(value)
    if parsed:
        return parsed
    match = re.search(r'\d+(?:\.\d+)?', str(value))
    return float_weight(match.group(0)) if match else None


def apply_reflection_otjh_to_learners(learners, reflection_rows, *, float_weight):
    """Attach reflection-declared OTJH to each learner without overwriting.

    ``reflectionActualOtjh`` is the learner's own declaration, summed per
    submission; ``reflectionExpectedOtjh`` is the Component/progress expected
    figure for the same activities. Both are reported as their own fields.

    They no longer replace ``completedHours`` / ``plannedHours``: those come from
    ``"Learner"."learners"`` and cover the learner's whole programme, so
    substituting a per-reflection subtotal would under-report any learner whose
    reflections do not cover every activity. The canonical value is only filled
    in when there is none.
    """
    by_learner = defaultdict(lambda: {'actual': 0.0, 'expected': 0.0, 'seen': set()})
    for row in reflection_rows or []:
        learner_id = row.get('learnerId')
        if learner_id in (None, ''):
            continue
        submission_key = row.get('submissionId') or (
            row.get('learnerId'),
            row.get('progressEntryId'),
            row.get('activityId'),
            row.get('submittedAt'),
            row.get('dateCompleted'),
        )
        bucket = by_learner[learner_id]
        if submission_key in bucket['seen']:
            continue
        bucket['seen'].add(submission_key)
        if row.get('actualOtjh') is not None:
            bucket['actual'] += float(row.get('actualOtjh') or 0)
        if row.get('expectedOtjh') is not None:
            bucket['expected'] += float(row.get('expectedOtjh') or 0)
    for learner in learners:
        bucket = by_learner.get(learner.get('id'))
        if not bucket:
            learner['reflectionActualOtjh'] = None
            learner['reflectionExpectedOtjh'] = None
            learner['reflectionCount'] = 0
            continue
        learner['reflectionActualOtjh'] = float_weight(bucket['actual'])
        learner['reflectionExpectedOtjh'] = float_weight(bucket['expected'])
        learner['reflectionCount'] = len(bucket['seen'])
        if not learner.get('completedHours'):
            learner['completedHours'] = float_weight(bucket['actual'])
        if not learner.get('plannedHours'):
            learner['plannedHours'] = float_weight(bucket['expected'])
    return learners


def scope_authored_plan(module_rows, component_rows, coverage_items, *, clean_str, coverage_normalise_code, float_weight, normalise, otjh_number):
    """What this scope authored, split by the group that delivers it.

    A module belongs to exactly one group (``curriculum.modules.group_id``), so a
    cohort running two groups holds two module instances and the sum of its
    components is *not* what any single learner is assigned. Summing the whole
    scope and calling it "planned per learner" over-states the denominator by the
    number of groups, which turns every percentage into a fraction of the truth.

    So the plan is keyed by group label, and a learner is measured against the
    group enrolment placed them in. ``scopeOtjh``/``scopeKsbWeights`` remain the
    whole scope's authored content, which is a different and still useful fact.
    """
    group_by_module = {}
    # The plan stays keyed by the normalised group label it has always used, so
    # nothing downstream changes shape. What is added is a second way in: the
    # group's canonical id mapped to that same key, so a learner carrying
    # ``group_id`` is matched to their group's bucket without the two labels
    # having to agree. See ``learner_plan_group_key``.
    group_key_by_id = {}
    for row in module_rows or []:
        module_id = clean_str(row.get('module_catalogue_id'))
        if not module_id:
            continue
        key = normalise(row.get('group_name') or row.get('group_id'))
        group_by_module[module_id] = key
        group_id = clean_str(row.get('group_id'))
        if group_id and key:
            group_key_by_id[group_id] = key

    otjh_by_group = defaultdict(float)
    scope_otjh = 0.0
    for row in component_rows or []:
        value = otjh_number(row.get('expected_otjh'))
        if value is None:
            continue
        key = group_by_module.get(clean_str(row.get('module_catalogue_id')), '')
        otjh_by_group[key] += float(value)
        scope_otjh += float(value)

    # KSB weight is taken from the coverage payload's own mappings rather than
    # re-summed from the mapping rows, so the per-group split always adds back up
    # to the `raw_total_weight` the heatmap shows.
    ksb_by_group = defaultdict(lambda: defaultdict(float))
    scope_ksb = defaultdict(float)
    for item in coverage_items or []:
        code = coverage_normalise_code(item.get('code'))
        if not code:
            continue
        scope_ksb.setdefault(code, 0.0)
        for mapping in item.get('mappings') or []:
            value = float(mapping.get('weight') or 0)
            key = normalise(
                mapping.get('group_name')
                or mapping.get('groupName')
                or group_by_module.get(clean_str(mapping.get('module_id') or mapping.get('moduleId')), '')
            )
            ksb_by_group[key][code] += value
            scope_ksb[code] += value

    return {
        'componentCount': len(component_rows or []),
        'groupKeys': set(otjh_by_group) | set(ksb_by_group),
        'otjhByGroup': dict(otjh_by_group),
        'ksbByGroup': {key: dict(value) for key, value in ksb_by_group.items()},
        'groupKeyById': group_key_by_id,
        'scopeOtjh': float_weight(scope_otjh),
        'scopeKsbWeights': dict(scope_ksb),
    }


def learner_plan_group_key(plan, learner, *, clean_str, normalise):
    """Which of the plan's group buckets this learner's placement falls in.

    ``group_id`` first: it survives a rename, and it is the only thing that
    tells two identically named groups apart. The normalised group name is the
    fallback, for learners whose id never resolved and for environments where
    the column has not been added yet.
    """
    group_id = clean_str(learner.get('groupId'))
    if group_id:
        key = plan.get('groupKeyById', {}).get(group_id)
        if key:
            return key
    return normalise(learner.get('group'))


def learner_authored_plan(plan, learner, unmatched='scope', *, float_weight, learner_plan_group_key):
    """The slice of the authored plan one learner is actually assigned.

    ``basis`` says which it is. ``group`` when the learner's placement matches a
    group that delivers modules in this scope. Otherwise ``unmatched`` decides:
    ``scope`` hands them the whole scope, ``none`` hands them nothing. Which is
    right is not a per-learner question — see ``learner_plans_for_scope``.
    """
    # Direct module membership is independent of the learner's group. This
    # marker is only supplied by module/week/component rosters, so the scope
    # here is exactly the content they were assigned.
    if learner.get('assignmentBasis') == 'module':
        return {
            'otjh': plan.get('scopeOtjh', 0),
            'ksbWeights': dict(plan.get('scopeKsbWeights', {})),
            'basis': 'module',
        }
    key = learner_plan_group_key(plan, learner)
    if key and key in plan.get('groupKeys', set()):
        return {
            'otjh': float_weight(plan['otjhByGroup'].get(key, 0)),
            'ksbWeights': dict(plan['ksbByGroup'].get(key, {})),
            'basis': 'group',
        }
    if unmatched == 'none':
        return {'otjh': 0, 'ksbWeights': {}, 'basis': 'none'}
    return {
        'otjh': plan.get('scopeOtjh', 0),
        'ksbWeights': dict(plan.get('scopeKsbWeights', {})),
        'basis': 'scope',
    }


def learner_plans_for_scope(plan, learners, *, learner_authored_plan, learner_plan_group_key):
    """Every learner's slice of the authored plan, deciding the fallback once.

    Two different situations look the same one learner at a time, so the choice
    is made across the whole roster:

    * some placements match a group that delivers here — then a learner whose
      group does not match genuinely has nothing planned in this scope, and gets
      nothing (``basis: none``). Handing them the scope total would invent an
      expectation and drag every percentage down.
    * no placement matches any of them (or the scope records no group labels at
      all) — that is a label mismatch between ``curriculum.modules.group_name``
      and ``"Learner"."learners".group_name``, not an empty curriculum. Reporting
      zero for everyone would state the wrong thing, so the whole scope stands in
      and every row says ``basis: scope`` so the substitution is visible.
    """
    group_keys = {key for key in plan.get('groupKeys', set()) if key}
    placements = {learner_plan_group_key(plan, learner) for learner in learners or []}
    unmatched = 'none' if (group_keys and (group_keys & placements)) else 'scope'
    return {
        learner.get('id'): learner_authored_plan(plan, learner, unmatched)
        for learner in learners or []
    }


def scope_otjh_summary(plan, learner_plans, learners, activities, *, float_weight, learner_authored_plan, otjh_number):
    """Achieved vs planned OTJH for one scope, and the per-learner rows behind it.

    ``achievedTotal`` is the credited figure and the one to show: a learner's own
    declared hours where the reflection exists, and the component's expected
    hours where the activity completed without one. Reporting only declared hours
    would under-count every quiz and assignment that carries no reflection;
    reporting only expected hours would ignore what the learner actually wrote.
    Both underlying totals are returned so either can be read on its own.

    ``authoredTotal`` is everything this scope contains; ``plannedTotal`` is the
    sum of what its learners are each assigned. They differ whenever a scope
    spans more than one group — see ``scope_authored_plan``.
    """
    buckets = {}
    for entry in activities or []:
        if not entry.get('countsTowardAchievement'):
            continue
        if entry.get('scopeStatus') not in (None, '', 'in_scope'):
            continue
        learner_id = entry.get('learnerId')
        bucket = buckets.setdefault(learner_id, {
            'declared': 0.0, 'credited': 0.0, 'activities': 0, 'reflections': 0,
        })
        bucket['activities'] += 1
        expected = otjh_number(entry.get('expectedOtjh'))
        actual = otjh_number(entry.get('actualOtjh'))
        if actual is not None:
            bucket['declared'] += float(actual)
            bucket['reflections'] += 1
            bucket['credited'] += float(actual)
        elif expected is not None:
            bucket['credited'] += float(expected)
    learner_rows = []
    for learner in learners or []:
        learner_id = learner.get('id')
        learner_plan = learner_plans.get(learner_id) or learner_authored_plan(plan, learner)
        # 'none' means no module in this scope is delivered to this learner's
        # group, which is a real answer and not a missing figure.
        planned = float(learner_plan.get('otjh') or 0)
        bucket = buckets.get(learner_id) or {
            'declared': 0.0, 'credited': 0.0, 'activities': 0, 'reflections': 0,
        }
        learner_rows.append({
            'learnerId': learner_id,
            'learnerName': learner.get('name') or '',
            'email': learner.get('email') or '',
            'cohort': learner.get('cohort') or '',
            'group': learner.get('group') or '',
            'plannedOtjh': float_weight(planned),
            'plannedBasis': learner_plan.get('basis') or 'scope',
            'achievedOtjh': float_weight(bucket['credited']),
            'declaredOtjh': float_weight(bucket['declared']),
            'completedActivityCount': bucket['activities'],
            'reflectionCount': bucket['reflections'],
            'progressPercentage': (
                round(min(bucket['credited'] / planned, 1) * 100, 1) if planned else 0
            ),
            # The learner's whole-programme figures from "Learner"."learners",
            # kept alongside so a scope total is never mistaken for them.
            'programmeCompletedHours': learner.get('completedHours'),
            'programmeTargetHours': learner.get('targetHours'),
        })
    achieved_total = float_weight(sum(row['achievedOtjh'] for row in learner_rows))
    declared_total = float_weight(sum(row['declaredOtjh'] for row in learner_rows))
    planned_total = float_weight(sum(row['plannedOtjh'] for row in learner_rows))
    return {
        'componentCount': plan.get('componentCount', 0),
        'learnerCount': len(learner_rows),
        # Everything this scope authored, once. Not a per-learner figure when the
        # scope spans several groups.
        'authoredTotal': plan.get('scopeOtjh', 0),
        'plannedPerLearner': (
            float_weight(planned_total / len(learner_rows)) if learner_rows else plan.get('scopeOtjh', 0)
        ),
        'plannedTotal': planned_total,
        'achievedTotal': achieved_total,
        'declaredTotal': declared_total,
        'creditedFromExpectedTotal': float_weight(achieved_total - declared_total),
        'achievedPerLearnerAverage': (
            float_weight(achieved_total / len(learner_rows)) if learner_rows else 0
        ),
        'progressPercentage': (
            round(min(achieved_total / planned_total, 1) * 100, 1) if planned_total else 0
        ),
        'completedActivityCount': sum(row['completedActivityCount'] for row in learner_rows),
        'reflectionCount': sum(row['reflectionCount'] for row in learner_rows),
        'learners': learner_rows,
        'sources': {
            'plannedOtjh': 'curriculum.components.expected_otjh (of the learner\'s group)',
            'authoredOtjh': 'curriculum.components.expected_otjh (whole scope)',
            'declaredOtjh': 'Learner.learning_reflection_submissions.actual_time_hours',
            'creditedFromExpected': 'learner_progress_entries.expected_otjh|curriculum.components.expected_otjh',
            'completionGate': 'learner_api.progress_rules',
        },
    }
