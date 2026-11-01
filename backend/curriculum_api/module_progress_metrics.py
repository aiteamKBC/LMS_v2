"""Read-only module metrics from current activity identities and saved evidence.

Only the moduleProgress projection calls this module. It never syncs records,
creates KSB evidence, or changes programme/cohort reporting policy.
"""
from collections import defaultdict

from learner_api.canonical_learning import counts_as_completed
from learner_api.current_learning import is_unsynchronised_direct_save, project_current
from learner_api.ksb_exclusions import and_not_excluded
from learner_api.progress_rules import progress_counts_as_achieved


def component_id(row):
    return str(row.get('curriculum_component_ref') or '').strip() or str(row.get('component_ref') or '').strip()


def completion_records(records, owners, read, table):
    """Use the same native pass/mark rules as learner reads, keeping stored time.

    project_current may derive duration for learner views. This projection copies
    only completion/acceptance from it; hours still require saved or verified
    seconds, so planned/claimed time cannot become achieved hours.
    """
    native_assignments = [row for row in records if is_unsynchronised_direct_save(row)
                          and row.get('component_type') == 'assignment']
    identities = {(str(owner['enrolment_id']), str(owner.get('learner_type') or ''))
                  for row in native_assignments
                  if (owner := owners.get(str(row['learner_id']), {})).get('enrolment_id') is not None}
    markings = {}
    if identities:
        pairs = sorted(identities)
        slots = ','.join(['(%s,%s)'] * len(pairs))
        components = sorted({str(row.get('component_ref') or '') for row in native_assignments})
        component_slots = ','.join(['%s'] * len(components))
        rows = read(f'''SELECT learner_id,learner_kind,component_ref,status,actual_time_hours
            FROM {table('learning_reflection_submissions')}
            WHERE (learner_id,learner_kind) IN ({slots}) AND activity_type='assignment'
              AND component_ref IN ({component_slots})
            ORDER BY submitted_at NULLS FIRST,id''', [*[part for pair in pairs for part in pair], *components])
        for row in rows:
            markings[(str(row['learner_id']), str(row.get('learner_kind') or ''), str(row.get('component_ref') or ''))] = row
    result = []
    for row in records:
        if row.get('deleted_at') or row.get('kind') == 'activity_event':
            continue
        if not is_unsynchronised_direct_save(row):
            result.append(row)
            continue
        owner = owners.get(str(row['learner_id']), {})
        identity = (str(owner.get('enrolment_id')), str(owner.get('learner_type') or ''))
        # The native reader keys marks by the original component reference.
        mark = markings.get((*identity, str(row.get('component_ref') or '')))
        projected = project_current([row], {str(row.get('component_ref')): mark} if mark else {})
        if projected:
            result.append({**row, **{key: projected[0].get(key) for key in ('accepted', 'completed', 'activity_status')}})
    return result


