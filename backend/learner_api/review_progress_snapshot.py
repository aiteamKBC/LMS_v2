"""Build the progress snapshot frozen when a coach presses Calculate.

Actual hours, whole-programme planned hours, the assigned activity catalogue
and KSB evidence points use the live Dashboard readers. No learner totals are
repaired or persisted here. Review allowances are already included by those
readers and must not be added a second time.

Current activity targets retain authoritative week scheduling and approved
completed-delivery rules. Previous-learning catalogue activities and retained
quiz records are wholly due, without awarding completion or inventing dates.
The hour target reuses the Dashboard's programme-window calculation. All
percentage and variance arithmetic remains unchanged.

``calculatedFrom`` and legacy ``weeksElapsed`` remain as explanatory metadata
for compatible readers, but they do not drive the versioned target formula.
Snapshots are persisted by ``curriculum_api.review_instances`` and are never
recalculated on read, completion, or PDF rendering.
"""
from __future__ import annotations

from datetime import date, datetime, timezone as datetime_timezone

from .dashboard_metrics import coach_otjh_target_to_date
from .aptem_schedule import parse_aptem_date
from .review_live_inputs import read_live_inputs, nonnegative_number, UnavailableReviewProgress
from .training_plan_targets import (
    TARGET_STATUS_RESOLVED,
    calculate_training_plan_targets,
    as_of_date,
)

#: Existing strategy selector retained for backward compatibility. Formula
#: evolution is recorded independently in ``formulaVersion``.
CALCULATION_METHOD_PLANNED_HOURS = 'planned_hours'
SNAPSHOT_SCHEMA_VERSION = 5
TARGET_FORMULA_VERSION = 'canonical_dashboard_overview_activities_v7'
ACTUAL_HOURS_SOURCE = 'canonical_learning.dashboard'

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


class UnresolvedTrainingPlanTarget(ValueError):
    def __init__(self, calculation):
        self.calculation = calculation
        super().__init__('The learner training plan has no complete authoritative week schedule.')


# Compatibility for callers that previously distinguished missing actual hours.
UnavailableCompletedHours = UnavailableReviewProgress


def _catalogue_identity(component):
    """Match Dashboard cards: a verified component first, otherwise a quiz ID."""
    if component.get('componentId'):
        return f"component:{component['componentId']}"
    quiz_id = (component.get('quizMeta') or {}).get('quizId')
    return f'quiz:{quiz_id}' if quiz_id not in (None, '') else ''


def _count(value, label):
    number = nonnegative_number(value, label)
    if not number.is_integer():
        raise UnavailableReviewProgress(f'The learner\'s live {label} must be whole counts.')
    return int(number)


def _ksb_points(ksb):
    if ksb.get('status') not in {'ready', 'empty'}:
        return {'available': False, 'title': 'KSB evidence points',
                'reason': 'KSB evidence points were unavailable at calculation time.',
                'actualPercent': None, 'expectedPercent': None}
    actual = _count(ksb.get('completed'), 'completed KSB points')
    total = _count(ksb.get('total'), 'total KSB points')
    if actual > total:
        raise UnavailableReviewProgress('The learner\'s live KSB point counts are inconsistent.')
    return {'available': total > 0, 'title': 'KSB evidence points',
            'reason': None if total else 'No KSB evidence points are mapped.',
            'source': 'canonical_learning.dashboard', 'unit': 'activity_ksb_points',
            **_metric(actual=actual, expected=total, planned=total,
                      actual_percent=_percent(actual, total),
                      expected_percent=100 if total else None)}


