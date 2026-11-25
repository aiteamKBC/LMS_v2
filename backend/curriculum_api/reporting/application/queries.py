"""Coordinate scope impact, roster and achievement reads over plain query values."""
from collections import Counter


def _scope_learner_ksb_impact_payload(
    query,
    scope,
    identifier,
    *,
    PROGRESS_LINEAGE_COLUMN_BY_SCOPE,
    annotate_coverage_sources,
    apply_reflection_otjh_to_learners,
    assigned_learners_for_scope,
    authoring_scope_data,
    build_coverage,
    clean_str,
    is_postgresql,
    learner_activity_plan,
    learner_activity_trace,
    learner_consumption_payload,
    learner_plans_for_scope,
    learner_progress_ksb_consumption,
    logger,
    mappings_with_inferred_sources,
    out_of_scope_progress_count,
    progress_evidence_index,
    progress_scope_predicate,
    reflection_submission_ksb_consumption,
    scope_authored_plan,
    scope_ksb_achievement,
    scope_otjh_summary,
    scope_placement_lineage,
    read_required_ksbs,
):
    scope = clean_str(scope) or 'programme'
    identifier = clean_str(identifier)
    lineage = scope_placement_lineage(scope, identifier)
    module_rows, week_rows, component_rows, mapping_rows = authoring_scope_data(scope, identifier)
    if not lineage.get('found') and not module_rows:
        return None, (f'{scope.title()} not found.', 404)
    mapping_rows = mappings_with_inferred_sources(mapping_rows, module_rows)
    required_ksbs = read_required_ksbs(module_rows, scope, identifier)
    coverage = annotate_coverage_sources(build_coverage(
        required_ksbs,
        mapping_rows,
        module_rows,
        week_rows,
        component_rows,
        include_mapping_only=not bool(required_ksbs),
    ))
    learner_status = clean_str(query.get('learnerStatus') or query.get('status'))
    learners = assigned_learners_for_scope(
        scope,
        identifier,
        '' if learner_status.lower() in {'', 'all'} else learner_status,
        lineage=lineage,
    )
    learner_ids = [
        int(row.get('sourceId') if row.get('sourceKind') == 'learner' else row.get('id'))
        for row in learners
        if str(row.get('sourceId') if row.get('sourceKind') == 'learner' else row.get('id')).isdigit()
    ]
    scope_codes = [item.get('code') for item in coverage.get('items', [])]
    component_ids = [clean_str(row.get('id')) for row in component_rows if clean_str(row.get('id'))]
    # What this scope authored, split by the group that delivers it, so every
    # denominator below is the weight and hours a single learner is assigned
    # rather than the scope's whole content.
    plan = scope_authored_plan(module_rows, component_rows, coverage.get('items', []))
    # Only the programme — the widest scope — may count an activity that carries
    # no component reference. Anywhere narrower that would be a guess about which
    # cohort or group the activity belonged to.
    include_unattributed = scope == 'programme'
    # The module progress screens (?moduleProgress=1) show only this scope's
    # activity, so other scopes' activity -- ~10k rows of a learner's programme
    # history for one module -- stays in the database and is only counted.
    # The Achievement panels list it under Activity, so they still read it.
    in_scope_only = query.get('moduleProgress') == '1' and not include_unattributed
    progress_totals, progress_rows, excluded_progress_rows = learner_progress_ksb_consumption(
        learner_ids, scope_codes, component_ids, include_unattributed,
        restrict_to_components=not include_unattributed,
        scope=scope,
        scope_identifier=identifier,
        in_scope_only=in_scope_only,
    )
    out_of_scope_count = None
    if in_scope_only and learner_ids and is_postgresql():
        try:
            out_of_scope_count = out_of_scope_progress_count(learner_ids, *progress_scope_predicate(
                {clean_str(value) for value in component_ids if clean_str(value)},
                PROGRESS_LINEAGE_COLUMN_BY_SCOPE.get(scope) or '', clean_str(identifier),
            ))
        except Exception as exc:
            logger.warning('Could not count out-of-scope progress: %s', exc)
    (
        reflection_declared_totals,
        reflection_rows,
        excluded_reflection_rows,
        unlinked_reflection_rows,
    ) = reflection_submission_ksb_consumption(
        learners, scope_codes, component_ids,
        restrict_to_components=not include_unattributed,
        include_unattributed=include_unattributed,
    )
    evidence_by_progress = progress_evidence_index(
        [row.get('progressId') for row in progress_rows]
        + [row.get('progressId') for row in excluded_progress_rows]
        + [row.get('progressEntryId') for row in reflection_rows]
        + [row.get('progressEntryId') for row in excluded_reflection_rows]
    )
    activities = learner_activity_trace(
        progress_rows,
        excluded_progress_rows,
        reflection_rows,
        excluded_reflection_rows,
        evidence_by_progress,
    )
    learners = apply_reflection_otjh_to_learners(learners, reflection_rows)
    learner_plans = learner_plans_for_scope(plan, learners)
    # One row per learner per component of their plan: 293k rows / ~220 MB for
    # a single group of 34 learners, and only the module progress screens read
    # it (learner_activity_status / module_progress_metrics, ?moduleProgress=1).
    # Every other caller -- the scope Achievement panels -- never looks at it.
    include_activity_plan = query.get('moduleProgress') == '1'
    activity_plan = learner_activity_plan(
        learners, component_rows, module_rows, week_rows, activities, plan, learner_plans,
    ) if include_activity_plan else None
    learner_consumption = learner_consumption_payload(
        learners,
        coverage.get('items', []),
        progress_totals,
        reflection_declared_totals,
        expected_by_learner={
            learner_id: entry.get('ksbWeights') or {}
            for learner_id, entry in learner_plans.items()
        },
    )
    out_of_scope_progress = [
        row for row in excluded_progress_rows
        if row.get('scopeStatus') in {'out_of_scope', 'unattributed'}
    ]
    excluded_progress_rows = [
        row for row in excluded_progress_rows
        if row.get('scopeStatus') not in {'out_of_scope', 'unattributed'}
    ]
    otjh = scope_otjh_summary(plan, learner_plans, learners, activities)
    ksb = scope_ksb_achievement(
        coverage.get('items', []), learner_consumption, learners, plan, learner_plans,
    )
    payload = {
        'scope': scope,
        'identifier': identifier,
        'lineage': lineage,
        'placementBasis': lineage.get('placementBasis'),
        'structure': {
            'moduleCount': len(module_rows),
            'weekCount': len(week_rows),
            'componentCount': len(component_rows),
            'ksbMappingCount': len(mapping_rows),
            # How many distinct groups deliver this scope. Above one, the scope's
            # authored totals and its per-learner totals are different figures.
            'groupCount': len({key for key in plan.get('groupKeys', set()) if key}),
        },
        'assignedLearnerCount': len(learners),
        'assignedLearners': learners,
        # `programmeCoverage` was a second copy of this same payload; nothing
        # reads it any more (the programme card uses ?view=summary).
        'coverage': coverage,
        # The two roll-ups this whole read exists for: hours actually done, and
        # KSB weight actually earned, for this scope and no other.
        'otjhAchievement': otjh,
        'ksbAchievement': ksb,
        'learnerKsbConsumption': learner_consumption,
        'learnerActivities': activities,
        'learnerActivityCount': len(activities),
        **({
            'learnerActivityPlan': activity_plan,
            'learnerActivityPlanCount': len(activity_plan),
        } if include_activity_plan else {}),
        'ksbAchievementPolicy': {
            'achievedWeightSource': 'ksb_learner_progress',
            'reflectionKsbRole': 'supplementary_evidence',
            'reflectionKsbCountsTowardAchievedWeight': False,
            'reflectionLearnerResolution': 'progress_entry_id',
            'expectedOtjhSource': 'learner_progress_entries|curriculum_component',
            'actualOtjhSource': 'learning_reflection_submissions',
            'scopeAttribution': 'curriculum.components.id',
            'unattributedActivityCounts': include_unattributed,
            # A learner is measured against the modules of the group enrolment
            # placed them in, not against every module in the scope.
            'expectedWeightBasis': 'learner_group',
            'plannedOtjhBasis': 'learner_group',
        },
        'consumptionSources': {
            'progress': progress_rows,
            'learningReflectionSubmissions': reflection_rows,
            'excludedProgress': excluded_progress_rows,
            'excludedLearningReflectionSubmissions': excluded_reflection_rows,
            'unlinkedLearningReflectionSubmissions': unlinked_reflection_rows,
            # Achieved activity that belongs to a different scope inside the same
            # programme -- the gap between this scope's total and the learner's
            # programme total. Sent as a count: the rows were 8-11 MB of a
            # module or cohort response and the page only ever showed how many.
            'outOfScopeProgressCount': len(out_of_scope_progress) if out_of_scope_count is None else out_of_scope_count,
            'evidenceByProgressEntry': evidence_by_progress,
        },
    }
    return payload, None


