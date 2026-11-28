"""Paired reading/quiz saves: exact ownership, separate evidence and timestamps.

Run with scripts/validate_progress_transfer_no_io.py; DB and network are forbidden.
"""
from copy import deepcopy
from datetime import timedelta
import json
from unittest import TestCase
from unittest.mock import Mock, patch

from django.test import RequestFactory
from types import SimpleNamespace
from . import canonical_learning, combined_activity, student_activity, subject_store, subject_timing
from . import test_legacy_quiz_attempts_no_db as quiz_tests
from . import tests_subject_timing_no_db as timing_tests
from .working_rules import DeclaredCompletionError
from .test_current_learning_no_db import adapter


def pair():
    return [
        {'activity_id': 'catalogue:50:material:10', 'group_id': 50, 'source_activity_id': 10,
         'catalogue_kind': 'material', 'category': 'Reading + Quiz', 'completed': False},
        {'activity_id': 'catalogue:50:quiz:60', 'group_id': 50, 'source_activity_id': 60,
         'catalogue_kind': 'quiz', 'completed': True,
         'source_material_activity_id': 'catalogue:50:material:10'},
    ]


class PairedReadingTests(TestCase):
    def setUp(self):
        self.items = pair()
        self.owner = {'id': 7, 'enrolment_id': 9, 'aptem_id': 11}
        self.enterContext(patch.object(canonical_learning, 'require_profile', return_value=self.owner))
        self.catalogue = self.enterContext(patch.object(canonical_learning, 'source_subjects',
            return_value={'activities': self.items}))
        self.definition = {**quiz_tests.definition(), 'catalogue_kind': 'material', 'has_reading': True}

    def read(self):
        return combined_activity.reading_part(9, 11, 50, 10, self.definition)

    def test_reading_is_independent_of_passed_quiz_and_keeps_original_definition(self):
        before = deepcopy(self.definition)
        result, completed = self.read()
        self.assertFalse(completed)
        self.assertIsNone(result['quiz'])
        self.assertEqual(result['activity_part'], 'reading')
        self.assertEqual(self.definition, before)
        self.catalogue.assert_called_once()
        self.assertEqual(self.catalogue.call_args.kwargs,
            {'owner': self.owner, 'course_ids': [50], 'include_totals': False})
        self.items[0]['completed'] = True
        self.items[1]['completed'] = False
        self.assertTrue(self.read()[1])

    def test_missing_other_course_wrong_kind_and_ambiguous_links_fail_closed(self):
        original = deepcopy(self.items)
        cases = [[], original[:1], [original[0], {**original[1], 'group_id': 51}],
            [original[0], {**original[1], 'source_material_activity_id': 'catalogue:50:material:12'}],
            [original[0], original[1], {**original[1], 'source_activity_id': 61}],
            [{**original[0], 'category': 'Quiz'}, original[1]],
            [original[0], {**original[1], 'source_activity_id': 61}]]
        for items in cases:
            with self.subTest(items=items):
                self.catalogue.return_value = {'activities': items}
                with self.assertRaises(canonical_learning.ServiceError):
                    self.read()
        self.owner['aptem_id'] = 999
        with self.assertRaises(canonical_learning.ServiceError):
            self.read()

    def test_reading_content_does_not_depend_on_quiz_being_ready_for_grading(self):
        self.definition['quiz']['ready'] = False
        self.assertIsNone(self.read()[0]['quiz'])
        self.definition['has_reading'] = False
        with self.assertRaises(canonical_learning.ServiceError):
            self.read()

    def test_reading_response_preserves_separate_completion_and_does_not_echo_quiz_answers(self):
        history = [{'kind': 'quiz', 'completed': True}, {'kind': 'activity', 'completed': False}]
        stored = {'learner_name': 'Synthetic learner', '_source': {
            'activity_id': 10, 'status': 'completed', 'quiz_passed': True, 'quiz_score': 100,
            'quiz_answers': [{'question_id': 1, 'learner_answer': ['Yes']}]}}
        with patch.object(student_activity, '_definition_for', return_value=self.definition), \
             patch.object(subject_store, 'state', return_value={'ready': True, 'history': history}), \
             patch.object(student_activity, 'authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=9)):
            response = student_activity._material_response(RequestFactory().get('/', {'activity_part': 'reading'}),
                9, 11, stored, kind='commercial', group_id=50)
        data = json.loads(response.content)
        self.assertFalse(data['completed'])
        self.assertIsNone(data['quiz'])
        self.assertEqual(data['historical']['answers'], [])
        self.assertEqual(data['history'], [history[1]])
        self.assertTrue(stored['_source']['quiz_passed'])


class ReadingEndpointTests(TestCase):
    def setUp(self):
        # Reuse the existing real permission-decorator harness, with all I/O mocked.
        self.harness = quiz_tests.LegacyAttemptEndpointTests()
        self.harness.setUp()
        self.addCleanup(self.harness.doCleanups)
        self.scope = self.harness.scope
        self.scope['_owned_material'] = Mock(return_value=(11, {}))
        self.definition = {**quiz_tests.definition(), 'has_reading': True}
        self.scope['_definition_for'] = Mock(return_value=self.definition)
        self.reading = self.enterContext(patch.object(combined_activity, 'reading_part',
            return_value=({**self.definition, 'quiz': None, 'activity_part': 'reading'}, False)))

    def request(self, *, start=True, role='learner', learner=9, part='reading', kind='commercial'):
        request = SimpleNamespace(method='POST', path='/attempts/', GET={'activity_part': part},
            account=SimpleNamespace(role=role, subject_id=learner) if role else None,
            body=json.dumps({'reading_confirmed': True, 'completed': True, 'passed': True,
                'declaredCompletedAt': '2026-10-20T10:00:00'}).encode())
        kwargs = {} if start else {'attempt_id': '00000000-0000-4000-8000-000000000001'}
        return self.scope['start_subject_attempt' if start else 'submit_subject_attempt'](
            request, kind=kind, pk=9, group_id=50, activity_id=10, **kwargs)

    def test_both_learner_types_start_only_reading_and_submit_the_owned_part(self):
        for kind in ('commercial', 'apprenticeship'):
            self.assertEqual(self.request(kind=kind).status_code, 201)
            definition = self.harness.store.start.call_args.args[4]
            self.assertIsNone(definition['quiz'])
            self.assertEqual(definition['activity_part'], 'reading')
            self.assertEqual(self.request(start=False, kind=kind).status_code, 200)
            args = self.harness.store.finish.call_args
            self.assertEqual(args.args[:4], (9, 11, 50, 10))
            self.assertEqual(args.kwargs['activity_part'], 'reading')
            self.assertEqual(args.kwargs['timing_payload']['declaredCompletedAt'], '2026-10-20T10:00:00')

    def test_finished_reading_invalid_parts_and_unauthorized_users_cannot_start(self):
        self.reading.return_value = (self.reading.return_value[0], True)
        self.assertEqual(self.request().status_code, 409)
        self.assertEqual(self.request(part='quiz').status_code, 400)
        for role, learner, status in [('learner', 99, 404), ('staff', 9, 403), ('employer', 9, 403), (None, 9, 401)]:
            for start in (True, False):
                self.assertEqual(self.request(start=start, role=role, learner=learner).status_code, status)
        self.harness.store.start.assert_not_called()
        self.harness.store.finish.assert_not_called()


class ReadingStoreTests(TestCase):
    setUp = quiz_tests.StoredQuizAttemptTests.setUp
    session = timing_tests.LegacyTimingTests.session

    def finish(self, definition, *, declared='2026-10-20T10:00:00', kind='commercial'):
        attempt, snapshot = self.session(kind, **definition)
        self.cursor.fetchone.return_value = [snapshot, None, None, None, False]
        payload = {'trackingToken': snapshot['studyTimingSession']['trackingToken'],
            'timeTakenSeconds': 120, 'timeEntrySource': 'input', 'declaredCompletedAt': declared}
        with patch.object(subject_timing.timezone, 'now', return_value=timing_tests.START + timedelta(seconds=60)):
            result = subject_store.finish(9, 11, 50, 60, attempt, {}, True,
                activity_part='reading', learner_kind=kind, timing_payload=payload)
        return result, snapshot, payload, attempt

    def test_reading_only_snapshot_has_no_quiz_and_records_both_instants_without_changing_score(self):
        for kind in ('commercial', 'apprenticeship'):
            definition = {'quiz': None, 'activity_part': 'reading'}
            result, snapshot, payload, attempt = self.finish(definition, kind=kind)
            self.assertTrue(result['completed'])
            self.assertIsNone(result['passed'])
            self.assertIsNone(result['score_percent'])
            timing = result['study_time']
            self.assertEqual(timing['submittedAt'], (timing_tests.START + timedelta(seconds=60)).isoformat())
            self.assertEqual(timing['declaredCompletedAt'], '2026-10-20T10:00:00+01:00')
            self.assertEqual(timing['selectedSeconds'], 120)
            self.assertEqual(timing['verifiedSeconds'], 60)
            self.assertIn('submitted_at=CURRENT_TIMESTAMP', self.cursor.execute.call_args.args[0])
            self.cursor.reset_mock()
            self.cursor.fetchone.return_value = [{**snapshot, 'studyTime': timing}, 'saved', None, None, True]
            retry = subject_store.finish(9, 11, 50, 60, attempt, {}, True, activity_part='reading',
                learner_kind=kind, timing_payload=payload)
            self.assertTrue(retry['already_submitted'])
            self.assertEqual(retry['study_time'], timing)
            self.assertEqual(self.cursor.execute.call_count, 1)
            subject_store.start(9, 11, 50, 60, {**snapshot, 'quiz': None})
            self.assertEqual(json.loads(self.cursor.execute.call_args.args[1][-1])['activity_part'], 'reading')

    def test_future_date_or_an_old_combined_attempt_cannot_complete_reading(self):
        with self.assertRaises(DeclaredCompletionError):
            self.finish({'quiz': None, 'activity_part': 'reading'}, declared='2027-01-01T10:00:00')
        self.assertEqual(self.cursor.execute.call_count, 1)
        self.cursor.reset_mock()
        self.cursor.fetchone.return_value = [quiz_tests.definition(), None, None, None, False]
        with self.assertRaises(LookupError):
            subject_store.finish(9, 11, 50, 60, 'old-combined', {}, True, activity_part='reading')
        self.assertEqual(self.cursor.execute.call_count, 1)

    def test_new_reading_time_preserves_quiz_history_and_repeated_projection_does_not_add_time(self):
        result, _, _, _ = self.finish({'quiz': None, 'activity_part': 'reading'})
        scope = adapter()
        quiz = {'id': 'previous-quiz', 'accepted': True, 'completed': True, 'actual_seconds': 300,
            'achieved_score': 90, 'total_score': 100, 'sources': [{'source_system': 'old_lms',
                'source_course_ref': '50', 'source_activity_id': 'quiz:60'}], 'source_payload': {}}
        attempt = {'group_id': 50, 'activity_id': 60, 'catalogue_kind': 'material', 'completed': True,
            'submitted_at': result['study_time']['submittedAt'], 'best_percent': None, 'title': 'Reading',
            'timed_attempts': [{'id': 'reading-attempt', 'completed': True, 'timing': result['study_time']}]}
        before = deepcopy(quiz)
        projected = scope['merge_attempts']([quiz], [attempt])
        self.assertEqual(quiz, before)
        self.assertEqual(next(row for row in projected if row['id'] == 'previous-quiz'), before)
        self.assertEqual(sum(row.get('actual_seconds') or 0 for row in projected), 420)
        repeated = scope['merge_attempts'](projected, [attempt])
        self.assertEqual(sum(row.get('actual_seconds') or 0 for row in repeated), 420)
