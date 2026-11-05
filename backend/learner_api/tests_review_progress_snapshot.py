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
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import review_progress_snapshot
from .review_progress_snapshot import (
    CALCULATION_METHOD_PLANNED_HOURS,
    build_progress_snapshot,
)
from .training_plan_targets import WeekScheduleResolution, resolve_training_plan_week_starts as real_week_resolver
from .review_activity_facts import overview_activity_facts
from .progress_cutoff import records_as_of

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
        self.live_otjh = {'actual': 250.5, 'planned': 40}
        self.live_ksb = {'status': 'ready', 'completed': 159, 'total': 166}
        self.historical = None
        def live_inputs(source, profile, *, as_of):
            progress = [{**row, 'component_ref': row.get('componentId'), 'passed': row.get('passed')}
                        for row in records_as_of(profile.training_plan_progress, as_of)]
            facts = overview_activity_facts({
                'activity': self.historical,
                'detail': {**self.detail, 'quizAttempts': [], 'componentProgress': [
                    {**row, 'componentId': row['component_ref']} for row in progress]},
                'metadata': {'builder_subjects': {}},
            })
            return {'owner': {'id': 101, 'enrolment_id': 201}, 'otjh': dict(self.live_otjh),
                    'ksb': dict(self.live_ksb), **facts}
        patcher = patch.object(review_progress_snapshot, 'read_live_inputs', side_effect=live_inputs)
        self.live_read = patcher.start()
        self.addCleanup(patcher.stop)
        # Schedule-specific assertions below stay independent of hour pacing.
        # The real Dashboard hour target is separately exercised below.
        patcher = patch.object(review_progress_snapshot, 'coach_otjh_target_to_date',
                               side_effect=lambda *args, as_of, **kw: 30 if as_of < date(2024, 11, 8) else 40)
        self.hour_target = patcher.start()
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
        # Deliberately stale columns must not supply new Review metrics.
        self.profile = SimpleNamespace(
            completed_hours=Decimal('21.90'),
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

    def test_timeline_freezes_learner_dates_at_calculation(self):
        self.source.practical_period_end_date = '2026-07-01'
        self.source.apprenticeship_end_date = '2027-01-01'
        result = self.snapshot()
        self.assertEqual(result['programmeTimeline'], {
            'startDate': '2024-10-18', 'asOfDate': '2024-11-02',
            'gatewayDate': '2026-07-01', 'endDate': '2027-01-01',
        })
        self.source.apprenticeship_end_date = '2028-01-01'
        self.assertEqual(result['programmeTimeline']['endDate'], '2027-01-01')

    def test_commercial_timeline_does_not_invent_gateway(self):
        self.source.learner_type = 'commercial'
        timeline = self.snapshot()['programmeTimeline']
        self.assertIsNone(timeline['gatewayDate'])
        self.assertEqual(timeline['endDate'], '2027-10-17')

    def test_expected_progress_uses_the_resolved_plan_week_dates(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['expected'], 30.0)
        self.assertEqual(snapshot['offTheJobHours']['planned'], 40.0)
        self.assertEqual(snapshot['offTheJobHours']['expectedPercent'], 75.0)
        self.assertEqual(snapshot['programmeProgress']['expected'], 3)
        self.assertEqual(snapshot['weeksElapsed'], 2)

    def test_review_hours_already_in_dashboard_totals_are_not_added_twice(self):
        self.live_otjh['planned'] = 52
        self.hour_target.side_effect = None
        self.hour_target.return_value = 33
        snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['planned'], 52.0)
        self.assertEqual(snapshot['offTheJobHours']['expected'], 33.0)
        # Canonical totals own Review allowances; this consumer adds none.
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

    def test_actual_hours_come_from_the_live_dashboard_not_stale_columns(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['actual'], 250.5)
        self.assertEqual(snapshot['offTheJobHours']['actualPercent'], 626.25)
        self.assertEqual(snapshot['actualHoursSource'], 'canonical_learning.dashboard')
        self.assertEqual(snapshot['programmeProgress']['actual'], 1)
        self.assertEqual(snapshot['programmeProgress']['planned'], 4)
        self.assertEqual(snapshot['programmeProgress']['actualPercent'], 25.0)

    def test_zero_live_completed_hours_is_valid(self):
        self.live_otjh['actual'] = 0
        snapshot = self.snapshot()
        self.assertEqual(snapshot['offTheJobHours']['actual'], 0.0)
        self.assertEqual(snapshot['offTheJobHours']['actualPercent'], 0.0)

    def test_missing_or_invalid_live_completed_hours_is_unavailable_not_zero(self):
        for value in (None, '', 'not-a-number', 'NaN', Decimal('-1')):
            with self.subTest(value=value):
                self.live_otjh['actual'] = value
                with self.assertRaises(review_progress_snapshot.UnavailableCompletedHours):
                    self.snapshot()

    def test_unavailable_live_source_does_not_fall_back_to_stale_learner_totals(self):
        self.live_read.side_effect = review_progress_snapshot.UnavailableCompletedHours('Live source unavailable')
        with self.assertRaisesMessage(ValueError, 'Live source unavailable'):
            self.snapshot()

    def test_calculation_does_not_mutate_stored_completed_hours(self):
        original = self.profile.completed_hours
        self.snapshot()
        self.assertEqual(self.profile.completed_hours, original)

    def test_each_editable_recalculation_reads_live_values_without_changing_previous_snapshot(self):
        first = self.snapshot()
        self.live_otjh['actual'] = 300.25
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

    def test_live_ksb_evidence_points_are_frozen_without_claiming_unique_standard_achievement(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot['ksbProgress']['actual'], 159)
        self.assertEqual(snapshot['ksbProgress']['planned'], 166)
        self.assertEqual(snapshot['ksbProgress']['actualPercent'], 95.78)
        self.assertEqual(snapshot['ksbProgress']['expectedPercent'], 100)
        self.assertEqual(
            snapshot['ksbProgress']['title'],
            'KSB evidence points',
        )

    def test_future_progress_is_not_included_before_the_snapshot_timestamp(self):
        self.profile.training_plan_progress = [{
            'componentId': 'cW1', 'kind': 'component',
            'submittedAt': '2024-11-03T00:00:00Z',
        }]
        snapshot = self.snapshot()
        self.assertEqual(snapshot['programmeProgress']['actual'], 0)

    def test_an_empty_plan_reports_nothing_rather_than_zero_percent_on_track(self):
        self.detail = {'week': [], 'components': [], 'totalExpectedOtjh': 0.0}
        self.live_otjh['planned'] = 0
        snapshot = self.snapshot()
        self.assertIsNone(snapshot['offTheJobHours']['actualPercent'])
        self.assertIsNone(snapshot['offTheJobHours']['variancePercent'])
        self.assertEqual(snapshot['offTheJobHours']['varianceDirection'], '')

    # ------------------------------------------------- the strategy seam

    def test_the_method_is_recorded_so_the_calculation_can_be_reproduced(self):
        self.assertEqual(self.snapshot()['calculationMethod'], CALCULATION_METHOD_PLANNED_HOURS)
        self.assertEqual(self.snapshot()['schemaVersion'], 5)
        self.assertEqual(
            self.snapshot()['formulaVersion'],
            'canonical_dashboard_overview_activities_v7',
        )

    def test_finished_previous_learning_is_due_but_does_not_automatically_award_completion(self):
        self.historical = {'subjects': [{'id': 50, 'name': 'Previous learning'}], 'activities': [
            {'group_id': 50, 'activity_id': 1, 'completed': True},
            {'group_id': 50, 'activity_id': 2, 'completed': False}]}
        metric = self.snapshot()['programmeProgress']
        self.assertEqual((metric['actual'], metric['expected'], metric['planned']), (2, 5, 6))
        self.assertEqual((metric['actualPercent'], metric['expectedPercent']), (33.33, 83.33))

    def test_live_dashboard_hour_target_reuses_same_programme_window(self):
        from .dashboard_metrics import coach_otjh_target_to_date
        self.source.start_date = date(2024, 10, 18)
        self.source.end_date = date(2025, 1, 26)  # 100-day window.
        self.live_otjh = {'actual': 21.9, 'planned': 100}
        with patch.object(review_progress_snapshot, 'coach_otjh_target_to_date', coach_otjh_target_to_date):
            metric = self.snapshot()['offTheJobHours']
        self.assertEqual(metric['expected'], 15)
        self.assertEqual(metric['actualPercent'], 21.9)
        self.assertEqual(metric['expectedPercent'], 15)
        self.assertEqual(metric['variancePercent'], 6.9)

    def test_stale_missing_column_no_longer_blocks_verified_live_totals(self):
        self.profile.completed_hours = None
        self.assertEqual(self.snapshot()['offTheJobHours']['actual'], 250.5)

    def test_empty_or_unavailable_ksb_is_not_reported_as_zero_achievement(self):
        for ksb in ({'status': 'unavailable'}, {'status': 'empty', 'completed': 0, 'total': 0}):
            self.live_ksb = ksb
            result = self.snapshot()['ksbProgress']
            self.assertFalse(result['available'])
            self.assertIsNone(result['actualPercent'])

    def test_invalid_current_schedule_still_refuses_partial_success(self):
        with patch('learner_api.training_plan_targets.resolve_training_plan_week_starts',
                   return_value=WeekScheduleResolution({}, [])):
            with self.assertRaises(review_progress_snapshot.UnresolvedTrainingPlanTarget):
                self.snapshot()

    def test_separate_quiz_cards_sharing_a_quiz_keep_the_dashboard_population(self):
        for row in self.detail['components'][:2]:
            row.update(isQuiz=True, quizMeta={'quizId': 12})
        result = self.snapshot()['programmeProgress']
        self.assertEqual(result['planned'], 4)
        self.assertEqual(result['expected'], 3)
        self.assertEqual(result['actual'], 0)  # No passed quiz attempt.

    def test_retained_quiz_record_is_due_without_automatic_achievement(self):
        self.detail['retiredQuizComponents'] = [{'componentId': 'REMOVED', 'moduleId': 'm1',
            'module': 'M1', 'isQuiz': True, 'quizMeta': {'quizId': 12}}]
        result = self.snapshot()
        self.assertEqual(result['programmeProgress']['planned'], 5)
        self.assertEqual(result['programmeProgress']['actual'], 1)
        self.assertEqual(result['programmeProgress']['expected'], 4)
        self.assertEqual(result['targetCalculation']['retainedComponents'], 1)

    def test_mismatched_catalogue_and_target_population_fails_visibly(self):
        live = self.live_read.side_effect(self.source, self.profile, as_of=CALCULATED_AT)
        live['modules'][0]['total'] += 1
        self.live_read.side_effect = None
        self.live_read.return_value = live
        with self.assertRaisesMessage(ValueError, 'activity population needs review'):
            self.snapshot()

    def test_missing_programme_window_keeps_hour_target_unavailable(self):
        from .dashboard_metrics import coach_otjh_target_to_date
        self.source.start_date = LEARNER_START
        self.source.end_date = None
        with patch.object(review_progress_snapshot, 'coach_otjh_target_to_date', coach_otjh_target_to_date):
            result = self.snapshot()['offTheJobHours']
        self.assertIsNone(result['expected'])
        self.assertIsNone(result['variancePercent'])

    def test_live_catalogue_keeps_module_and_week_identity_through_real_schedule_resolution(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = [
            [('m1', LEARNER_START, 'native')],
            [(f'w{i}', 'm1') for i in range(1, 5)],
        ]
        with patch('learner_api.training_plan_targets.connections', {'default': connection}), \
             patch('learner_api.training_plan_targets.resolve_training_plan_week_starts', real_week_resolver):
            result = self.snapshot()
        self.assertEqual(result['programmeProgress']['expected'], 3)
        self.assertEqual(result['targetCalculation']['status'], 'resolved')
        self.assertEqual(cursor.execute.call_args_list[0].args[1], ['m1'])
        self.assertEqual(result['targetCalculation']['currentWeek']['moduleId'], 'm1')

    def test_an_unknown_method_is_refused_rather_than_silently_defaulted(self):
        with self.assertRaises(ValueError):
            self.snapshot(method='target_date')
