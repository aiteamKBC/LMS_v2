"""The learner-progress figures a Progress Review freezes when a coach presses
Calculate.

What this is for
----------------
A Progress Review records where one learner stood at one moment. Once it is
signed, opening it again -- or downloading its PDF two years later -- must show
the numbers as they were, not as they are now. So this module only *computes*;
``curriculum_api.review_instances`` persists the result against the Review
Instance, and every later reader (form, completed view, PDF) reads that stored
snapshot instead of calling back in here.

The calculation window
----------------------
``calculated_from`` is STRICTLY the individual learner's own programme start
date -- ``enrolment."Created_users"."Learner_start_date"``, resolved by the
caller through ``coach_api.views.resolve_review_anchor_date`` (the same
authoritative resolver Review recurrence already anchors to). Never
``Start_date``, never ``"Learner"."learners".start_date`` (the profile mirror
``active_users.mirror_learner_placement`` stamps with the COHORT delivery
window), never a group/cohort/programme-template/module/delivery date, and
never the review's own planned or previous date.

``calculated_to`` is the backend's own clock at the moment Calculate ran,
passed in as ``calculated_at``. A browser-supplied timestamp is never trusted.

Why the existing pacing functions are reused, but not the existing target
------------------------------------------------------------------------
``learner_detail._cumulative_week_target`` (what ``ActiveUser.target_hours``
and the live dashboards use) cannot serve this feature: its primary path paces
off ``curriculum.modules.start_date``, which is identical for every learner on
a module no matter when that learner individually started, and its fallback is
handed ``learner_profile.start_date`` -- the cohort mirror. Both violate the
rule above.

What IS reused, unchanged, is the pacing arithmetic underneath it:
``_sequential_week_target`` and ``active_users.target_by_elapsed_time`` already
count whole weeks elapsed from a start date and sum the plan's authored values
up to that point, and both already accept an explicit ``today``. This module
supplies the correct start date and the Calculate timestamp; it invents no new
formula and duplicates no hours arithmetic.

One basis per metric
--------------------
Planned, expected and actual within a metric always come from the same
universe -- the learner's own resolved training plan -- so expected can never
exceed planned and the variance means what it says. For off-the-job hours that
basis is the plan's authored ``expected_otjh`` (``totalExpectedOtjh``, which is
exactly the sum of the week rows expected pacing walks). Review-linked OTJH
hours, which the live dashboard folds into its own planned/completed figures,
are deliberately left out of both sides here rather than added to one of them.

Adding another expected-progress basis
--------------------------------------
Register it in ``CALCULATION_STRATEGIES`` and give the snapshot a different
``calculationMethod``. Nothing outside this module -- not the Review Instance,
its answers, signatures, completed view or PDF -- needs to change: they all
read whatever fields the stored snapshot carries.
"""
from __future__ import annotations

from datetime import date, datetime

from .active_users import (
    completed_hours_value_from_progress,
    target_by_elapsed_time,
)
from .learner_detail import (
    _sequential_week_target,
    _week_component_count_rows,
    _week_target_rows,
    build_otjh_detail,
)
from .progress_rules import progress_record_counts_as_achieved

#: The approved expected-progress basis: pace the learner's own authored plan
#: hours by whole weeks elapsed since their own start date.
CALCULATION_METHOD_PLANNED_HOURS = 'planned_hours'

DIRECTION_ABOVE = 'above'
DIRECTION_BELOW = 'below'


def _as_date(value):
    if isinstance(value, datetime):
        return value.date()
    return value if isinstance(value, date) else None


def _percent(part, whole):
    try:
        part = float(part)
        whole = float(whole)
    except (TypeError, ValueError):
        return None
    if not whole:
        return None
    return round(part / whole * 100, 2)


def _variance(actual_percent, expected_percent):
    """(variance, direction) -- None when either side is unknown, so a missing
    figure reads as "not calculated" rather than a confident 0% on track."""
    if actual_percent is None or expected_percent is None:
        return None, ''
    variance = round(actual_percent - expected_percent, 2)
    return variance, DIRECTION_ABOVE if variance >= 0 else DIRECTION_BELOW


