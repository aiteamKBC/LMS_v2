"""The Progress Review snapshot calculator (review_progress_snapshot.py).

These are deliberately SimpleTestCase + a stubbed plan: the rule under test is
which DATE the calculation is anchored to and how the existing pacing helpers
are driven by it, not how a training plan is assembled from the database. No
database is touched, created or queried here.

See tests_review_anchor_strict.py for the resolver that picks the learner's own
start date in the first place, and curriculum_api/tests_review_progress_snapshot
.py for how the result is frozen against a Review Instance.
"""
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import review_progress_snapshot
from .review_progress_snapshot import (
    CALCULATION_METHOD_PLANNED_HOURS,
    build_progress_snapshot,
)

#: The learner's own programme start date.
LEARNER_START = date(2024, 10, 18)
#: Dates that belong to something the learner merely shares -- none of these
#: may ever anchor the calculation.
COHORT_START = date(2024, 10, 1)
GROUP_START = date(2024, 10, 7)
PROGRAMME_TEMPLATE_START = date(2024, 9, 1)
MODULE_START = date(2024, 9, 15)
PREVIOUS_REVIEW_DATE = date(2025, 4, 16)

#: Two calendar weeks and a day after LEARNER_START: 2 whole weeks elapsed, so
#: weeks 1-3 of the plan are expected. Every shared date above is EARLIER, so
#: any of them would produce a larger figure -- which is what makes the
#: assertions below able to fail if the wrong date is ever used.
CALCULATED_AT = datetime(2024, 11, 2, 14, 35, 2)


def plan_detail():
    """Four one-week plan entries worth 10 authored OTJ hours each."""
    weeks = [
        {'module': 'M1', 'week': f'W{index}', 'moduleId': 'm1', 'weekId': f'w{index}'}
        for index in range(1, 5)
    ]
    components = [
        {**week, 'componentId': f'c{week["week"]}', 'component': week['week'],
         'type': 'video', 'expectedOtjh': 10.0}
        for week in weeks
    ]
    return {'week': weeks, 'components': components, 'totalExpectedOtjh': 40.0}


