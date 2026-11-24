"""Coordinate progress and reflection reads, identity and scope projections."""
from collections import defaultdict


def learner_progress_ksb_consumption(learner_ids, programme_ksb_codes, component_ids=(), include_unattributed=True, restrict_to_components=False, scope='', scope_identifier='', codes_only=False, in_scope_only=False, achievement_rows_only=False, *, PROGRESS_LINEAGE_COLUMN_BY_SCOPE, clean_str, coverage_normalise_code, float_weight, otjh_number, progress_achievement_status, progress_consumption_rows, progress_counts_as_achieved, progress_scope_predicate, progress_source_available):
    """Per-learner achieved KSB weight, and the rows that produced it.

    ``achievement_rows_only`` (the KSB achievement tab): read only achieved,
    in-scope entries, without reflection text. That tab keeps nothing else --
    it drops every row not ``in_scope`` and not ``countsTowardAchievement`` --
    so its rows are unchanged, while ``totals`` and ``excluded_rows`` then
    describe only those entries and must not be read.

    ``in_scope_only`` (a narrowed scope only): leave out-of-scope and
    unattributed activity in the database instead of returning it in
    ``excluded_rows``; out_of_scope_progress_count() says how many there are.
    The totals do not change: those rows never reach them.

    Returns ``(totals, achieved_rows, excluded_rows)``. Failed and unresolved
    activity is fetched and returned in ``excluded_rows`` — it stays visible as
    learner history — but contributes nothing to ``totals`` and is kept out of
    ``achieved_rows``, which is what the Curriculum impact view sums. The gate
    is ``learner_api.progress_rules``, the single completion rule, so a failed
    row cannot reach the totals even when it carries a valid ``component_ref``,
    valid lineage and a valid KSB snapshot.

    ``component_ids`` scopes the read to one part of the hierarchy. A KSB code
    filter alone cannot do this: the same code is taught in several modules, so a
    cohort asked for its own achievement would be handed the whole programme's.
    Every row carries ``scopeStatus``:

    ``in_scope``      the activity resolves to a component inside this scope.
    ``out_of_scope``  it resolves to a component outside it — real achievement,
                      belonging to a different scope's total, so it is reported
                      in ``excluded_rows`` and summed nowhere here.
    ``unattributed``  it carries no ``component_ref`` at all, so which scope it
                      belongs to is unknowable. ``include_unattributed`` decides
                      whether it still counts: true for a programme (the widest
                      scope, where it is at least in the right place), false for
                      anything narrower, which would be a guess.

    ``restrict_to_components`` is what makes an *empty* ``component_ids`` mean
    "nothing is in this scope" rather than "apply no filter". Without it, a cohort
    that has authored no components yet would be credited with everything its
    learners did anywhere on the programme — the exact over-attribution the scope
    filter exists to prevent. Pass it for every scope narrower than a programme.

    ``scope``/``scope_identifier`` add the second way an activity can be placed.
    A component that has since been deleted is not in ``component_ids`` any more,
    but the progress row still carries the programme/cohort/group/module/week it
    was completed in — so the hours and KSB weight a learner really earned here
    are credited here instead of being reported as another scope's. ``scopeBasis``
    says which of the two placed the row: ``component`` (it is in the scope's live
    content) or ``lineage`` (the row's own stamped reference).

    The join to ``learner_progress_ksbs`` is a LEFT join, and that is the point:
    most completed components carry no KSB snapshot at all, and an inner join
    made every one of them invisible — taking their off-the-job hours and their
    place in the activity feed with them. A row with no KSB comes back with an
    empty ``code`` and zero weight: it contributes nothing to ``totals``, and
    everything to OTJH.
    """
    if not learner_ids or not progress_source_available():
        return {}, [], []
    code_filter = {coverage_normalise_code(code) for code in programme_ksb_codes if coverage_normalise_code(code)}
    scope_filter = {clean_str(value) for value in (component_ids or []) if clean_str(value)}
    totals = defaultdict(lambda: defaultdict(float))
    rows_out = []
    excluded_out = []
    try:
        # ``codes_only``: the caller reads only rows carrying one of this
        # scope's codes. With no code filter every code counts, so read all.
        scope_predicate = None
        if (scope_filter or restrict_to_components) and (
                achievement_rows_only or (in_scope_only and not include_unattributed)):
            scope_predicate = progress_scope_predicate(
                scope_filter, PROGRESS_LINEAGE_COLUMN_BY_SCOPE.get(clean_str(scope)) or '', clean_str(scope_identifier),
            )
        rows = progress_consumption_rows(
            learner_ids, sorted(code_filter) if codes_only and code_filter else None, scope_predicate,
            achieved_only=achievement_rows_only,
        )
    except Exception as exc:
        # Not an empty answer: empty totals read as "nobody achieved anything".
        from ...progress_errors import LearnerProgressUnavailable
        raise LearnerProgressUnavailable() from exc
    lineage_column = PROGRESS_LINEAGE_COLUMN_BY_SCOPE.get(clean_str(scope))
    scope_ref = clean_str(scope_identifier)
    seen = set()
    for row in rows:
        code = coverage_normalise_code(row.get('ksb_code'))
        # A code this scope never authored is not achievement *here*, but the
        # activity that carried it still is. Blank the code rather than drop the
        # row: the KSB totals ignore it, OTJH and the activity feed keep it.
        if code and code_filter and code not in code_filter:
            code = ''
        component_ref = clean_str(row.get('component_ref'))
        lineage_ref = clean_str(row.get(lineage_column)) if lineage_column else ''
        if not (scope_filter or restrict_to_components):
            scope_status, scope_basis = 'in_scope', 'unfiltered'
        elif component_ref and component_ref in scope_filter:
            scope_status, scope_basis = 'in_scope', 'component'
        elif scope_ref and lineage_ref and lineage_ref == scope_ref:
            # The component is gone from this scope's live content — deleted, or
            # re-authored — but the row was stamped with this scope when the
            # learner completed it. Their work belongs here, not nowhere.
            scope_status, scope_basis = 'in_scope', 'lineage'
        elif component_ref:
            scope_status, scope_basis = 'out_of_scope', 'component'
        else:
            scope_status, scope_basis = 'unattributed', 'none'
        weight = float_weight(row.get('weight') or 0) if code else 0
        counts_as_achieved = progress_counts_as_achieved(
            kind=row.get('kind'), passed=row.get('passed'),
        )
        achievement_status = progress_achievement_status(
            kind=row.get('kind'), passed=row.get('passed'),
        )
        # Expected OTJH: the progress row's own snapshot first, the component it
        # resolves to second. Named precisely, because the source is what tells a
        # reader whether the figure survived a later curriculum edit.
        progress_expected = otjh_number(row.get('progress_expected_otjh'))
        component_expected = otjh_number(row.get('component_expected_otjh'))
        if progress_expected is not None:
            planned_otjh, planned_otjh_source = progress_expected, 'learner_progress_entries'
        elif component_expected is not None:
            planned_otjh, planned_otjh_source = component_expected, 'curriculum_component'
        else:
            planned_otjh, planned_otjh_source = None, 'not_returned'
        # 'deleted' and 'unknown' are different answers to "why can't I find this
        # module?": the first means it was removed from the catalogue, the second
        # that the component itself no longer resolves to one. Both used to be
        # indistinguishable from a live module that simply sits elsewhere.
        live_module_title = clean_str(row.get('live_module_title'))
        if row.get('module_deleted'):
            module_status = 'deleted'
        elif row.get('module_found'):
            module_status = 'live'
        else:
            module_status = 'unknown'
        payload = {
            'source': 'progress',
            'learnerId': row.get('learner_id'),
            'progressId': row.get('progress_id'),
            'kind': row.get('kind') or '',
            'componentId': component_ref,
            'componentTitle': row.get('resolved_component_title') or row.get('component_title') or '',
            'componentType': row.get('component_type') or '',
            'quizId': row.get('quiz_ref') or '',
            'module': live_module_title or clean_str(row.get('module_title')),
            'moduleCatalogueId': clean_str(row.get('live_module_catalogue_id')),
            'moduleStatus': module_status,
            'week': clean_str(row.get('live_week_title')) or clean_str(row.get('week_title')),
            'submittedAt': row.get('submitted_at').isoformat() if row.get('submitted_at') else '',
            'plannedOtjh': planned_otjh,
            'plannedOtjhSource': planned_otjh_source,
            'expectedOtjh': planned_otjh,
            'expectedOtjhSource': planned_otjh_source,
            'reportedTime': row.get('reported_time') or '',
            'reflection': row.get('feedback') or '',
            'code': code,
            'weight': weight,
            'weightClass': (row.get('weight_class') or 'soft') if code else '',
            'passed': row.get('passed'),
            'achievementStatus': achievement_status,
            'countsTowardAchievement': counts_as_achieved,
            'scopeStatus': scope_status,
            'scopeBasis': scope_basis,
            # The lineage the learner app stamped on the row at completion.
            # Reported so a row placed by lineage can be checked against the
            # scope it claims, rather than taken on trust.
            'programmeRef': clean_str(row.get('programme_ref')),
            'cohortRef': clean_str(row.get('cohort_ref')),
            'groupRef': clean_str(row.get('group_ref')),
            'moduleRef': clean_str(row.get('module_ref')),
            'weekRef': clean_str(row.get('week_ref')),
        }
        if not counts_as_achieved:
            excluded_out.append(payload)
            continue
        if scope_status == 'out_of_scope' or (scope_status == 'unattributed' and not include_unattributed):
            # Achieved, but not achieved *here*. Reported so the gap between a
            # learner's programme total and this scope's total is inspectable
            # rather than an unexplained shortfall.
            excluded_out.append({**payload, 'countsTowardAchievement': False})
            continue
        dedupe_key = (row.get('learner_id'), component_ref or row.get('progress_id'), code)
        if dedupe_key in seen:
            # The same component completed twice. The hours and the weight were
            # earned once, so only the first attempt counts — but the repeat is
            # real history, so it is reported rather than swallowed.
            excluded_out.append({
                **payload,
                'countsTowardAchievement': False,
                'exclusionReason': 'repeat_completion',
            })
            continue
        seen.add(dedupe_key)
        if code:
            totals[row.get('learner_id')][code] += float(weight or 0)
        rows_out.append(payload)
    return (
        {learner_id: dict(code_totals) for learner_id, code_totals in totals.items()},
        rows_out,
        excluded_out,
    )