def _scope_learner_roster_payload_uncached(
    query,
    scope,
    identifier,
    *,
    assigned_learners_for_scope,
    clean_str,
    normalise,
    scope_placement_lineage,
    truthy,
):
    """Who enrolment placed inside a curriculum scope, and how they split up.

    Curriculum never writes learner placements: ``Learner.learners`` is owned by
    enrolment and read here so each level of the hierarchy can show who is
    arriving. A module/week/component has no roster of its own — the learners who
    meet it are the ones placed in the group that delivers it, which is what
    ``placementBasis`` says out loud.
    """
    scope = clean_str(scope) or 'programme'
    identifier = clean_str(identifier)
    lineage = scope_placement_lineage(scope, identifier)
    learner_status = clean_str(query.get('learnerStatus') or query.get('status'))
    learners = assigned_learners_for_scope(
        scope,
        identifier,
        '' if learner_status.lower() in {'', 'all'} else learner_status,
        lineage=lineage,
    )
    cohort_filter = normalise(clean_str(query.get('cohort')))
    group_filter = normalise(clean_str(query.get('group')))
    if cohort_filter:
        learners = [row for row in learners if normalise(row.get('cohort')) == cohort_filter]
    if group_filter:
        learners = [row for row in learners if normalise(row.get('group')) == group_filter]

    by_cohort = Counter()
    by_group = Counter()
    for row in learners:
        cohort_name = clean_str(row.get('cohort'))
        group_name = clean_str(row.get('group'))
        if cohort_name:
            by_cohort[cohort_name] += 1
        if cohort_name and group_name:
            by_group[f'{cohort_name}||{group_name}'] += 1

    # Bulk Attendance only needs the placement identity to intersect this
    # roster with the KBC directory. Avoid serialising hours, coaching and
    # progress fields for that screen; the compact projection keeps the same
    # endpoint contract for every other caller while making its response much
    # smaller over the remote database connection.
    compact = truthy(query.get('compact'))
    assigned_learners = learners
    if compact:
        assigned_learners = [
            {
                'id': row.get('id'),
                'name': row.get('name') or '',
                'email': row.get('email') or '',
                'cohort': row.get('cohort') or '',
                'group': row.get('group') or '',
                'cohortId': row.get('cohortId') or '',
                'groupId': row.get('groupId') or '',
            }
            for row in learners
        ]

    return {
        'scope': scope,
        'identifier': identifier,
        'lineage': lineage,
        'placementBasis': lineage.get('placementBasis'),
        # Placements are made by enrolment; curriculum only reads them.
        'source': 'enrolment',
        'editable': False,
        'assignedLearnerCount': len(learners),
        'assignedLearners': assigned_learners,
        'countsByCohort': dict(by_cohort),
        'countsByGroup': dict(by_group),
    }


