"""Overview/review population parity using synthetic catalogues only."""
from copy import deepcopy
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from old_otjh.service import ServiceError

from . import review_activity_facts as facts
from .dashboard_overview import overview_subjects
from .review_progress_snapshot import build_progress_snapshot
from .training_plan_targets import WeekScheduleResolution


def projection():
    return {'activity': None, 'detail': {'components': [], 'quizAttempts': [],
            'componentProgress': [], 'videoProgress': [], 'retiredQuizComponents': []},
            'metadata': {'builder_subjects': {}, 'current_subjects': []}}


def component(ref, module='m1', week='w1', **extra):
    return {'componentId': ref, 'moduleId': module, 'weekId': week,
            'module': module, 'component': ref, 'type': 'reading', **extra}


class ReviewActivityFactsTests(SimpleTestCase):
    def setUp(self):
        self.learning = projection()
        self.detail = self.learning['detail']

    def totals(self, result):
        return tuple(sum(m[key] for m in result['modules']) for key in ('completed', 'total'))

    def test_historical_module_suppresses_native_copy_and_preserves_unfinished_work(self):
        self.learning['activity'] = {
            'progress_basis': 'catalogue_activities',
            'subjects': [{'id': 10, 'name': 'Old course', 'module_id': 'old'}],
            'activities': [{'activity_id': str(i), 'group_id': 10, 'completed': i == 0} for i in range(3)],
        }
        self.detail['components'] = [component('old-copy', 'old'), component('new')]
        self.detail['componentProgress'] = [{'kind': 'component', 'componentId': 'new', 'passed': None}]
        before = deepcopy(self.learning)
        result = facts.overview_activity_facts(self.learning)
        self.assertEqual(self.totals(result), (2, 4))
        self.assertEqual(result['historicalComponents'], 3)
        self.assertEqual([c['componentId'] for c in result['nativeComponents']], ['new'])
        displayed = overview_subjects(self.learning)
        self.assertEqual(self.totals(result), (
            sum(bool(a['completed']) for s in displayed for a in s['activities']),
            sum(len(s['activities']) for s in displayed)))
        self.assertEqual(self.learning, before)
        # The same retained population feeds real review target arithmetic.
        live = {'owner': {}, 'otjh': {'actual': 90, 'planned': 100},
                'ksb': {'status': 'ready', 'completed': 9, 'total': 10}, **result}
        with patch('learner_api.review_progress_snapshot.read_live_inputs', return_value=live), \
             patch('learner_api.review_progress_snapshot.coach_otjh_target_to_date', return_value=95), \
             patch('learner_api.training_plan_targets.resolve_training_plan_week_starts',
                   return_value=WeekScheduleResolution({'w1': date(2027, 1, 1)}, [])):
            snapshot = build_progress_snapshot(SimpleNamespace(), SimpleNamespace(),
                learner_start_date=date(2026, 1, 1), calculated_at=datetime(2026, 11, 5, tzinfo=timezone.utc))
        self.assertEqual(snapshot['programmeProgress']['planned'], 4)
        self.assertEqual(snapshot['programmeProgress']['actualPercent'], 50)
        self.assertEqual(snapshot['programmeProgress']['expected'], 3)
        self.assertEqual(snapshot['offTheJobHours']['actual'], 90)
        self.assertEqual(snapshot['ksbProgress']['actualPercent'], 90)

    def test_native_only_counts_readings_and_passed_quizzes_like_overview(self):
        self.detail['components'] = [component('read'), component('q1', isQuiz=True, quizMeta={'quizId': 12}),
                                     component('q2', isQuiz=True, quizMeta={'quizId': 12}), component('unread')]
        self.detail['componentProgress'] = [{'kind': 'component', 'componentId': 'read', 'passed': None}]
        self.detail['quizAttempts'] = [{'quizId': 12, 'componentId': 'q1', 'passed': True}]
        self.assertEqual(self.totals(facts.overview_activity_facts(self.learning)), (3, 4))

    def test_duplicate_component_does_not_inflate_total_or_target(self):
        self.detail['components'] = [component('one'), component('one')]
        result = facts.overview_activity_facts(self.learning)
        self.assertEqual(self.totals(result), (0, 1))
        self.assertEqual(len(result['nativeComponents']), 1)

    def test_conflicting_duplicate_schedule_is_not_guessed_by_title_order(self):
        for other in [component('one', week='w2'), component('one', module='m2')]:
            with self.subTest(other=other):
                self.detail['components'] = [component('one'), other]
                with self.assertRaises(ServiceError):
                    facts.overview_activity_facts(self.learning)

    def test_same_title_different_module_id_is_not_treated_as_historical_copy(self):
        self.learning['activity'] = {'progress_basis': 'catalogue_activities',
            'subjects': [{'id': 10, 'name': 'm1', 'module_id': 'different'}],
            'activities': [{'activity_id': 'a', 'group_id': 10, 'completed': False}]}
        self.detail['components'] = [component('one')]
        self.assertEqual(self.totals(facts.overview_activity_facts(self.learning)), (0, 2))

    def test_retained_quiz_is_separate_from_current_schedule(self):
        self.detail['components'] = [component('one')]
        self.detail['retiredQuizComponents'] = [component('retired', isQuiz=True, quizMeta={'quizId': 7})]
        self.detail['quizAttempts'] = [{'quizId': 7, 'passed': True}]
        result = facts.overview_activity_facts(self.learning)
        self.assertEqual(self.totals(result), (1, 2))
        self.assertEqual(result['retainedComponents'], 1)
        self.assertEqual(len(result['nativeComponents']), 1)

    def test_missing_module_identity_fails_instead_of_fabricating_a_target(self):
        self.detail['components'] = [component('one', module=None)]
        with self.assertRaises(ServiceError):
            facts.overview_activity_facts(self.learning)

    def test_empty_catalogue_is_empty(self):
        self.assertEqual(self.totals(facts.overview_activity_facts(self.learning)), (0, 0))

    def coach_snapshot(self, *, schedule=None, learner_type='apprenticeship'):
        live = {'owner': {}, 'otjh': {'actual': 9, 'planned': 12},
                'ksb': {'status': 'ready', 'completed': 2, 'total': 3},
                **facts.overview_activity_facts(self.learning)}
        with patch('learner_api.review_progress_snapshot.read_live_inputs', return_value=live), \
             patch('learner_api.review_progress_snapshot.coach_otjh_target_to_date', return_value=6), \
             patch('learner_api.training_plan_targets.resolve_training_plan_week_starts',
                   return_value=schedule or WeekScheduleResolution({
                       'w1': date(2026, 11, 5), 'w2': date(2026, 11, 6)}, [])) as resolve:
            result = build_progress_snapshot(SimpleNamespace(learner_type=learner_type), SimpleNamespace(),
                learner_start_date=date(2026, 1, 1), calculated_at=datetime(2026, 11, 5, tzinfo=timezone.utc))
        if self.detail['components']:
            resolve.assert_called_once()
        return result

    def test_coach_target_excludes_extras_without_changing_completion_shared_target_or_hours(self):
        self.detail['components'] = [
            component('read'), component('lecture', week='w2', type='live_session'),
            component('quiz', week='w2', type='quiz', isQuiz=True, quizMeta={'quizId': 12}),
            *[component(kind, type=kind, expectedOtjh=100) for kind in ('podcast', 'video', 'powerpoint')],
        ]
        self.detail['videoProgress'] = [{'kind': 'video', 'componentId': 'video', 'passed': None}]
        before = deepcopy(self.learning)
        for learner_type in ('apprenticeship', 'commercial'):
            with self.subTest(learner_type=learner_type):
                snapshot = self.coach_snapshot(learner_type=learner_type)
                self.assertEqual(snapshot['programmeProgress'], {
                    'actual': 1, 'expected': 4, 'planned': 6, 'actualPercent': 16.67,
                    'expectedPercent': 66.67, 'variancePercent': -50, 'varianceDirection': 'below'})
                self.assertEqual(snapshot['coachProgrammeTarget'], {
                    'formulaVersion': 'scheduled_main_activities_v1',
                    'expected': 1, 'planned': 3, 'expectedPercent': 33.33,
                    'variancePercent': -33.33, 'varianceDirection': 'below'})
                self.assertEqual(snapshot['coachProgrammeProgress'], {
                    'actual': 0, 'expected': 1, 'planned': 3, 'actualPercent': 0.0,
                    'expectedPercent': 33.33, 'variancePercent': -33.33,
                    'varianceDirection': 'below'})
                self.assertEqual(snapshot['offTheJobHours']['actual'], 9)
                self.assertEqual(snapshot['offTheJobHours']['expected'], 6)
                self.assertEqual(snapshot['offTheJobHours']['planned'], 12)
                self.assertEqual(snapshot['ksbProgress']['actualPercent'], 66.67)
        self.assertEqual(self.learning, before)

    def test_main_historical_and_retained_quizzes_are_due_once(self):
        self.learning['activity'] = {'progress_basis': 'catalogue_activities',
            'subjects': [{'id': 10, 'name': 'Old course', 'module_id': 'old'}],
            'activities': [{'activity_id': str(i), 'group_id': 10, 'category': kind, 'completed': False}
                           for i, kind in enumerate(('Reading + Quiz', 'Lecture', 'Quiz', 'Podcast', 'Video', 'PowerPoint'))]}
        self.detail['components'] = [component('suppressed', module='old'), component('future', week='w2')]
        self.detail['retiredQuizComponents'] = [component('retired', type='quiz', isQuiz=True, quizMeta={'quizId': 7})]
        self.detail['quizAttempts'] = [{'quizId': 7, 'passed': True}]
        result = self.coach_snapshot()
        self.assertEqual(result['coachProgrammeTarget']['planned'], 5)
        self.assertEqual(result['coachProgrammeTarget']['expected'], 4)
        self.assertEqual(result['coachProgrammeTarget']['expectedPercent'], 80)
        self.assertEqual(result['programmeProgress']['planned'], 8)
        self.assertEqual(result['programmeProgress']['actualPercent'], 12.5)

    def test_only_named_main_types_count_and_quiz_flag_wins_over_component_type(self):
        main_types = ('reading', 'Reading + Quiz', 'reading_quiz', 'lecture', 'live_session', 'quiz', 'quizzes')
        self.detail['components'] = [component(kind, type=kind) for kind in (
            *main_types, 'podcast', 'video', 'PowerPoint', 'assignment', 'unknown', '')]
        self.detail['components'].append(component('linked-quiz', type='video', isQuiz=True, quizMeta={'quizId': 9}))
        result = facts.overview_activity_facts(self.learning)
        self.assertEqual([c['componentId'] for c in result['mainActivities']['nativeComponents']],
                         [*main_types, 'linked-quiz'])

    def test_duplicate_main_activity_counts_once(self):
        self.detail['components'] = [component('one'), component('one')]
        target = self.coach_snapshot()['coachProgrammeTarget']
        self.assertEqual((target['expected'], target['planned']), (1, 1))

    def test_conflicting_duplicate_activity_types_are_not_guessed(self):
        self.detail['components'] = [component('one'), component('one', type='video')]
        with self.assertRaises(ServiceError):
            facts.overview_activity_facts(self.learning)

    def test_no_main_activities_has_no_percentage_or_variance(self):
        for components in ([], [component('extra', type='podcast')]):
            with self.subTest(components=components):
                self.detail['components'] = components
                result = self.coach_snapshot()
                self.assertEqual(result['coachProgrammeTarget']['planned'], 0)
                self.assertEqual(result['coachProgrammeTarget']['expected'], 0)
                self.assertIsNone(result['coachProgrammeTarget']['expectedPercent'])
                self.assertIsNone(result['coachProgrammeTarget']['variancePercent'])

    def test_future_main_activity_is_not_due_even_when_already_completed(self):
        self.detail['components'] = [component('early', week='w2'), component('extra', type='video')]
        self.detail['componentProgress'] = [{'kind': 'component', 'componentId': 'early', 'passed': None}]
        result = self.coach_snapshot()
        self.assertEqual(result['programmeProgress']['actualPercent'], 50)
        self.assertEqual(result['coachProgrammeTarget']['expectedPercent'], 0)
        self.assertEqual(result['coachProgrammeTarget']['variancePercent'], 100)
        self.assertEqual(result['coachProgrammeTarget']['varianceDirection'], 'above')
        self.assertEqual(result['coachProgrammeProgress']['actualPercent'], 100)

    def test_approved_completed_delivery_uses_the_same_due_rule_for_main_target(self):
        self.detail['components'] = [component('main'), component('extra', type='video')]
        result = self.coach_snapshot(schedule=WeekScheduleResolution({}, [], frozenset({('m1', 'w1')})))
        self.assertEqual(result['coachProgrammeTarget']['expectedPercent'], 100)
        self.assertEqual(result['programmeProgress']['actualPercent'], 0)

    def test_cutoff_is_applied_to_every_progress_kind_before_projection(self):
        now = datetime(2026, 11, 5, tzinfo=timezone.utc)
        owner = {'id': 101, 'enrolment_id': 201}
        source = SimpleNamespace(pk=201)
        profile = SimpleNamespace(pk=101, enrolment_id=201, progress_entries=MagicMock())
        entries = [{'kind': kind, 'component_ref': kind + suffix, 'quiz_ref': 12, 'passed': True,
                    'submitted_at': datetime(2026, 11, day, tzinfo=timezone.utc)}
                   for kind in ('component', 'video', 'quiz', 'quiz_reading')
                   for suffix, day in [('-before', 4), ('-after', 6)]]
        profile.progress_entries.using.return_value.filter.return_value.exclude.return_value.values.return_value = entries
        records = [{'submitted_at': '2026-11-04'}, {'submitted_at': '2026-11-06'}]
        with patch.object(facts.canonical_learning, 'require_profile', return_value=owner), \
             patch.object(facts.canonical_learning, 'entries_for', return_value=records), \
             patch.object(facts, 'learning_projection', return_value=self.learning) as read, \
             patch.object(facts, 'retain_quiz_progress') as retain:
            facts.dashboard_activity_facts(source, profile, as_of=now, include_required=True)
        self.assertEqual(read.call_args.args, (source, owner, records[:1]))
        self.assertTrue(read.call_args.kwargs['required_activities'])
        self.assertTrue(read.call_args.kwargs['include_activity_dates'])
        progress = read.call_args.kwargs['progress']
        self.assertEqual([len(bucket) for bucket in progress], [1, 1, 2])
        self.assertTrue(all(r['componentId'].endswith('-before') for bucket in progress for r in bucket))
        retain.assert_called_once_with(self.detail, completed_only=True, strict=True)

    def test_foreign_profile_fails_before_catalogue_or_completion_reads(self):
        with patch.object(facts.canonical_learning, 'require_profile', return_value={'id': 999, 'enrolment_id': 201}), \
             patch.object(facts.canonical_learning, 'entries_for') as read:
            with self.assertRaises(ServiceError):
                facts.dashboard_activity_facts(SimpleNamespace(pk=201),
                    SimpleNamespace(pk=101, enrolment_id=201), as_of=datetime.now(timezone.utc))
        read.assert_not_called()

    def test_optional_record_count_reuses_cutoff_records_and_excludes_hours_only_entries(self):
        now = datetime(2026, 11, 5, tzinfo=timezone.utc)
        owner = {'id': 101, 'enrolment_id': 201}
        profile = SimpleNamespace(pk=101, enrolment_id=201, progress_entries=MagicMock())
        profile.progress_entries.using.return_value.filter.return_value.exclude.return_value.values.return_value = []
        records = [
            {'kind': 'component', 'completed': True, 'submitted_at': '2026-11-04'},
            {'kind': 'component', 'completed': True, 'submitted_at': '2026-11-04'},
            {'kind': 'component', 'completed': False, 'submitted_at': '2026-11-04'},
            {'kind': 'migrated_review', 'completed': True, 'submitted_at': '2026-11-04'},
            {'kind': 'component', 'hours_only': True, 'completed': True, 'submitted_at': '2026-11-04'},
            {'kind': 'component', 'completed': True, 'submitted_at': '2026-11-06'},
        ]
        with patch.object(facts.canonical_learning, 'require_profile', return_value=owner), \
             patch.object(facts.canonical_learning, 'entries_for', return_value=records) as entries, \
             patch.object(facts, 'learning_projection', return_value=self.learning), \
             patch.object(facts, 'retain_quiz_progress'):
            result = facts.dashboard_activity_facts(SimpleNamespace(pk=201), profile, as_of=now, include_record_counts=True)
        self.assertEqual(result['completedRecords'], 2)
        entries.assert_called_once_with(owner, training_summary=True)