def reflection_submission_ksb_consumption(learners, programme_ksb_codes, component_ids=(), restrict_to_components=False, include_unattributed=True, *, clean_str, coverage_normalise_code, float_weight, ksb_sort_key, otjh_number, parse_ksb_weights, progress_achievement_status, progress_counts_as_achieved, reflection_columns, reflection_rows, unique):
    """Reflections for this programme's learners, resolved through Progress.

    A reflection is a write-up *about* a Progress activity, and
    ``learning_reflection_submissions.progress_entry_id`` is the deterministic
    link to it. That link is the only way a reflection is attached to a learner
    here: the progress row carries the learner-profile id and the
    component/module/week lineage, and both are immutable once written. So the
    lineage this reader walks is Learner -> Progress -> Component -> Reflection,
    in that direction.

    ``learning_reflection_submissions.learner_id`` is the canonical
    ``"Learner"."learners".id`` owner. This reader still resolves attribution
    through ``progress_entry_id`` because that immutable link also supplies the
    component lineage and completion outcome used by Curriculum impact.

    Returns ``(declared_totals, rows, excluded_rows, unlinked_rows)``.

    ``declared_totals`` is *declared* weight, never achieved weight. The
    Component Progress snapshot (``learner_progress_ksbs``) is the canonical
    achievement source — see ``learner_progress_ksb_consumption`` — so a
    reflection's KSB declaration is supplementary evidence *about the same
    activity*. Adding it to achieved totals would count one activity's KSBs
    twice, which is why ``learner_consumption_payload`` keeps the two apart.

    ``excluded_rows`` is the completion gate of ``learner_api.progress_rules``
    applied through the linked progress row, so a reflection cannot launder a
    failed attempt into achievement. ``unlinked_rows`` are reflections against a
    component in this programme that carry no ``progress_entry_id``: they cannot
    be attributed to a learner without guessing, so they are reported as a
    visible gap rather than silently dropped or silently credited.

    ``restrict_to_components`` narrows the read to one part of the hierarchy the
    same way ``learner_progress_ksb_consumption`` does, and for the same reason:
    a reflection's *actual* OTJH is the only recorded figure for hours actually
    done, so a cohort's achieved-OTJH total is only its own if the reflections
    behind it belong to its own components. Rows keep a ``scopeStatus``, and the
    ones outside the scope move to ``excluded_rows`` instead of being summed.
    """
    columns = reflection_columns()
    if columns is None:
        return {}, [], [], []
    learners_by_profile_id = {}
    for row in learners:
        for value in (row.get('id'), row.get('sourceId') if row.get('sourceKind') == 'learner' else None):
            if value in (None, ''):
                continue
            learners_by_profile_id.setdefault(str(value), row.get('id'))
    profile_ids = unique(learners_by_profile_id.keys())
    scoped_component_ids = unique([clean_str(value) for value in (component_ids or [])])
    if not profile_ids and not (scoped_component_ids or restrict_to_components):
        return {}, [], [], []
    rows = reflection_rows(profile_ids, scoped_component_ids, columns)
    if rows is None:
        return {}, [], [], []
    code_filter = {coverage_normalise_code(code) for code in programme_ksb_codes if coverage_normalise_code(code)}
    declared = defaultdict(lambda: defaultdict(float))
    rows_out = []
    excluded_out = []
    unlinked_out = []
    for row in rows:
        progress_entry_id = row.get('progress_entry_id')
        progress_learner_id = row.get('progress_learner_id')
        learner_id = (
            learners_by_profile_id.get(str(progress_learner_id))
            if progress_learner_id not in (None, '') else None
        )
        linked = progress_entry_id not in (None, '') and learner_id is not None
        weights = parse_ksb_weights(row.get('ksb_weights'))
        if code_filter:
            weights = {code: weight for code, weight in weights.items() if code in code_filter}
        # Two OTJH numbers, two sources, never merged into one field. Expected
        # comes from the Component/progress snapshot; actual is the learner's own
        # declaration in the reflection. The reflection's `planned_otjh` is only
        # a last resort, and it says so in `expectedOtjhSource`.
        progress_expected = otjh_number(row.get('progress_expected_otjh'))
        component_expected = otjh_number(row.get('component_expected_otjh'))
        declared_planned = otjh_number(row.get('planned_otjh'))
        if progress_expected is not None:
            expected_otjh, expected_source = progress_expected, 'learner_progress_entries'
        elif component_expected is not None:
            expected_otjh, expected_source = component_expected, 'curriculum_component'
        elif declared_planned is not None:
            expected_otjh, expected_source = declared_planned, 'learning_reflection_submissions'
        else:
            expected_otjh, expected_source = None, 'not_returned'
        actual_otjh = otjh_number(row.get('actual_time_hours'))
        actual_source = 'learning_reflection_submissions' if actual_otjh is not None else 'not_returned'
        counts_as_achieved = progress_counts_as_achieved(
            kind=row.get('progress_kind'), passed=row.get('progress_passed'),
        )
        achievement_status = progress_achievement_status(
            kind=row.get('progress_kind'), passed=row.get('progress_passed'),
        )
        component_id = clean_str(
            row.get('progress_component_ref')
            or row.get('component_ref')
            or row.get('activity_id')
        )
        if not restrict_to_components:
            scope_status = 'in_scope'
        elif component_id and component_id in set(scoped_component_ids):
            scope_status = 'in_scope'
        elif component_id:
            scope_status = 'out_of_scope'
        else:
            scope_status = 'unattributed'
        declared_ksbs = [
            {'code': code, 'weight': float_weight(weight or 0)}
            for code, weight in sorted(weights.items(), key=lambda item: ksb_sort_key(item[0]))
        ]
        base = {
            'source': 'learning_reflection_submissions',
            'learnerId': learner_id,
            'submissionId': row.get('id'),
            'progressEntryId': progress_entry_id,
            'progressLearnerId': progress_learner_id,
            'progressLinkStatus': 'linked' if linked else 'unlinked',
            'learnerResolution': 'progress_lineage' if linked else 'unresolved',
            'submissionLearnerId': clean_str(row.get('learner_id')),
            'learnerKind': row.get('learner_kind') or '',
            'learnerName': row.get('learner_name') or '',
            'programme': row.get('programme_name') or '',
            'activityType': row.get('activity_type') or '',
            'activityId': row.get('activity_id') or '',
            'activityTitle': row.get('activity_title') or '',
            'componentId': component_id,
            'componentTitle': (
                row.get('component_title')
                or row.get('progress_component_title')
                or row.get('activity_title')
                or ''
            ),
            'componentType': row.get('progress_component_type') or '',
            'module': row.get('progress_module_title') or row.get('module_title') or '',
            'week': row.get('progress_week_title') or row.get('week_title') or '',
            'progressKind': row.get('progress_kind') or '',
            'expectedOtjh': expected_otjh,
            'expectedOtjhSource': expected_source,
            'declaredPlannedOtjh': declared_planned,
            'actualOtjh': actual_otjh,
            'actualOtjhSource': actual_source,
            # Retained key names so existing consumers keep reading the same
            # fields; `expectedOtjh` / `actualOtjh` above are the explicit pair.
            'plannedOtjh': expected_otjh,
            'plannedOtjhSource': expected_source,
            'actualTimeHours': actual_otjh,
            'actualTimeHoursSource': actual_source,
            'status': row.get('status') or '',
            'reflection': row.get('learning_reflection') or '',
            'submittedAt': row.get('submitted_at').isoformat() if row.get('submitted_at') else '',
            'dateCompleted': row.get('date_completed').isoformat() if row.get('date_completed') else '',
            'qualityScore': row.get('quality_score'),
            'declaredKsbs': declared_ksbs,
            'achievementStatus': achievement_status if linked else 'unlinked',
            # A reflection never contributes achieved KSB weight; the Component
            # Progress snapshot does. This flag is about the *activity's*
            # outcome, which is what decides whether the declaration is even
            # reported as supplementary evidence.
            'countsTowardAchievement': False,
            'ksbRole': 'supplementary_evidence',
            'activityCountsTowardAchievement': counts_as_achieved if linked else None,
            'scopeStatus': scope_status,
        }
        # One row per declared code so consumers can index by code, plus a
        # single code-less row when a reflection declares none — otherwise the
        # reflection (and its actual OTJH) would vanish from the payload.
        per_code = declared_ksbs or [{'code': '', 'weight': 0}]
        for item in per_code:
            payload = dict(base, code=item['code'], weight=item['weight'])
            if not linked:
                unlinked_out.append(payload)
                continue
            if not counts_as_achieved:
                excluded_out.append(payload)
                continue
            if scope_status == 'out_of_scope' or (scope_status == 'unattributed' and not include_unattributed):
                excluded_out.append(payload)
                continue
            if item['code']:
                declared[learner_id][item['code']] += float(item['weight'] or 0)
            rows_out.append(payload)
    return (
        {learner_id: dict(code_totals) for learner_id, code_totals in declared.items()},
        rows_out,
        excluded_out,
        unlinked_out,
    )
