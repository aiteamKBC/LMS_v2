from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .shared_teams_attendance import apply_shared_attendance
from .attendance_rules import attendance_outcome


class SharedTeamsAttendanceTests(SimpleTestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 17, tzinfo=timezone.utc)
        self.learner = SimpleNamespace(id=7, email='learner@example.test')

    def row(self, **changes):
        return dict(source='microsoft-teams', session_id='O:ALIAS', occurrence_id='O:ALIAS',
                    attendance_source_occurrence_id='O', attendance_source_module_id='OWNER',
                    module_catalogue_id='ALIAS', live_session_id='S', attendance_report_id='R',
                    scheduled_end=self.now-timedelta(days=1), attendance_status='absent',
                    session_date=(self.now-timedelta(days=1)).date()) | changes

    def apply(self, rows, sessions):
        with patch('learner_api.shared_teams_attendance.timezone.now', return_value=self.now), \
             patch('curriculum_api.session_results.result_rows', return_value=sessions) as results:
            output = apply_shared_attendance(rows, self.learner)
        return output, results

    def test_reviewed_shared_presence_counts_once_without_changing_occurrence_identity(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.learner.learner_type = kind
                rows, reader = self.apply([self.row()], [{'id': 'O', 'reportReady': True,
                    'attendance': [{'email': self.learner.email, 'rawStatus': 'present', 'seconds': 7302}]}])
                self.assertEqual(attendance_outcome(rows[0], self.now), ('present', True))
                self.assertEqual(rows[0]['session_id'], 'O:ALIAS')
                self.assertEqual(rows[0]['attended_seconds'], 7302)
                reader.assert_called_once_with({'id': 'S', 'module_catalogue_id': 'OWNER'},
                    email=self.learner.email, module_catalogue_id='ALIAS', attendance_only=True)

    def test_missing_unfinished_and_other_learner_evidence_do_not_grant_attendance(self):
        for session in ({'id': 'O', 'reportReady': False, 'attendance': []},
                        {'id': 'O', 'reportReady': True, 'attendance': [{'email': 'other@example.test', 'status': 'present'}]},
                        {'id': 'OTHER', 'reportReady': True, 'attendance': []}):
            with self.subTest(session=session):
                row = self.row()
                output, _ = self.apply([row.copy()], [session])
                self.assertEqual(output, [row])

    def test_raw_absence_is_preserved_even_when_recovery_is_completed(self):
        output, _ = self.apply([self.row()], [{'id': 'O', 'reportReady': True, 'attendance': [
            {'email': self.learner.email, 'rawStatus': 'absent', 'status': 'present', 'seconds': 0}]}])
        self.assertEqual(attendance_outcome(output[0], self.now), ('absent', True))

    def test_future_non_shared_and_unsynced_rows_do_not_query_results(self):
        rows = [self.row(scheduled_end=self.now+timedelta(days=1)),
                self.row(attendance_source_module_id=None), self.row(attendance_report_id=None)]
        output, reader = self.apply(rows, [])
        reader.assert_not_called()
        self.assertEqual(output, rows)

    def test_lectures_share_one_read_but_different_deliveries_keep_separate_identity_rules(self):
        _, reader = self.apply([self.row(), self.row(session_id='O2:ALIAS'),
                               self.row(module_catalogue_id='OTHER')], [])
        self.assertEqual(reader.call_count, 2)
        self.assertEqual({call.kwargs['module_catalogue_id'] for call in reader.call_args_list}, {'ALIAS', 'OTHER'})