def _planned_hours_strategy(source, learner_profile, *, learner_start_date, calculated_at):
    live = read_live_inputs(source, learner_profile, as_of=calculated_at)
    components = live['nativeComponents']
    week_pairs = sorted({
        (str(row.get('moduleId') or ''), str(row['weekId']))
        for row in components if row.get('weekId')
    })
    detail = {'components': components, 'week': [
        {'moduleId': module_id, 'weekId': week_id} for module_id, week_id in week_pairs
    ]}
    targets = calculate_training_plan_targets(
        detail,
        progress=[],
        as_of=calculated_at,
        identity_resolver=_catalogue_identity,
    )
    if targets['status'] != TARGET_STATUS_RESOLVED:
        raise UnresolvedTrainingPlanTarget(targets)

    planned_hours = nonnegative_number(live['otjh'].get('planned'), 'planned OTJ hours')
    actual_hours = nonnegative_number(live['otjh'].get('actual'), 'actual OTJ hours')
    expected_hours = coach_otjh_target_to_date(
        source, {'planned': planned_hours, 'actual': actual_hours},
        owner=live['owner'], as_of=as_of_date(calculated_at),
    )
    planned_components = sum(_count(row['total'], 'total activities') for row in live['modules'])
    completed_components = sum(_count(row['completed'], 'completed activities') for row in live['modules'])
    historical = _count(live['historicalComponents'], 'previous learning activities')
    retained = _count(live['retainedComponents'], 'retained quiz activities')
    if planned_components != targets['totalComponents'] + historical + retained or completed_components > planned_components:
        raise UnavailableReviewProgress('The learner\'s live activity population needs review.')
    expected_components = targets['targetComponents'] + historical + retained
    targets = {**targets, 'targetComponents': expected_components,
               'totalComponents': planned_components, 'completedComponents': completed_components,
               'currentPlanComponents': targets['totalComponents'],
               'historicalComponents': historical, 'retainedComponents': retained,
               'totalPlannedOtjHours': planned_hours, 'targetOtjHours': expected_hours,
               'hoursTargetSource': 'ssot:programme-plan-window',
               'activityPopulation': 'dashboard_overview_activities'}
    # These older fields described authored component/review hour sums. The
    # whole-programme Dashboard plan now owns hours, so do not persist a
    # misleading zero Review allowance or a partial sum beside its total.
    for key in ('componentPlannedOtjHours', 'reviewPlannedOtjHours', 'reviewTargetOtjHours'):
        targets.pop(key, None)

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
        'ksbProgress': _ksb_points(live['ksb']),
        'actualHoursSource': ACTUAL_HOURS_SOURCE,
        'targetCalculation': targets,
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

    if not isinstance(calculated_at, datetime) or calculated_at.tzinfo is None or calculated_at.utcoffset() is None:
        raise ValueError('Progress calculation requires a timezone-aware snapshot timestamp.')
    calculated_at_utc = calculated_at.astimezone(datetime_timezone.utc)
    metrics = strategy(
        source, learner_profile,
        learner_start_date=start_date, calculated_at=calculated_at_utc,
    )
    targets = metrics.pop('targetCalculation')
    as_of_date = date.fromisoformat(targets['asOfDate'])
    is_commercial = str(getattr(source, 'learner_type', '') or '').strip().casefold() == 'commercial'
    practical_end = None if is_commercial else (
        parse_aptem_date(getattr(source, 'practical_period_end_date', None))
        or parse_aptem_date(getattr(source, 'end_date', None))
    )
    apprenticeship_end = parse_aptem_date(getattr(source, 'apprenticeship_end_date', None))
    programme_end = (apprenticeship_end
                     or parse_aptem_date(getattr(source, 'learner_end_date', None))
                     or parse_aptem_date(getattr(source, 'end_date', None)))
    return {
        'calculationMethod': method,
        'schemaVersion': SNAPSHOT_SCHEMA_VERSION,
        'formulaVersion': TARGET_FORMULA_VERSION,
        'calculatedFrom': start_date.isoformat(),
        'calculatedAt': calculated_at_utc.isoformat().replace('+00:00', 'Z'),
        'calculatedBy': calculated_by or '',
        'programmeTimeline': {
            'startDate': start_date.isoformat(),
            'asOfDate': as_of_date.isoformat(),
            'gatewayDate': practical_end.isoformat() if practical_end else None,
            'endDate': programme_end.isoformat() if programme_end else None,
        },
        # Legacy explanatory field retained for old readers.  It no longer
        # drives either target; targetCalculation.qualifyingWeeks states the
        # authoritative schedule-based count.
        'weeksElapsed': max(0, (as_of_date - start_date).days // 7),
        'targetCalculation': targets,
        **metrics,
    }
