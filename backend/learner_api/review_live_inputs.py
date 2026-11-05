"""Read the same verified, live facts as the learner Dashboard for Calculate.

This adapter does not repair identities, persist learner totals or touch Teams.
Review persistence remains the responsibility of the already-authorized caller.
"""
from decimal import Decimal, InvalidOperation
from math import isfinite

from old_otjh.service import ServiceError

from . import canonical_learning, journal_sources
from .module_progress import canonical_module_facts
from .training_plan_dashboard import plan_planned_hours


class UnavailableReviewProgress(ValueError):
    """Canonical facts cannot safely be attributed to this review's learner."""


def nonnegative_number(value, label):
    if value is None or isinstance(value, bool):
        raise UnavailableReviewProgress(f'The learner\'s live {label} are unavailable.')
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise UnavailableReviewProgress(f'The learner\'s live {label} are invalid.') from None
    if not number.is_finite() or number < 0:
        raise UnavailableReviewProgress(f'The learner\'s live {label} are invalid.')
    result = float(number)
    if not isfinite(result):
        raise UnavailableReviewProgress(f'The learner\'s live {label} are invalid.')
    return result


def read_live_inputs(source, learner_profile, *, as_of):
    """Use enrolment IDs for canonical reads; never substitute a profile/Aptem ID.

    The module denominator is the full assigned catalogue (including previous
    learning), not the population of rows that happen to have saved progress.
    KSB totals are activity/code evidence points, exactly as on the Dashboard.
    """
    enrolment_id = getattr(learner_profile, 'enrolment_id', None)
    if enrolment_id is None or getattr(source, 'pk', None) != enrolment_id:
        raise UnavailableReviewProgress('The consolidated learner identity needs review.')
    try:
        owner = canonical_learning.require_profile(enrolment_id)
        if owner['id'] != learner_profile.pk or owner['enrolment_id'] != enrolment_id:
            raise UnavailableReviewProgress('The consolidated learner identity needs review.')
        # Keep this read independent of whether Calculate was opened from the
        # learner or coach workspace; restore the caller's context afterwards.
        with journal_sources.learner_journal_reads():
            metrics = canonical_learning.metrics_bulk(
                [enrolment_id], learner_workspace=True, as_of=as_of,
            ).get(enrolment_id)
            if metrics is None:
                raise UnavailableReviewProgress('The consolidated learner identity needs review.')
            otjh = dict(metrics.get('otjh') or {})
            if otjh.get('planned') is None:
                # Same explicit no-plan fallback used by Dashboard Overview.
                otjh['planned'] = plan_planned_hours(source, owner)
            facts = canonical_module_facts(source, learner_profile, as_of=as_of)
    except ServiceError as error:
        # Both Native and Imported Calculate already return ValueError as a
        # visible conflict without replacing the previously frozen snapshot.
        raise UnavailableReviewProgress(str(error)) from None
    return {'owner': owner, 'otjh': otjh, **facts,
            'ksb': dict(metrics.get('ksb') or {})}
