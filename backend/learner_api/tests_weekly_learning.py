"""Compact Dashboard Weekly Learning read: contract, canonical rules and access.

Synthetic data only, no database: every reader is patched.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import learner_detail, weekly_learning, dashboard_weekly

CASES = Path(__file__).resolve().parents[2] / 'frontend/src/utils/__tests__/componentContentCases.json'


class ContentAvailabilityParityTests(SimpleTestCase):
    def test_matches_the_frontend_rule_on_the_shared_cases(self):
        cases = json.loads(CASES.read_text(encoding='utf-8'))
        self.assertGreater(len(cases), 20)
        for case in cases:
            with self.subTest(case['name']):
                self.assertIs(weekly_learning.component_content_available(case['component']), case['expected'])


def component(**changes):
    return {'module': 'Marketing', 'week': 'Week 1', 'component': 'Read chapter', 'moduleId': 'M1', 'weekId': 'W1',
            'componentId': 'C1', 'type': 'reading', 'description': '<p>' + 'Long text ' * 200 + '</p>',
            'assignmentTopics': [], 'assignmentBrief': None, 'assignmentBriefHtml': None, 'videoUrl': None,
            'audioUrl': None, 'contentHtml': None, 'hasReadingContent': False, 'fileName': 'r.pdf',
            'files': [{'url': '/r.pdf'}], 'reflectionPrompt': 'Think about it', 'resourceUrl': None,
            'liveSessionUrl': None, 'sessionDate': None, 'durationMinutes': 30, 'ksbWeightTotal': 2.0,
            'ksbMappingCount': 2, 'expectedOtjh': 0.5, 'isQuiz': False, 'quizMeta': None,
            'ksbMappings': [{'code': 'K1', 'description': 'A long KSB description', 'classification': 'main',
                             'weight': 1.0, 'weightClass': 'main'}], **changes}


class WeeklyComponentProjectionTests(SimpleTestCase):
    def test_keeps_identity_timing_codes_and_replaces_content_with_its_verdict(self):
        row = weekly_learning._weekly_component(component())
        self.assertEqual(row, {
            'module': 'Marketing', 'week': 'Week 1', 'component': 'Read chapter', 'expectedOtjh': 0.5,
            'componentId': 'C1', 'moduleId': 'M1', 'weekId': 'W1', 'type': 'reading', 'isQuiz': False,
            'durationMinutes': 30, 'contentAvailable': True,
            'ksbMappings': [{'code': 'K1', 'description': None, 'classification': 'main', 'weight': 1.0}],
        })
        self.assertNotIn('Long text', json.dumps(row))

    def test_quiz_video_and_missing_values_keep_learner_detail_semantics(self):
        quiz = weekly_learning._weekly_component(component(
            componentId='Q1', type='quiz', isQuiz=True, description=None, expectedOtjh=None, durationMinutes=None,
            quizMeta={'quizId': 9, 'questions': 0, 'duration': 20, 'timeUnit': 'mins', 'title': 'x'}))
        self.assertEqual(quiz['quizMeta'], {'quizId': 9, 'questions': 0, 'duration': 20, 'timeUnit': 'mins'})
        self.assertIs(quiz['contentAvailable'], False)
        self.assertIsNone(quiz['expectedOtjh'])
        self.assertNotIn('durationMinutes', quiz)
        video = weekly_learning._weekly_component(component(componentId='V1', type='video', videoUrl='https://v'))
        self.assertEqual((video['videoUrl'], video['contentAvailable']), ('https://v', True))
        self.assertNotIn('sessionDate', video)

    def test_live_sessions_keep_the_dates_their_lecture_link_matches_on(self):
        live = weekly_learning._weekly_component(component(
            componentId='L1', type=' Live - Session ', sessionDate='2026-09-14', sessionDateTimeUtc='2026-09-14T09:00:00Z',
            teamsLiveSessionId='series', liveSessionUrl='https://teams.example.test/join'))
        self.assertEqual((live['sessionDate'], live['sessionDateTimeUtc']), ('2026-09-14', '2026-09-14T09:00:00Z'))
        self.assertNotIn('teamsLiveSessionId', live)
        self.assertNotIn('liveSessionUrl', live)
        undated = weekly_learning._weekly_component(component(componentId='L2', type='live_session'))
        self.assertNotIn('sessionDate', undated)


def progress_rows():
    at = datetime(2026, 9, 7, 9, tzinfo=timezone.utc)
    return [
        ('quiz', True, 'Q1', '9', 0.9, at, at),
        ('quiz', False, 'Q2', '10', 0.1, at, at),
        ('quiz', False, None, '77', None, None, None),
        ('video', None, 'V1', None, None, None, at),
        ('component', False, 'C1', None, None, None, at),
        ('quiz_reading', True, 'R1', None, None, None, at),
        ('quiz_reading', True, 'R2', None, None, None, None),
    ]


class BuildWeeklyLearningTests(SimpleTestCase):
    def build(self, components, rows, slots=(), weeks=()):
        weeks = list(weeks)
        profile = MagicMock()
        profile.progress_entries.exclude.return_value.values_list.return_value = rows
        source = SimpleNamespace(id=265, pk=265, programme='MBA', cohort='C1', group='G1')
        forbidden = AssertionError('a write-on-read repair ran')
        with patch.object(learner_detail, 'build_learner_detail', side_effect=forbidden), \
             patch.object(learner_detail, 'advance_learner', side_effect=forbidden), \
             patch.object(learner_detail, 'hydrate_source_training_plan', side_effect=forbidden), \
             patch.object(learner_detail, 'persist_live_otjh_snapshot', side_effect=forbidden), \
             patch.object(weekly_learning, 'effective_training_plan', return_value=[{'moduleId': 'M1'}]) as plan, \
             patch.object(weekly_learning, 'get_training_plan', return_value=[]), \
             patch.object(learner_detail, '_resolve_from_master', return_value=(['Marketing'], weeks, components)) as resolve, \
             patch.object(learner_detail, '_apply_programme_assignment_template', side_effect=lambda rows, _p: rows), \
             patch.object(learner_detail, '_annotate_otjh', side_effect=lambda rows: (rows, 0.0)) as annotate, \
             patch.object(learner_detail, '_append_week_quizzes', side_effect=lambda weeks, rows, **_k: (weeks, rows)), \
             patch.object(weekly_learning, 'learner_profile_for_source', return_value=profile) as identity, \
             patch('learner_api.retained_quiz_progress.read_quiz_slots', return_value=list(slots)):
            payload = weekly_learning.build_learning_content_summary(source, 265)
        resolve.assert_called_once_with([], [], [], assigned_modules=plan.return_value, compact=True,
                                        live_session_ids=False, expected_otjh=True)
        # Strictly read-only: the identity self-heal is switched off.
        identity.assert_called_once_with(source, 265, heal=False)
        profile.progress_entries.exclude.assert_called_once_with(kind='activity_event')
        # Only rows without master hours go through the separate lookup.
        annotate.assert_called_once_with([c for c in components if 'expectedOtjh' not in c])
        return payload

    def test_splits_completion_records_exactly_as_learner_detail(self):
        payload = self.build([component()], progress_rows())
        self.assertEqual((payload['id'], payload['programme'], payload['cohort'], payload['group']), ('265', 'MBA', 'C1', 'G1'))
        self.assertEqual([(a['quizId'], a['componentId'], a['passed']) for a in payload['quizAttempts']],
                         [(9, 'Q1', True), (10, 'Q2', False), (77, None, False)])
        self.assertEqual(payload['quizAttempts'][0]['startedAt'], '2026-09-07T09:00:00+00:00')
        self.assertEqual(payload['videoProgress'], [{'kind': 'video', 'componentId': 'V1', 'passed': None}])
        self.assertEqual(payload['componentProgress'], [
            {'kind': 'component', 'componentId': 'C1', 'passed': False},
            {'kind': 'quiz_reading', 'componentId': 'R1', 'passed': True},
        ])
        self.assertEqual([row['componentId'] for row in payload['components']], ['C1'])

    def test_master_hours_skip_the_second_components_read(self):
        master = component(componentId='M-ROW', expectedOtjh=1.25)
        legacy = {key: value for key, value in component(componentId=None, component='Old row').items()
                  if key != 'expectedOtjh'}
        payload = self.build([master, legacy], [])
        self.assertEqual([row['expectedOtjh'] for row in payload['components']], [1.25, None])

    def test_carries_the_journey_order_the_hero_lecture_link_needs(self):
        week = {'module': 'Marketing', 'week': 'Week 1', 'moduleId': 'M1', 'weekId': 'W1', 'otjh': 3}
        payload = self.build([component()], [], weeks=[week])
        self.assertEqual(payload['modules'], ['Marketing'])
        self.assertEqual(payload['week'], [{'module': 'Marketing', 'week': 'Week 1', 'moduleId': 'M1', 'weekId': 'W1'}])

    def test_a_passed_quiz_follows_its_re_pointed_slot_like_learner_detail(self):
        quiz = component(componentId='Q-NEW', type='quiz', isQuiz=True, quizMeta={'quizId': 20, 'questions': 4})
        slot = {'componentId': 'Q-NEW', 'moduleId': 'M1', 'weekId': 'W1', 'week': 'Week 1', 'title': 'Quiz', 'quizId': 9}
        payload = self.build([quiz], [('quiz', True, 'Q-OLD', '9', 1.0, None, None)], slots=[slot])
        self.assertEqual(payload['quizAttempts'][0]['componentId'], 'Q-NEW')

    def test_learner_without_a_profile_has_no_completions(self):
        with patch.object(weekly_learning, 'learner_profile_for_source', return_value=None):
            self.assertEqual(weekly_learning._progress(None), ([], [], []))


class ReadOnlyIdentityTests(SimpleTestCase):
    """heal=False resolves the same legacy profile without repairing its link."""

    def resolve(self, heal):
        from . import identity
        legacy = MagicMock(enrolment_id=None)
        profiles = MagicMock()
        profiles.filter.side_effect = [MagicMock(first=MagicMock(return_value=None)),
                                       MagicMock(first=MagicMock(return_value=legacy))]
        no_twins = MagicMock()
        no_twins.filter.return_value.exclude.return_value.values_list.return_value = []
        with patch.object(identity.LearnerProfile, 'objects', profiles),              patch.object(identity.EnrolmentUser, 'all_learners', no_twins):
            found = identity.learner_profile_for_source(SimpleNamespace(pk=265, email='a@example.test'), 265, heal=heal)
        return found, legacy

    def test_read_only_lookup_never_saves(self):
        found, legacy = self.resolve(heal=False)
        self.assertIs(found, legacy)
        legacy.save.assert_not_called()
        self.assertIsNone(legacy.enrolment_id)

    def test_default_lookup_still_heals_the_link(self):
        found, legacy = self.resolve(heal=True)
        self.assertIs(found, legacy)
        legacy.save.assert_called_once_with(update_fields=['enrolment_id'])
        self.assertEqual(legacy.enrolment_id, 265)


class WeeklyLearningEndpointTests(SimpleTestCase):
    def call(self, view, account, *, method='get', error=None, missing=False):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        source = SimpleNamespace(pk=201, id=201, _weekly_training_plan=[], _weekly_learning_plan=[])
        model.all_learners.get.side_effect = model.DoesNotExist() if missing else None
        model.all_learners.get.return_value = source
        request = getattr(RequestFactory(), method)('/learner_api/weekly-learning/commercial/201/')
        request.login_account = account
        payload = {'modules': [], 'weeks': [], 'selectedWeek': None}
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch.dict(learner_detail.SOURCE_MODELS, {'commercial': model}), \
             patch.object(dashboard_weekly, 'assignment_projection', side_effect=lambda query: model.all_learners), \
             patch.object(dashboard_weekly, 'read_dashboard_weekly', return_value=payload, side_effect=error) as weekly, \
             patch.object(learner_detail, 'build_learner_detail', return_value=payload, side_effect=error) as detail:
            response = view(request, kind='commercial', pk=201)
        return response, weekly, detail

    def test_access_matches_learner_detail_for_every_caller(self):
        accounts = {
            'own learner': SimpleNamespace(role='learner', subject_id=201),
            'staff': SimpleNamespace(role='staff', subject_id=1),
            'other learner': SimpleNamespace(role='learner', subject_id=202),
            'employer': SimpleNamespace(role='employer', subject_id=201),
            'signed out': None,
        }
        for (name, account), method in [(item, method) for item in accounts.items() for method in ('get', 'post')]:
            with self.subTest(name, method=method):
                weekly, *_ = self.call(dashboard_weekly.dashboard_weekly, account, method=method)
                detail, *_ = self.call(learner_detail.learner_detail, account, method=method)
                self.assertEqual(weekly.status_code, detail.status_code)
        own, built, full = self.call(dashboard_weekly.dashboard_weekly, accounts['own learner'])
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own['Cache-Control'], 'private, no-store')
        built.assert_called_once()
        full.assert_not_called()

    def test_refused_and_failed_reads_never_report_an_empty_plan(self):
        learner = SimpleNamespace(role='learner', subject_id=201)
        post, built, _ = self.call(dashboard_weekly.dashboard_weekly, learner, method='post')
        self.assertEqual(post.status_code, 405)
        built.assert_not_called()
        missing, built, _ = self.call(dashboard_weekly.dashboard_weekly, learner, missing=True)
        self.assertEqual(missing.status_code, 404)
        built.assert_not_called()
        failed, *_ = self.call(dashboard_weekly.dashboard_weekly, learner, error=DatabaseError('offline'))
        self.assertEqual(failed.status_code, 503)
        self.assertNotIn('components', json.loads(failed.content))
        unknown = dashboard_weekly.dashboard_weekly
        with patch('login.permissions.authenticate_request', return_value=learner):
            request = RequestFactory().get('/learner_api/weekly-learning/other/201/')
            request.login_account = learner
            self.assertEqual(unknown(request, kind='other', pk=201).status_code, 404)


class FakeCursor:
    """Answers _resolve_from_master's reads by table; records every statement."""

    def __init__(self, live_rows=()):
        self.statements, self.rows, self.live_rows = [], [], list(live_rows)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.statements.append(sql)
        # Component visibility contains a nested modules query. Match the
        # primary read first so its fixture is not mistaken for module rows.
        if sql.startswith('WITH RECURSIVE chain'):
            self.rows = []  # This fixture is a native module, not a shared alias.
        elif 'JOIN curriculum.live_sessions s' in sql:
            self.rows = self.live_rows
        elif 'FROM curriculum.quiz_component_links' in sql or 'FROM curriculum.ksb_mappings' in sql:
            self.rows = []
        elif 'FROM curriculum.components WHERE' in sql:
            self.rows = [('L1', 'W1', 'M1', 'live_session', 'Lecture', '', '{"sessionDate": "2026-09-14"}',
                          None, 1, None, False, None, False, 1.5)]
        elif 'FROM curriculum.weeks' in sql:
            self.rows = [('W1', 'M1', 'Week 1', 1, 1)]
        elif 'JOIN curriculum.live_sessions' in sql:
            self.rows = self.live_rows
        elif 'FROM curriculum.modules' in sql:
            self.rows = [('M1', 'Marketing')]
        elif 'curriculum.live_sessions' in sql:
            self.rows = self.live_rows
        else:
            self.rows = []

    def fetchall(self):
        return self.rows


