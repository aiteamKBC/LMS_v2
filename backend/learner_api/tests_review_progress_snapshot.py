"""The Progress Review snapshot calculator (review_progress_snapshot.py).

These are deliberately SimpleTestCase + a stubbed plan: the rule under test is
which DATE the calculation is anchored to and how the existing pacing helpers
are driven by it, not how a training plan is assembled from the database. No
database is touched, created or queried here.

See tests_review_anchor_strict.py for the resolver that picks the learner's own
start date in the first place, and curriculum_api/tests_review_progress_snapshot
.py for how the result is frozen against a Review Instance.
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import review_progress_snapshot
from .review_progress_snapshot import (
    CALCULATION_METHOD_PLANNED_HOURS,
    build_progress_snapshot,
)
from .training_plan_targets import WeekScheduleResolution

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
CALCULATED_AT = datetime(2024, 11, 2, 14, 35, 2, tzinfo=timezone.utc)


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
        schedule_patcher = patch(
            'learner_api.training_plan_targets.resolve_training_plan_week_starts',
            return_value=WeekScheduleResolution({
                'w1': date(2024, 10, 18),
                'w2': date(2024, 10, 25),
                'w3': date(2024, 11, 1),
                'w4': date(2024, 11, 8),
            }, []),
        )
        schedule_patcher.start()
        self.addCleanup(schedule_patcher.stop)
        # Activity progress drives component/KSB completion only. Actual OTJ
        # comes from this already-persisted learner value.
        self.profile = SimpleNamespace(
            completed_hours=Decimal('250.50'),
            training_plan_progress=[
                {'componentId': 'cW1', 'kind': 'component', 'verifiedSeconds': 5 * 3600},
            ],
        )
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

    def test_expected_progress_uses_the_resolved_plan_week_dates(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['expected'], 30.0)
        self.assertEqual(snapshot['offTheJobHours']['planned'], 40.0)
        self.assertEqual(snapshot['offTheJobHours']['expectedPercent'], 75.0)
        self.assertEqual(snapshot['programmeProgress']['expected'], 3)
        self.assertEqual(snapshot['weeksElapsed'], 2)

    def test_qualifying_review_hours_share_the_planned_and_target_denominator(self):
        with patch.object(
            review_progress_snapshot, 'review_planned_target_hours', return_value=(12.0, 3.0),
        ):
            snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['planned'], 52.0)
        self.assertEqual(snapshot['offTheJobHours']['expected'], 33.0)
        self.assertEqual(snapshot['targetCalculation']['reviewPlannedOtjHours'], 12.0)
        self.assertEqual(snapshot['targetCalculation']['reviewTargetOtjHours'], 3.0)
        # Review actuals are deliberately not projected here: the owning OTJ
        # system has already folded everything into completed_hours.
        self.assertEqual(snapshot['offTheJobHours']['actual'], 250.5)

    def test_learner_metadata_start_does_not_replace_plan_week_dates(self):
        for shared in (COHORT_START, GROUP_START, PROGRAMME_TEMPLATE_START, MODULE_START):
            with self.subTest(shared=shared):
                shared_snapshot = self.snapshot(learner_start_date=shared)
                self.assertEqual(
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
        self.assertEqual(snapshot['calculatedAt'], '2024-11-02T14:35:02Z')
        self.assertEqual(snapshot['calculatedBy'], 'coach@example.com')

    def test_review_target_and_scheduled_dates_do_not_change_the_cutoff(self):
        self.source.target_date = date(2024, 10, 1)
        self.source.scheduled_date = date(2024, 12, 20)
        snapshot = self.snapshot()
        self.assertEqual(snapshot['targetCalculation']['asOfDate'], '2024-11-02')
        self.assertEqual(snapshot['programmeProgress']['expected'], 3)

    def test_a_later_calculation_moves_the_expected_figure_forward(self):
        later = self.snapshot(calculated_at=datetime(2024, 11, 16, 9, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(later['offTheJobHours']['expected'], 40.0)
        self.assertEqual(later['weeksElapsed'], 4)

    # ----------------------------------------------------- actual figures

    def test_actual_hours_come_from_the_stored_learner_field(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['actual'], 250.5)
        self.assertEqual(snapshot['offTheJobHours']['actualPercent'], 626.25)
        self.assertEqual(snapshot['actualHoursSource'], 'learner.completed_hours')
        self.assertEqual(snapshot['programmeProgress']['actual'], 1)
        self.assertEqual(snapshot['programmeProgress']['planned'], 4)
        self.assertEqual(snapshot['programmeProgress']['actualPercent'], 25.0)

    def test_zero_stored_completed_hours_is_valid(self):
        self.profile.completed_hours = Decimal('0.00')
        snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['actual'], 0.0)
        self.assertEqual(snapshot['offTheJobHours']['actualPercent'], 0.0)

    def test_missing_or_invalid_stored_completed_hours_is_unavailable_not_zero(self):
        for value in (None, '', 'not-a-number', 'NaN', Decimal('-1')):
            with self.subTest(value=value):
                self.profile.completed_hours = value
                with self.assertRaises(review_progress_snapshot.UnavailableCompletedHours):
                    self.snapshot()

    def test_calculation_does_not_invoke_the_activity_aggregation_resolver(self):
        with patch.object(
            review_progress_snapshot,
            'resolve_learner_completed_otj',
            create=True,
            side_effect=AssertionError('Progress Review must not aggregate completed OTJ'),
        ) as resolver:
            snapshot = self.snapshot()
        resolver.assert_not_called()
        self.assertEqual(snapshot['offTheJobHours']['actual'], 250.5)
        self.assertNotIn('completedCalculation', snapshot)

    def test_calculation_does_not_mutate_stored_completed_hours(self):
        original = self.profile.completed_hours
        self.snapshot()
        self.assertEqual(self.profile.completed_hours, original)

    def test_each_editable_recalculation_reads_the_current_stored_value(self):
        first = self.snapshot()
        self.profile.completed_hours = Decimal('300.25')
        second = self.snapshot()
        self.assertEqual(first['offTheJobHours']['actual'], 250.5)
        self.assertEqual(second['offTheJobHours']['actual'], 300.25)
        # Previously persisted JSON is a value snapshot, not a live reference.
        self.assertEqual(first['offTheJobHours']['actual'], 250.5)

    def test_variance_states_the_direction_against_expected(self):
        snapshot = self.snapshot()
        # 626.25% of hours done against 75% expected. The numeric percentage is
        # deliberately not capped even though renderers cap visual bar width.
        self.assertEqual(snapshot['offTheJobHours']['variancePercent'], 551.25)
        self.assertEqual(snapshot['offTheJobHours']['varianceDirection'], 'above')
        # 25% of components done against 75% expected.
        self.assertEqual(snapshot['programmeProgress']['varianceDirection'], 'below')

    def test_a_failed_graded_attempt_does_not_count_as_achieved(self):
        self.profile.training_plan_progress = [
            {'componentId': 'cW1', 'kind': 'quiz', 'passed': False},
        ]
        self.assertEqual(self.snapshot()['programmeProgress']['actual'], 0)

    def test_real_assigned_ksb_progress_is_frozen_in_the_snapshot(self):
        version = SimpleNamespace(
            source_profile_id='standard:st0845-v1-0', programme='Programme',
        )
        self.profile.ksb_assignment = SimpleNamespace(profile_version=version)
        self.profile.ksbs = [{'code': 'K1'}, {'code': 'S2'}]
        self.profile.training_plan_progress = [{'componentId': 'cW1', 'kind': 'component'}]
        self.detail['components'][0]['ksbMappings'] = [{'code': 'K1'}, {'code': 'OUTSIDE'}]
        standard = {
            'name': 'Project controls professional', 'version': '1.0', 'level': 'Level 6',
        }
        with patch('curriculum_api.views.find_skills_england_standard', return_value=standard):
            snapshot = self.snapshot()
        self.assertEqual(snapshot['ksbProgress']['actual'], 1)
        self.assertEqual(snapshot['ksbProgress']['planned'], 2)
        self.assertEqual(snapshot['ksbProgress']['actualPercent'], 50)
        self.assertEqual(snapshot['ksbProgress']['expectedPercent'], 100)
        self.assertEqual(
            snapshot['ksbProgress']['title'],
            'Project controls professional Apprenticeship Standard (v1.0) (Level 6)',
        )

    def test_future_progress_is_not_included_before_the_snapshot_timestamp(self):
        self.profile.training_plan_progress = [{
            'componentId': 'cW1', 'kind': 'component',
            'submittedAt': '2024-11-03T00:00:00Z',
        }]
        snapshot = self.snapshot()
        self.assertEqual(snapshot['programmeProgress']['actual'], 0)

    def test_an_empty_plan_reports_nothing_rather_than_zero_percent_on_track(self):
        self.build_detail.return_value = {'week': [], 'components': [], 'totalExpectedOtjh': 0.0}
        snapshot = self.snapshot()
        self.assertIsNone(snapshot['offTheJobHours']['actualPercent'])
        self.assertIsNone(snapshot['offTheJobHours']['variancePercent'])
        self.assertEqual(snapshot['offTheJobHours']['varianceDirection'], '')

    # ------------------------------------------------- the strategy seam

    def test_the_method_is_recorded_so_the_calculation_can_be_reproduced(self):
        self.assertEqual(self.snapshot()['calculationMethod'], CALCULATION_METHOD_PLANNED_HOURS)
        self.assertEqual(self.snapshot()['schemaVersion'], 4)
        self.assertEqual(
            self.snapshot()['formulaVersion'],
            'stored_completed_hours_and_component_ksb_v4',
        )

    def test_an_unknown_method_is_refused_rather_than_silently_defaulted(self):
        with self.assertRaises(ValueError):
            self.snapshot(method='target_date')
