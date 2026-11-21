"""Attendance/requirements parity using synthetic owned records; no database writes."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase
from curriculum_api.week_visibility import visible_child_sql

from .attendance_learning import annotate_learning, learning_state, with_learning_requirements
from .live_session_progress import supplement_component_progress, supplement_module_hours
from .tests_live_session_progress import component, NOW


class AttendanceLearningTests(SimpleTestCase):
    def credit(self, **overrides):
        return dict(componentId='C1', moduleId='M1', hours=2.5, verifiedSeconds=7200,
                    submittedAt=NOW.isoformat(), title='Synthetic lecture', **overrides)

    def test_attendance_completes_lecture_while_requirement_status_is_preserved(self):
        scenarios = [
            ({}, 'completed'),
            ({'reflection_required': True}, 'reflection-required'),
            ({'reflection_required': True, 'reflection_submitted': True}, 'completed'),
            ({'reflection_required': True, 'reflection_submitted': True,
              'validation_required': True, 'marking': 'submitted_for_tutor_review'}, 'awaiting-review'),
            ({'validation_required': True}, 'submission-required'),
            ({'validation_required': True, 'marking': 'accepted'}, 'completed'),
            ({'evidence_required': True}, 'evidence-required'),
            ({'evidence_required': True, 'evidence_uploaded': True}, 'completed'),
            ({'reflection_required': True, 'reflection_submitted': True,
              'marking': 'rejected'}, 'changes-required'),
        ]
        for requirements, expected in scenarios:
            with self.subTest(requirements=requirements):
                credit = self.credit()
                before = deepcopy(credit)
                state = learning_state(credit, requirements)
                self.assertEqual(state['status'], 'completed')
                self.assertEqual(state['requirementsStatus'], expected)
                self.assertEqual(state['attendance'], 'present')
                self.assertEqual(state['attendedSeconds'], 7200)
                self.assertEqual(credit, before)

    def test_explicit_staff_completion_override_retains_its_existing_meaning(self):
        state = learning_state(self.credit(timeTrackingSource='manual_attendance'),
            {'reflection_required': True, 'validation_required': True, 'evidence_required': True})
        self.assertEqual(state['status'], 'completed')

    def test_attendance_completes_student_and_coach_without_rewriting_pending_work(self):
        from .module_progress import aggregate_module_progress
        from coach_api.learning_plan_projection import native_state, native_entry
        credit = self.credit()
        credit['liveSessionLearning'] = learning_state(credit, {'reflection_required': True})
        saved = [{'componentId': 'C1', 'moduleId': 'M1', 'kind': 'component',
                  'reportedTime': '60 minutes', 'feedback': 'Saved history'}]
        before = deepcopy(saved)
        progress = supplement_component_progress(saved, [credit])
        self.assertEqual(progress[0]['reportedTime'], '150 minutes')
        self.assertTrue(progress[0]['completionEligible'])
        self.assertEqual(saved, before)
        self.assertEqual(supplement_component_progress(progress, [credit]), progress)
        detail = {'components': annotate_learning([component(module='Synthetic module')], [credit]),
                  'componentProgress': progress, 'videoProgress': [], 'quizAttempts': []}
        activity = detail['components'][0]
        self.assertTrue(native_entry(activity, detail)['_done'])
        self.assertEqual(native_state(activity, detail), {'status': 'completed', 'completedAt': NOW.isoformat()})
        self.assertEqual(activity['liveSessionLearning']['requirementsStatus'], 'reflection-required')
        modules = aggregate_module_progress(None, detail, [], [
            {'kind': 'component', 'component_ref': 'C1', 'passed': None}])
        self.assertEqual((modules[0]['total'], modules[0]['completed']), (1, 1))
        hours = supplement_module_hours({'M1': {'hours': {'actual': 1}}},
            [{'component_ref': 'C1', 'actual_seconds': 3600, 'accepted': True}], [credit])
        self.assertEqual(hours['M1']['hours']['actual'], 2.5)

    def test_state_is_owned_by_component_and_module_and_does_not_mutate_inputs(self):
        credit = self.credit()
        credit['liveSessionLearning'] = learning_state(credit, {})
        components = [component(), component(moduleId='OTHER'), component(componentId='OTHER')]
        before = deepcopy(components)
        result = annotate_learning(components, [credit])
        self.assertTrue(result[0]['attendanceCompleted'])
        self.assertNotIn('liveSessionLearning', result[1])
        self.assertNotIn('liveSessionLearning', result[2])
        self.assertEqual(components, before)

    def test_reader_scopes_reflections_evidence_and_legacy_progress_to_the_owner(self):
        for kind in ('commercial', 'apprenticeship'):
            source = SimpleNamespace(pk=7, learner_type=kind,
                _case_file_profile=SimpleNamespace(pk=70, enrolment_id=7))
            connection = MagicMock()
            cursor = connection.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('C1', 'M1', True, True, False,
                                             'submitted_for_tutor_review', True, False)]
            with self.subTest(kind=kind), patch('learner_api.attendance_learning.connections', {'enrolment': connection}):
                credits = [self.credit()]
                result = with_learning_requirements(source, credits)
                self.assertEqual(result[0]['liveSessionLearning']['status'], 'completed')
                self.assertEqual(result[0]['liveSessionLearning']['requirementsStatus'], 'awaiting-review')
                self.assertNotIn('liveSessionLearning', credits[0])
                sql, params = cursor.execute.call_args.args
                self.assertEqual(params[1:], [70, kind, 70, 70, kind, ['C1']])
                self.assertIn('p.module_ref=c.module_catalogue_id', sql)
                self.assertIn('p.deleted_at IS NULL', sql)
                self.assertIn('learner_kind=%s', sql)
                self.assertIn(visible_child_sql('c'), sql)
                self.assertNotIn('c.deleted_at', sql)
                self.assertNotIn('c.is_programme_deleted', sql)

    def test_absence_legacy_manual_progress_recording_and_snapshots_are_unchanged(self):
        with patch('learner_api.attendance_learning.connections') as db:
            for credits in ([], [{'componentId': 'C1', 'hours': 2.5,
                                  'timeTrackingSource': 'completed_live_session'}],
                            [self.credit(componentType='video')]):
                self.assertIs(with_learning_requirements(None, credits), credits)
            snapshot = [self.credit()]
            self.assertIs(with_learning_requirements(None, snapshot, as_of=NOW), snapshot)
            db.__getitem__.assert_not_called()

    def test_failed_requirement_read_is_not_silently_reported_as_completed(self):
        source = SimpleNamespace(pk=7, _case_file_profile=SimpleNamespace(pk=70, enrolment_id=7))
        with patch('learner_api.attendance_learning.connections') as db:
            db.__getitem__.return_value.cursor.side_effect = DatabaseError('synthetic failure')
            with self.assertRaises(DatabaseError):
                with_learning_requirements(source, [self.credit()])