def apply_ksb_metrics(payload, records, read, table, connection):
    """Current component weights count once; historical weights remain separate."""
    from . import views

    learners = payload.get('assignedLearners') or []
    if not learners:
        return
    plan = payload.get('learnerActivityPlan') or []
    current_components = defaultdict(set)
    for row in plan:
        current_components[str(row['learnerId'])].add(str(row['componentId']))
    all_components = set().union(*current_components.values()) if current_components else set()
    coverage = (payload.get('coverage') or {}).get('items') or []
    expected = defaultdict(lambda: defaultdict(float))
    unallocated = defaultdict(float)
    scope_weights = defaultdict(float)
    for item in coverage:
        code = views.coverage_normalise_code(item.get('code'))
        if not code:
            continue
        for mapping in item.get('mappings') or []:
            ident = str(mapping.get('component_id') or mapping.get('componentId') or '')
            value = float(mapping.get('weight') or 0)
            if not ident or ident not in all_components:
                for learner in learners:
                    unallocated[str(learner['id'])] += value
                continue
            if ident in all_components:
                scope_weights[code] += value
            for learner in learners:
                key = str(learner['id'])
                if ident in current_components[key]:
                    expected[learner['id']][code] += value

    eligible = [row for row in records if row.get('accepted') is True and counts_as_completed(row)
                and progress_counts_as_achieved(row.get('kind'), row.get('passed'))
                and row.get('kind') != 'staff_hours']
    snapshots = defaultdict(dict)
    if eligible:
        ids = list(dict.fromkeys(row['id'] for row in eligible))
        slots = ','.join(['%s'] * len(ids))
        selection, params = ('k.progress_id = ANY(%s)', [ids]) if connection.vendor == 'postgresql' else (f'k.progress_id IN ({slots})', ids)
        rows = read(f'''SELECT k.progress_id,k.ksb_code,k.weight FROM {table('learner_progress_ksbs')} k
            WHERE {selection}{and_not_excluded('k', connection)}''', params)
        for row in rows:
            code = views.coverage_normalise_code(row.get('ksb_code'))
            value = float(row.get('weight') or 0)
            if code:
                snapshots[row['progress_id']][code] = max(snapshots[row['progress_id']].get(code, 0), value)

    current, historical = defaultdict(lambda: defaultdict(float)), defaultdict(lambda: defaultdict(float))
    seen, canonical_seen = set(), set()
    # Current identities take priority over retained copies of the same work.
    eligible.sort(key=lambda row: (component_id(row) in current_components[str(row['learner_id'])],
                                  str(row.get('submitted_at') or ''), row['id']), reverse=True)
    for row in eligible:
        learner = str(row['learner_id'])
        ident = component_id(row)
        is_current = ident in current_components[learner]
        if not is_current and str(row.get('module_ref') or '') != str(payload['identifier']):
            continue
        for code, value in snapshots[row['id']].items():
            key = (learner, ident or f"entry:{row['id']}", code)
            canonical = (learner, row.get('canonical_activity_key'), code)
            if key in seen or row.get('canonical_activity_key') and canonical in canonical_seen:
                continue
            seen.add(key)
            if row.get('canonical_activity_key'):
                canonical_seen.add(canonical)
            (current if is_current else historical)[learner][code] += value

    progress_totals = {learner['id']: dict(current[str(learner['id'])]) for learner in learners}
    consumed = views.learner_consumption_payload(
        learners, coverage, progress_totals, {},
        expected_by_learner={learner['id']: dict(expected[learner['id']]) for learner in learners},
    )
    for row in consumed:
        key = str(row['learnerId'])
        # Unmapped evidence is visible but cannot earn a target that was never
        # assigned to this learner's current activities.
        for item in row['ksbs']:
            item['cappedConsumedWeight'] = min(item['consumedWeight'], item['expectedWeight'])
        row['cappedConsumedWeightTotal'] = sum(item['cappedConsumedWeight'] for item in row['ksbs'])
        row['progressPercentage'] = (round(row['cappedConsumedWeightTotal'] / row['expectedWeightTotal'] * 100, 1)
                                     if row['expectedWeightTotal'] else 0)
        row['historicalConsumedWeightTotal'] = sum(historical[key].values())
        row['unallocatedPlannedWeight'] = unallocated[key]
    payload['learnerKsbConsumption'] = consumed
    payload['ksbAchievement'] = views.scope_ksb_achievement(
        coverage, consumed, learners, {'scopeKsbWeights': dict(scope_weights)},
        {learner['id']: {'ksbWeights': dict(expected[learner['id']])} for learner in learners},
    )
    payload['ksbAchievement']['historicalAchievedWeightTotal'] = sum(row['historicalConsumedWeightTotal'] for row in consumed)
    payload['ksbAchievement']['unallocatedPlannedWeightTotal'] = sum(row['unallocatedPlannedWeight'] for row in consumed)
    payload['moduleProgressBasis'] = 'current_activities'
    if payload.get('ksbAchievementPolicy'):
        payload['ksbAchievementPolicy'].update(
            expectedWeightBasis='current_activities', plannedOtjhBasis='current_activities',
            expectedOtjhSource='curriculum.components.expected_otjh',
            actualOtjhSource='accepted learner_progress_entries.actual_seconds|verified_seconds',
            scopeAttribution='curriculum_component_ref|component_ref (current), module_ref (history)',
        )