class ProgressSnapshotCalculationTests(SimpleTestCase):
    def setUp(self):
        self.detail = plan_detail()
        patcher = patch.object(review_progress_snapshot, 'build_otjh_detail', return_value=self.detail)
        self.build_detail = patcher.start()
        self.addCleanup(patcher.stop)
        # One completed activity worth five hours.
        self.profile = SimpleNamespace(training_plan_progress=[
            {'componentId': 'cW1', 'kind': 'component', 'verifiedSeconds': 5 * 3600},
        ])
        self.source = SimpleNamespace(
            programme='Data Technician',
            # Present on the row and deliberately WRONG for this purpose: the
            # calculator must never reach for them itself.
            start_date=COHORT_START, end_date=date(2027, 10, 17),
        )

    def snapshot(self, **overrides):
        params = {
            'learner_start_date': LEARNER_START,
            'calculated_at': CALCULATED_AT,
            'calculated_by': 'coach@example.com',
        }
        params.update(overrides)
        return build_progress_snapshot(self.source, self.profile, **params)

    # ------------------------------------------------- the start-date rule

    def test_calculated_from_is_the_individual_learners_own_start_date(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot['calculatedFrom'], LEARNER_START.isoformat())
        for shared in (COHORT_START, GROUP_START, PROGRAMME_TEMPLATE_START,
                       MODULE_START, PREVIOUS_REVIEW_DATE):
            self.assertNotEqual(snapshot['calculatedFrom'], shared.isoformat())

    def test_expected_progress_is_paced_from_the_learners_own_start_date(self):
        """The figures themselves -- not only the recorded date -- must come
        from the learner's own anchor. Two whole weeks elapsed since 18 Oct
        means three of the four plan weeks are expected: 30 of 40 hours.

        Anchoring to the cohort's 1 Oct (4 weeks) or the group's 7 Oct
        (3 weeks) would expect the whole 40 hours, so this fails if a shared
        date is ever substituted.
        """
        snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['expected'], 30.0)
        self.assertEqual(snapshot['offTheJobHours']['planned'], 40.0)
        self.assertEqual(snapshot['offTheJobHours']['expectedPercent'], 75.0)
        self.assertEqual(snapshot['programmeProgress']['expected'], 3)
        self.assertEqual(snapshot['weeksElapsed'], 2)

    def test_a_shared_start_date_would_produce_a_different_answer(self):
        """Guards the test above: if the two anchors happened to agree, the
        assertions there would prove nothing."""
        for shared in (COHORT_START, GROUP_START, PROGRAMME_TEMPLATE_START, MODULE_START):
            with self.subTest(shared=shared):
                shared_snapshot = self.snapshot(learner_start_date=shared)
                self.assertNotEqual(
                    shared_snapshot['offTheJobHours']['expected'],
                    self.snapshot()['offTheJobHours']['expected'],
                )

    def test_a_learner_with_no_start_date_of_their_own_is_refused(self):
        """Never silently falls back to a cohort/group date."""
        with self.assertRaises(ValueError) as caught:
            self.snapshot(learner_start_date=None)
        self.assertIn('no individual programme start date', str(caught.exception))

    # ------------------------------------------------------ the other end

    def test_calculated_at_is_recorded_exactly_as_the_backend_supplied_it(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot['calculatedAt'], CALCULATED_AT.isoformat())
        self.assertEqual(snapshot['calculatedBy'], 'coach@example.com')

    def test_a_later_calculation_moves_the_expected_figure_forward(self):
        later = self.snapshot(calculated_at=datetime(2024, 11, 16, 9, 0, 0))
        self.assertEqual(later['offTheJobHours']['expected'], 40.0)
        self.assertEqual(later['weeksElapsed'], 4)

    # ----------------------------------------------------- actual figures

    def test_actual_figures_come_from_the_existing_progress_calculations(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['actual'], 5.0)
        self.assertEqual(snapshot['offTheJobHours']['actualPercent'], 12.5)
        self.assertEqual(snapshot['programmeProgress']['actual'], 1)
        self.assertEqual(snapshot['programmeProgress']['planned'], 4)
        self.assertEqual(snapshot['programmeProgress']['actualPercent'], 25.0)

    def test_variance_states_the_direction_against_expected(self):
        snapshot = self.snapshot()
        # 12.5% of hours done against 75% expected.
        self.assertEqual(snapshot['offTheJobHours']['variancePercent'], -62.5)
        self.assertEqual(snapshot['offTheJobHours']['varianceDirection'], 'below')
        # 25% of components done against 75% expected.
        self.assertEqual(snapshot['programmeProgress']['varianceDirection'], 'below')

    def test_a_failed_graded_attempt_does_not_count_as_achieved(self):
        self.profile.training_plan_progress = [
            {'componentId': 'cW1', 'kind': 'quiz', 'passed': False},
        ]
        self.assertEqual(self.snapshot()['programmeProgress']['actual'], 0)

    def test_an_empty_plan_reports_nothing_rather_than_zero_percent_on_track(self):
        self.build_detail.return_value = {'week': [], 'components': [], 'totalExpectedOtjh': 0.0}
        snapshot = self.snapshot()
        self.assertIsNone(snapshot['offTheJobHours']['actualPercent'])
        self.assertIsNone(snapshot['offTheJobHours']['variancePercent'])
        self.assertEqual(snapshot['offTheJobHours']['varianceDirection'], '')

    # ------------------------------------------------- the strategy seam

    def test_the_method_is_recorded_so_the_calculation_can_be_reproduced(self):
        self.assertEqual(self.snapshot()['calculationMethod'], CALCULATION_METHOD_PLANNED_HOURS)

    def test_an_unknown_method_is_refused_rather_than_silently_defaulted(self):
        with self.assertRaises(ValueError):
            self.snapshot(method='target_date')
