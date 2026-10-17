"""Verified attendance projection: no database or provider side effects."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from learner_api.teams_attendance import annotate_attendance_completion
from learner_api.module_progress import aggregate_module_progress
from coach_api.learning_plan_projection import native_state


class AttendanceCompletionTests(SimpleTestCase):
    def component(self, **over):
        return {'componentId': 'C1', 'moduleId': 'M1', 'type': 'live_session', **over}

    def test_verified_completion_is_scoped_and_does_not_mutate_records(self):
        components = [self.component(), self.component(moduleId='M2'),
                      self.component(componentId='C2'), self.component(type='reading')]
        cursor = MagicMock()
        cursor.fetchall.return_value = [('C1', 'M1', datetime(2026, 10, 14, 12, tzinfo=timezone.utc))]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch('learner_api.teams_attendance.connections', {'enrolment': connection}):
            result = annotate_attendance_completion(components, SimpleNamespace(pk=7))
        self.assertTrue(result[0]['attendanceCompleted'])
        self.assertNotIn('attendanceCompleted', result[1])
        self.assertNotIn('attendanceCompleted', result[2])
        self.assertNotIn('attendanceCompleted', result[3])
        self.assertNotIn('attendanceCompleted', components[0])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params[0], 7)
        self.assertEqual(set(params[1]), {'C1', 'C2'})
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertTrue(sql.lstrip().startswith('SELECT'))

    def test_missing_verified_evidence_clears_untrusted_flags(self):
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with patch('learner_api.teams_attendance.connections', {'enrolment': connection}):
            result = annotate_attendance_completion([self.component(attendanceCompleted=True)], SimpleNamespace(pk=7))
        self.assertNotIn('attendanceCompleted', result[0])

    def test_no_profile_or_no_live_component_needs_no_database(self):
        self.assertEqual(annotate_attendance_completion([self.component()], None), [self.component()])
        self.assertEqual(annotate_attendance_completion([self.component(type='reading')], SimpleNamespace(pk=7)),
                         [self.component(type='reading')])

    def test_attendance_and_manual_completion_count_once_and_leave_history_alone(self):
        component = self.component(attendanceCompleted=True, attendanceCompletedAt='2026-10-14T12:00:00+00:00')
        detail = {'components': [component], 'quizAttempts': []}
        progress = [{'kind': 'component', 'component_ref': 'C1', 'passed': True}]
        rows = aggregate_module_progress(None, detail, [{'id': 'M1', 'title': 'Module'}], progress)
        self.assertEqual((rows[0]['completed'], rows[0]['total'], rows[0]['percent']), (1, 1, 100))
        self.assertEqual(len(progress), 1)
        self.assertEqual(native_state(component, {}), {'status': 'completed', 'completedAt': component['attendanceCompletedAt']})
        self.assertEqual(native_state(self.component(), {})['status'], 'not-started')

    def test_student_and_coach_percentages_match_without_double_counting(self):
        from learner_api.tests_module_progress import student_before
        detail = {'components': [self.component(attendanceCompleted=True),
                                 self.component(componentId='C2')], 'quizAttempts': []}
        current = [{'id': 'M1', 'title': 'Module'}]
        for progress in ([], [{'kind': 'component', 'component_ref': 'C1', 'passed': True}]):
            with self.subTest(manual_also_present=bool(progress)):
                expected = student_before(None, detail, current, progress)
                actual = aggregate_module_progress(None, detail, current, progress)
                self.assertEqual(actual, expected)
                self.assertEqual((actual[0]['completed'], actual[0]['total'], actual[0]['percent']), (1, 2, 50))