def programme_achievement_inputs_uncached(
    query,
    programme_id,
    *,
    assigned_learners_for_scope,
    authoring_scope_data,
    clean_str,
    curriculum_read_scope,
    learner_progress_ksb_consumption,
    mappings_with_inferred_sources,
    required_ksbs,
    scope_placement_lineage,
    read_required_ksbs,
):
    """Read actual consumption without building the general-purpose impact report.

    Keep the same scope, placement, source and canonical progress readers as
    impact. Reflections, evidence, OTJH and the learner-by-component activity
    plan are not inputs to the Achievement tables and must not be built here.
    """
    from ...ksb_achievement import achievement_definitions

    programme_id = clean_str(programme_id)
    with curriculum_read_scope(targeted_child_reads=True):
        lineage = scope_placement_lineage('programme', programme_id)
        modules, _weeks, components, mappings = authoring_scope_data('programme', programme_id)
        if not lineage.get('found') and not modules:
            return None, ('Programme not found.', 404)
        mappings = mappings_with_inferred_sources(mappings, modules)
        required = read_required_ksbs(modules, 'programme', programme_id)
        definitions = achievement_definitions(required, mappings)
        learner_status = clean_str(query.get('learnerStatus') or query.get('status'))
        learners = assigned_learners_for_scope(
            'programme', programme_id,
            '' if learner_status.lower() in {'', 'all'} else learner_status,
            lineage=lineage,
        )
        learner_ids = [
            int(row.get('sourceId') if row.get('sourceKind') == 'learner' else row.get('id'))
            for row in learners
            if str(row.get('sourceId') if row.get('sourceKind') == 'learner' else row.get('id')).isdigit()
        ]
        _totals, progress, _excluded = learner_progress_ksb_consumption(
            learner_ids, [item.get('code') for item in definitions],
            [clean_str(row.get('id')) for row in components if clean_str(row.get('id'))],
            True, restrict_to_components=False, scope='programme', scope_identifier=programme_id,
            # Achievement keeps only rows whose code is an applied definition,
            # and only achieved, in-scope ones (see _achievement_projection).
            codes_only=True, achievement_rows_only=True,
        )
        return {
            'coverage': {'items': definitions},
            'assignedLearners': learners,
            'consumptionSources': {'progress': progress},
        }, None
