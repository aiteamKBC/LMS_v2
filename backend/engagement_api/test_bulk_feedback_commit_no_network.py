"""Real commit/rollback on in-memory SQLite; attendance and integrations mocked.

Run through scripts/validate_feedback_attendance_commit.py with this module label.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import connections, transaction
from django.test import RequestFactory, SimpleTestCase

from curriculum_api import bulk_attendance_live_day as manual
from . import feedback_delivery as delivery


class BulkFeedbackCommitTests(SimpleTestCase):
    databases = {'enrolment'}

    def setUp(self):
        config = connections['enrolment'].settings_dict
        self.assertEqual((config['ENGINE'], config['NAME']), ('django.db.backends.sqlite3', ':memory:'))
        self.sync = self.enterContext(patch.object(delivery, 'sync_post_lecture_feedback_from_attendance'))

    def test_bulk_opt_in_runs_only_after_commit_with_a_snapshot_of_occurrence_ids(self):
        ids = [' O1 ', 'O1']
        with transaction.atomic(using='enrolment'):
            delivery.reconcile_feedback_after_attendance_commit(ids, using='enrolment', use_learner_profiles=True)
            ids.append('UNRELATED')
            self.sync.assert_not_called()
        self.sync.assert_called_once_with(occurrence_ids=['O1'], use_learner_profiles=True)

    def test_rollback_does_not_update_feedback(self):
        with self.assertRaisesRegex(RuntimeError, 'rollback'):
            with transaction.atomic(using='enrolment'):
                delivery.reconcile_feedback_after_attendance_commit(['O1'], using='enrolment', use_learner_profiles=True)
                raise RuntimeError('rollback')
        self.sync.assert_not_called()

    def test_default_teams_call_retains_its_existing_identity_path(self):
        with transaction.atomic(using='enrolment'):
            delivery.reconcile_feedback_after_attendance_commit(['O1'], using='enrolment')
            self.sync.assert_not_called()
        self.sync.assert_called_once_with(occurrence_ids=['O1'])

    def test_bulk_request_saves_before_feedback_and_feedback_failure_does_not_undo_attendance(self):
        self.enterContext(patch.object(manual.router, 'db_for_write', return_value='enrolment'))
        self.enterContext(patch.object(manual, 'profiles_for_kbc_ids', return_value=[
            SimpleNamespace(id=11, email='synthetic@example.test', full_name='Synthetic learner')]))
        self.enterContext(patch.object(manual, 'live_occurrence_for_date', return_value=(
            {'id': 'S1', 'module_catalogue_id': 'M1'}, {'id': 'O1'})))
        manager = self.enterContext(patch.object(manual.LiveSessionLearnerAttendance, 'objects'))
        manager.using.return_value.select_for_update.return_value.filter.return_value.values.return_value = []
        self.enterContext(patch.object(manual, 'connections', {'enrolment': MagicMock()}))
        writer = self.enterContext(patch.object(manual, 'upsert_live_session_register'))
        self.enterContext(patch('curriculum_api.parallel_attendance_register.reconcile_parallel_attendance'))
        self.sync.side_effect = RuntimeError('PRIVATE CONNECTION DETAILS')
        with self.assertLogs(delivery.logger, level='WARNING') as logs:
            with transaction.atomic(using='enrolment'):
                response = manual.bulk_attendance_live_day(RequestFactory().post('/synthetic/', {
                    'learnerIds': ['301'], 'moduleCatalogueId': 'M1', 'date': '2026-11-01',
                    'occurrenceId': 'O1', 'attendance': 'present',
                }, content_type='application/json'))
                self.assertEqual(response.status_code, 200)
                writer.assert_called_once()
                self.sync.assert_not_called()
        self.sync.assert_called_once_with(occurrence_ids=['O1'], use_learner_profiles=True)
        self.assertNotIn('PRIVATE CONNECTION DETAILS', ''.join(logs.output))
