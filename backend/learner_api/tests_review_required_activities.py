"""Required-badge progress uses one population and real scheduled deadlines."""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from old_otjh.service import ServiceError

from .review_activity_facts import overview_activity_facts
from .review_progress_snapshot import build_progress_snapshot, _required_progress
from .tests_review_activity_facts import component, projection
from .training_plan_targets import WeekScheduleResolution


class ReviewRequiredActivityTests(SimpleTestCase):
    def setUp(self):
        self.learning = projection()
        self.learning['metadata']['activity_dates'] = {}
        self.now = datetime(2026, 11, 12, 14, tzinfo=timezone.utc)

    def add(self, ref, *, hours=1, day='2026-11-12', kind='reading', completed=False, **schedule):
        self.learning['detail']['components'].append(component(ref, type=kind, expectedOtjh=hours))
        self.learning['metadata']['activity_dates'][ref] = {
            'date': day, 'date_source': 'builder_week', **schedule}
        if completed:
            self.learning['detail']['componentProgress'].append(
                {'kind': 'component', 'componentId': ref, 'passed': None})

    def metric(self):
        return _required_progress(overview_activity_facts(self.learning)['requiredActivities'], self.now)

    def test_badge_hours_determine_membership_across_activity_types(self):
        for kind in ('reading', 'podcast', 'video', 'quiz', 'assignment', 'live_session'):
            self.add(kind, kind=kind, hours=0.5)
        for index, hours in enumerate((0, None, -1, float('nan'), float('inf'), '2', True)):
            self.add(f'optional-{index}', hours=hours)
        result = self.metric()
        self.assertEqual((result['expected'], result['planned'], result['expectedPercent']), (6, 6, 100))

    def test_calculate_freezes_required_metric_without_changing_shared_metrics(self):
        self.add('done', completed=True)
        self.add('due-audio', kind='podcast')
        self.add('future', day='2026-11-18')
        self.add('optional-done', hours=0, completed=True)
        facts = overview_activity_facts(self.learning)
        live = {'owner': {}, 'otjh': {'actual': 9, 'planned': 12},
                'ksb': {'status': 'ready', 'completed': 2, 'total': 3}, **facts}
        for learner_type in ('commercial', 'apprenticeship'):
            with self.subTest(learner_type=learner_type), \
                 patch('learner_api.review_progress_snapshot.read_live_inputs', return_value=live), \
                 patch('learner_api.review_progress_snapshot.coach_otjh_target_to_date', return_value=6), \
                 patch('learner_api.training_plan_targets.resolve_training_plan_week_starts',
                       return_value=WeekScheduleResolution({'w1': date(2026, 11, 9)}, [])):
                snapshot = build_progress_snapshot(SimpleNamespace(learner_type=learner_type), SimpleNamespace(),
                    learner_start_date=date(2026, 1, 1), calculated_at=self.now)
                required = snapshot['requiredProgrammeProgress']
                self.assertEqual(required, {
                    'formulaVersion': 'scheduled_required_activities_v1', 'unresolvedActivities': 0,
                    'actual': 1, 'expected': 2, 'planned': 3, 'actualPercent': 33.33,
                    'expectedPercent': 66.67, 'variancePercent': -33.34, 'varianceDirection': 'below'})
                self.assertEqual(snapshot['programmeProgress']['actualPercent'], 50)
                self.assertEqual(snapshot['programmeProgress']['expectedPercent'], 100)
                self.assertEqual(snapshot['offTheJobHours']['expected'], 6)
                self.assertEqual(snapshot['ksbProgress']['actualPercent'], 66.67)

    def test_end_of_week_deadline_is_not_due_at_the_start_of_the_week(self):
        self.add('assignment', kind='assignment', day='2026-11-11',
                 due_timing='End of week', week_end='2026-11-15')
        self.assertEqual(self.metric()['expectedPercent'], 0)
        self.now = datetime(2026, 11, 15, tzinfo=timezone.utc)
        self.assertEqual(self.metric()['expectedPercent'], 100)

    def test_early_completion_does_not_make_future_required_activity_due(self):
        self.add('early', day='2026-11-18', completed=True)
        result = self.metric()
        self.assertEqual((result['actualPercent'], result['expectedPercent']), (100, 0))

    def test_historical_required_activities_use_dates_and_mapped_hours(self):
        self.learning['activity'] = {'progress_basis': 'catalogue_activities',
            'subjects': [{'id': 10, 'name': 'Synthetic course', 'module_id': 'old'}],
            'activities': [
                {'activity_id': ref, 'group_id': 10, 'planned': 1, 'planned_hours_mapped': mapped,
                 'date': day, 'completed': done}
                for ref, day, mapped, done in (
                    ('due', '2026-11-11', True, True), ('future', '2026-12-01', True, False),
                    ('unmapped', '2026-11-01', False, True))]}
        self.learning['detail']['components'] = [component('hidden-copy', module='old', expectedOtjh=1)]
        result = self.metric()
        self.assertEqual((result['actual'], result['expected'], result['planned']), (1, 1, 2))
        self.assertEqual(result['expectedPercent'], 50)

    def test_missing_or_untrusted_date_makes_target_unavailable(self):
        self.add('known', completed=True)
        self.add('unknown', day=None)
        self.add('untrusted', day='2026-11-01', date_needs_review=True)
        result = self.metric()
        self.assertEqual(result['unresolvedActivities'], 2)
        self.assertEqual((result['actual'], result['planned']), (1, 3))
        self.assertIsNone(result['expected'])
        self.assertIsNone(result['expectedPercent'])
        self.assertIsNone(result['variancePercent'])

    def test_duplicates_count_once_and_conflicting_badges_fail(self):
        self.add('one')
        self.learning['detail']['components'].append(component('one', expectedOtjh=1))
        self.assertEqual(self.metric()['planned'], 1)
        self.learning['detail']['components'][-1]['expectedOtjh'] = 0
        with self.assertRaises(ServiceError):
            self.metric()
        # Dashboard counts keep their existing contract; only the review opts
        # into validating Required membership.
        shared = overview_activity_facts(self.learning, include_required=False)
        self.assertEqual(shared['modules'][0]['total'], 1)

    def test_zero_required_activities_does_not_claim_a_percentage(self):
        self.add('optional', hours=0)
        result = self.metric()
        self.assertEqual((result['actual'], result['expected'], result['planned']), (0, 0, 0))
        self.assertIsNone(result['actualPercent'])
        self.assertIsNone(result['expectedPercent'])

    def test_cutoff_uses_business_date_at_british_summer_midnight(self):
        self.add('next-uk-day', day='2026-07-02')
        self.now = datetime(2026, 7, 1, 22, 59, tzinfo=timezone.utc)
        self.assertEqual(self.metric()['expected'], 0)
        self.now = datetime(2026, 7, 1, 23, tzinfo=timezone.utc)
        self.assertEqual(self.metric()['expected'], 1)
