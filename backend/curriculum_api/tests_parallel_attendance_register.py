from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .parallel_attendance_register import choose_originals, reconcile_parallel_attendance, revoke_parallel_credit, saved_parallel_links


class ParallelAttendanceRegisterTests(SimpleTestCase):
    def test_bulk_reads_saved_group_and_guest_is_not_counted_twice(self):
        from datetime import datetime, timezone
        register, modules, occurrences = MagicMock(), MagicMock(), MagicMock()
        register.objects.using.return_value.filter.return_value.exclude.return_value.values.return_value = [{
            'learner_profile_id': 10, 'occurrence_id': 'A', 'module_catalogue_id': 'MA',
            'parallel_source_occurrence_id': 'B', 'parallel_source_module_id': 'MB'}]
        modules.objects.using.return_value.filter.return_value.values_list.return_value = [('MB', 'Group B')]
        occurrences.objects.using.return_value.filter.return_value.values_list.return_value = [
            ('A', datetime(2026, 10, 1, tzinfo=timezone.utc))]
        with patch('curriculum_api.parallel_attendance_register.LiveSessionLearnerAttendance', register), \
             patch('curriculum_api.parallel_attendance_register.ModuleAuthoringModule', modules), \
             patch('curriculum_api.parallel_attendance_register.LiveSessionOccurrence', occurrences):
            originals, guests = saved_parallel_links([{'learner_profile_id': 10}], database='default')
        self.assertEqual(originals[(10, 'A', 'MA')], {'recoveryOccurrenceId': 'B', 'recoveryGroup': 'Group B'})
        self.assertFalse(guests[(10, 'B', 'MB')]['countsAsSession'])

    def test_revoking_guest_evidence_restores_the_independent_result(self):
        for basis, teams, qr, created, previous, expected in [
            ('parallel', 'absent', None, False, 'absent', ('absent', 'teams')),
            ('parallel', 'present', None, False, 'absent', ('present', 'teams')),
            ('parallel', None, 42, False, 'absent', ('present', 'qr')),
            ('staff', None, None, False, 'absent', ('absent', 'staff')),
            ('parallel', None, None, False, 'absent', ('absent', 'teams')),
        ]:
            with self.subTest(basis=basis, teams=teams, qr=qr):
                row = MagicMock(attendance_basis=basis, attendance_status='absent',
                    teams_attendance_status=teams, qr_attendance_id=qr, parallel_created=created,
                    parallel_previous_status=previous, parallel_previous_basis='teams')
                revoke_parallel_credit(row, database='default')
                self.assertEqual((row.attendance_status, row.attendance_basis), expected)
                self.assertIsNone(row.parallel_source_occurrence_id)
                row.save.assert_called_once()

    def test_revoking_a_generated_row_without_other_evidence_removes_only_that_row(self):
        row = MagicMock(attendance_basis='parallel', teams_attendance_status=None,
                        qr_attendance_id=None, parallel_created=True)
        revoke_parallel_credit(row, database='default')
        row.delete.assert_called_once_with(using='default')
        row.save.assert_not_called()

    def test_match_requires_one_assigned_original_and_guest_is_not_assigned(self):
        candidates = [{'id': 'A', 'moduleCatalogueId': 'MA'}, {'id': 'C', 'moduleCatalogueId': 'MC'}]
        self.assertEqual(choose_originals(candidates, ['MA'], 'MB'), [('A', 'MA')])
        self.assertEqual(choose_originals(candidates, ['MA', 'MC'], 'MB'), [])
        self.assertEqual(choose_originals(candidates, ['MA', 'MB'], 'MB'), [])
        self.assertEqual(choose_originals(candidates, [], 'MB'), [])

    def test_saved_qr_creates_original_with_guest_source_even_if_original_is_future(self):
        profile = SimpleNamespace(id=10, enrolment_id=100, email='learner@example.invalid', full_name='Learner')
        source = SimpleNamespace(pk=100)
        occurrences = MagicMock()
        occurrence_manager = occurrences.objects.using.return_value
        guest_query, original_query = MagicMock(), MagicMock()
        guest_query.values.return_value = [{'id': 'B', 'live_session_id': 'SB', 'attendance_report_id': '', 'status': 'active'}]
        original_query.values.return_value = [{'id': 'A', 'live_session_id': 'SA'}]
        occurrence_manager.filter.side_effect = [guest_query, original_query]
        sessions = MagicMock()
        sessions.objects.using.return_value.filter.return_value.values_list.return_value = [('SB', 'MB')]
        register = MagicMock()
        manager = register.objects.using.return_value
        manager.filter.return_value.values.return_value = [{
            'learner_profile_id': 10, 'occurrence_id': 'B', 'module_catalogue_id': 'MB',
            'attendance_status': 'present', 'attendance_basis': 'qr', 'qr_attendance_id': 99,
            'teams_attendance_status': None, 'attendance_report_id': ''}]
        normal_query = manager.filter.return_value
        linked_query = MagicMock()
        linked_query.values.return_value = []
        manager.filter.side_effect = lambda **kwargs: linked_query if 'parallel_source_occurrence_id__in' in kwargs else normal_query
        manager.filter.return_value.exclude.return_value.exists.return_value = False
        manager.select_for_update.return_value.filter.return_value.first.return_value = None
        raw = MagicMock()
        raw.objects.using.return_value.filter.return_value.values.return_value = []
        profiles = MagicMock()
        profiles.objects.using.return_value.filter.return_value.only.return_value = [profile]
        enrolments = MagicMock()
        enrolments.all_learners.filter.return_value.only.return_value = [source]
        decisions = MagicMock()
        decisions.objects.using.return_value.filter.return_value.values.return_value = []
        with patch('curriculum_api.parallel_attendance_register.LiveSessionOccurrence', occurrences), \
             patch('curriculum_api.parallel_attendance_register.LiveSession', sessions), \
             patch('curriculum_api.parallel_attendance_register.LiveSessionLearnerAttendance', register), \
             patch('curriculum_api.parallel_attendance_register.LiveSessionAttendance', raw), \
             patch('curriculum_api.parallel_attendance_register.LearnerProfile', profiles), \
             patch('curriculum_api.parallel_attendance_register.EnrolmentUser', enrolments), \
             patch('coach_api.models.CoachAttendanceSourceAdjustment', decisions), \
             patch('curriculum_api.parallel_attendance_register.transaction.atomic', return_value=nullcontext()), \
             patch('curriculum_api.parallel_attendance_register.assigned_module_ids', return_value=['MA']), \
             patch('curriculum_api.parallel_attendance_register.equivalent_alternatives_by_occurrence',
                   return_value={'B': [{'id': 'A', 'moduleCatalogueId': 'MA'}]}):
            count = reconcile_parallel_attendance(['B'], database='default')
        self.assertEqual(count, 1)
        saved = manager.create.call_args.kwargs
        self.assertEqual((saved['occurrence_id'], saved['attendance_status'], saved['attendance_basis']),
                         ('A', 'present', 'parallel'))
        self.assertEqual((saved['parallel_source_occurrence_id'], saved['parallel_source_module_id']), ('B', 'MB'))