def _metric(*, actual, expected, planned, actual_percent, expected_percent):
    variance_percent, direction = _variance(actual_percent, expected_percent)
    return {
        'actual': actual,
        'expected': expected,
        'planned': planned,
        'actualPercent': actual_percent,
        'expectedPercent': expected_percent,
        'variancePercent': variance_percent,
        'varianceDirection': direction,
    }


def _achieved_component_ids(progress):
    """Plan component ids this learner has actually achieved, by the LMS's one
    completion rule (progress_rules) -- a failed graded attempt never counts."""
    achieved = set()
    for record in progress if isinstance(progress, list) else []:
        if not isinstance(record, dict):
            continue
        component_id = str(record.get('componentId') or record.get('component_id') or '').strip()
        if component_id and progress_record_counts_as_achieved(record):
            achieved.add(component_id)
    return achieved


def _planned_hours_strategy(source, learner_profile, *, learner_start_date, calculated_at):
    detail = build_otjh_detail(source, learner_profile)
    as_of = _as_date(calculated_at)
    progress = getattr(learner_profile, 'training_plan_progress', None)

    week_rows = _week_target_rows(detail)
    planned_hours = round(float(detail.get('totalExpectedOtjh') or 0.0), 2)
    expected_hours = (
        _sequential_week_target(week_rows, learner_start_date=learner_start_date, today=as_of)
        if week_rows else None
    )
    actual_hours = round(completed_hours_value_from_progress(progress, detail.get('components')), 2)

    components = detail.get('components') or []
    planned_components = len(components)
    achieved_ids = _achieved_component_ids(progress)
    completed_components = sum(
        1 for component in components
        if str(component.get('componentId') or component.get('id') or '').strip() in achieved_ids
    )
    expected_components = target_by_elapsed_time(
        [row.get('components', 0) for row in _week_component_count_rows(detail)],
        learner_start_date,
        today=as_of,
    )

    return {
        'offTheJobHours': _metric(
            actual=actual_hours,
            expected=expected_hours,
            planned=planned_hours,
            actual_percent=_percent(actual_hours, planned_hours),
            expected_percent=_percent(expected_hours, planned_hours) if expected_hours is not None else None,
        ),
        'programmeProgress': _metric(
            actual=completed_components,
            expected=expected_components,
            planned=planned_components,
            actual_percent=_percent(completed_components, planned_components),
            expected_percent=(
                _percent(expected_components, planned_components) if expected_components is not None else None
            ),
        ),
    }


CALCULATION_STRATEGIES = {
    CALCULATION_METHOD_PLANNED_HOURS: _planned_hours_strategy,
}


def build_progress_snapshot(
    source, learner_profile, *, learner_start_date, calculated_at,
    method=CALCULATION_METHOD_PLANNED_HOURS, calculated_by='',
):
    """One learner's cumulative progress from their own programme start date up
    to ``calculated_at``, ready to be frozen against a Review Instance.

    ``learner_start_date`` must already be the learner's own start date (see
    this module's docstring); this function does not resolve it, so it cannot
    silently substitute a cohort date when the real one is missing -- the
    caller decides what to do about that instead.
    """
    strategy = CALCULATION_STRATEGIES.get(method)
    if strategy is None:
        raise ValueError(f'Unknown progress calculation method "{method}".')
    start_date = _as_date(learner_start_date)
    if start_date is None:
        raise ValueError('This learner has no individual programme start date, so progress cannot be calculated.')

    metrics = strategy(
        source, learner_profile,
        learner_start_date=start_date, calculated_at=calculated_at,
    )
    as_of = _as_date(calculated_at)
    return {
        'calculationMethod': method,
        'calculatedFrom': start_date.isoformat(),
        'calculatedAt': calculated_at.isoformat() if hasattr(calculated_at, 'isoformat') else str(calculated_at),
        'calculatedBy': calculated_by or '',
        'weeksElapsed': max(0, (as_of - start_date).days // 7) if as_of else None,
        **metrics,
    }