class ResolveFromMasterOptionTests(SimpleTestCase):
    def resolve(self, **options):
        cursor = FakeCursor()
        connection = MagicMock()
        connection.cursor.return_value = cursor
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            result = learner_detail._resolve_from_master(
                [], [], [], assigned_modules=[{'moduleId': 'M1'}], compact=True, **options)
        return result, cursor.statements

    def test_defaults_keep_learner_detail_output_and_queries(self):
        (_m, _w, components), statements = self.resolve()
        self.assertNotIn('expectedOtjh', components[0])
        self.assertTrue(any('JOIN curriculum.live_sessions s' in sql for sql in statements))

    def test_compact_weekly_options_skip_the_series_lookup_and_carry_hours(self):
        (modules, weeks, components), statements = self.resolve(live_session_ids=False, expected_otjh=True)
        _defaults, default_statements = self.resolve()
        self.assertEqual(components[0]['expectedOtjh'], 1.5)
        self.assertFalse(any('JOIN curriculum.live_sessions s' in sql for sql in statements))
        self.assertEqual(len(statements), len(default_statements) - 2)
        self.assertEqual((modules, weeks), (['Marketing'], [{'module': 'Marketing', 'week': 'Week 1', 'moduleId': 'M1', 'weekId': 'W1'}]))
        self.assertEqual(components[0]['sessionDate'], '2026-09-14')

    def test_expected_otjh_can_be_reused_by_the_summary_request(self):
        resolved = {}
        (_modules, _weeks, components), _statements = self.resolve(
            live_session_ids=False,
            expected_otjh=True,
            resolved_expected_otjh=resolved,
        )

        self.assertEqual(resolved, {'L1': 1.5})
        self.assertEqual(components[0]['expectedOtjh'], resolved['L1'])
