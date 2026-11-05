"""Attendance commits notify feedback; no real attendance, mail or Graph calls.

Use scripts/validate_feedback_attendance_commit.py for isolated in-memory
transactions. ORM writes and attendance/reporting SQL are mocked.
"""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from django.db import DatabaseError, connections, transaction
from django.test import RequestFactory, SimpleTestCase

from curriculum_api import bulk_attendance_live_day as manual
from learner_api import teams_attendance as reporting
from . import feedback_delivery


class AttendanceCommitTests(SimpleTestCase):
    databases = {'default', 'enrolment'}

    def setUp(self):
        # This test exercises real commit/rollback, never an external database.
        for alias in self.databases:
            config = connections[alias].settings_dict
            self.assertEqual(config['ENGINE'], 'django.db.backends.sqlite3')
            self.assertEqual(config['NAME'], ':memory:')
        self.now = datetime(2026, 10, 28, 14, tzinfo=timezone.utc)
        self.row = {
            'learner_id': 7, 'learner_profile_id': 7, 'enrolment_id': 17,
            'learner_name': 'Synthetic learner', 'learner_email': 'learner@example.test',
            'session_id': 'OCC-1', 'occurrence_id': 'OCC-1', 'live_session_id': 'SERIES-1',
            'session_title': 'Synthetic lecture', 'session_type': 'live_session',
            'session_date': self.now.date(), 'session_start_time': self.now.time(),
            'session_end_time': self.now.time(), 'attendance_status': 'present',
            'minutes_late': 0, 'absence_reason': '', 'catchup_completed': False,
            'coach_name': '', 'module_title': 'Synthetic module', 'attended_seconds': 7200,
            'attendance_report_id': 'REPORT-1', 'module_catalogue_id': 'MOD-1',
            'group_id': 'GROUP-1', 'group_name': 'Synthetic group', 'is_expected': True,
            'eligibility_reason': 'module_assignment', 'source_record_id': 'ROW-1',
            'scheduled_start': self.now, 'scheduled_end': self.now,
            'actual_start': self.now, 'actual_end': self.now,
            'first_join_at': self.now, 'last_leave_at': self.now,
            'calculated_at': self.now, 'updated_at': self.now,
        }
        self.sync = self.enterContext(mock.patch.object(
            feedback_delivery, 'sync_post_lecture_feedback_from_attendance', return_value={}))

    def reporting_mocks(self, rows=None):
        connection = mock.MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        self.enterContext(mock.patch.object(reporting, 'connections', {'enrolment': connection}))
        self.enterContext(mock.patch.object(reporting.router, 'db_for_write', return_value='enrolment'))
        self.enterContext(mock.patch.object(reporting, 'fetch_verified_teams_attendance_rows',
                                           return_value=rows if rows is not None else [self.row]))
        self.enterContext(mock.patch.object(reporting, '_verified_occurrence_ids', return_value=['OCC-1']))
        self.enterContext(mock.patch.object(reporting, '_award_attendance_points'))
        return cursor

    def manual_mocks(self):
        self.enterContext(mock.patch.object(manual.router, 'db_for_write', return_value='enrolment'))
        self.enterContext(mock.patch.object(manual, 'profiles_for_kbc_ids', return_value=[
            SimpleNamespace(id=7, email='learner@example.test', full_name='Synthetic learner')]))
        self.enterContext(mock.patch.object(manual, 'live_occurrence_for_date', return_value=(
            {'id': 'SERIES-1', 'module_catalogue_id': 'MOD-1'}, {'id': 'OCC-1'})))
        query = mock.MagicMock()
        query.select_for_update.return_value.filter.return_value.values.return_value = []
        self.enterContext(mock.patch.object(manual.LiveSessionLearnerAttendance.objects, 'using', return_value=query))
        self.enterContext(mock.patch.object(manual, 'connections', {'enrolment': mock.MagicMock()}))
        return self.enterContext(mock.patch.object(manual, 'upsert_live_session_register'))

    def manual_request(self):
        return RequestFactory().post('/synthetic/live-attendance/', data={
            'learnerIds': ['17'], 'moduleCatalogueId': 'MOD-1',
            'date': '2026-10-28', 'attendance': 'present', 'occurrenceId': 'OCC-1',
        }, content_type='application/json')

    def test_reporting_reconciles_feedback_after_attendance_commit_without_waiting_for_archive(self):
        self.reporting_mocks()
        with transaction.atomic(using='enrolment'):
            self.assertEqual(reporting.sync_verified_teams_attendance_reporting(module_refs=['MOD-1']), 1)
            self.sync.assert_not_called()
        self.sync.assert_called_once_with(occurrence_ids=['OCC-1'])

    def test_manual_attendance_reconciles_feedback_after_commit_on_the_write_database(self):
        writer = self.manual_mocks()
        with transaction.atomic(using='enrolment'):
            response = manual.bulk_attendance_live_day(self.manual_request())
            self.assertEqual(response.status_code, 200)
            writer.assert_called_once()
            self.sync.assert_not_called()
        self.sync.assert_called_once_with(occurrence_ids=['OCC-1'])

    def test_reporting_outer_rollback_never_assigns_feedback(self):
        self.reporting_mocks()
        with self.assertRaisesRegex(RuntimeError, 'rollback'):
            with transaction.atomic(using='enrolment'):
                reporting.sync_verified_teams_attendance_reporting(module_refs=['MOD-1'])
                raise RuntimeError('rollback')
        self.sync.assert_not_called()

    def test_manual_outer_rollback_never_assigns_feedback(self):
        self.manual_mocks()
        with self.assertRaisesRegex(RuntimeError, 'rollback'):
            with transaction.atomic(using='enrolment'):
                manual.bulk_attendance_live_day(self.manual_request())
                raise RuntimeError('rollback')
        self.sync.assert_not_called()

    def test_reporting_write_failure_never_assigns_feedback(self):
        cursor = self.reporting_mocks()
        cursor.executemany.side_effect = DatabaseError('Synthetic reporting write failure')
        with self.assertRaises(DatabaseError):
            reporting.sync_verified_teams_attendance_reporting(module_refs=['MOD-1'])
        self.sync.assert_not_called()

    def test_manual_write_failure_preserves_existing_error_contract(self):
        self.manual_mocks().side_effect = DatabaseError('Synthetic manual write failure')
        self.assertEqual(manual.bulk_attendance_live_day(self.manual_request()).status_code, 503)
        self.sync.assert_not_called()

    def test_shared_module_rows_trigger_one_full_occurrence_reconciliation(self):
        self.reporting_mocks([self.row, {**self.row, 'module_catalogue_id': 'MOD-SHARED'},
                              {**self.row, 'occurrence_id': 'OCC-2', 'session_id': 'OCC-2'}])
        self.assertEqual(reporting.sync_verified_teams_attendance_reporting(module_refs=['MOD-1']), 3)
        self.sync.assert_called_once_with(occurrence_ids=['OCC-1', 'OCC-2'])

    def test_attendance_correction_also_reconciles_an_absent_learner(self):
        self.reporting_mocks([{**self.row, 'attendance_status': 'absent', 'attended_seconds': 0}])
        reporting.sync_verified_teams_attendance_reporting(module_refs=['MOD-1'])
        self.sync.assert_called_once_with(occurrence_ids=['OCC-1'])

    def test_empty_register_write_does_not_request_unscoped_feedback_sync(self):
        self.reporting_mocks([])
        self.assertEqual(reporting.sync_verified_teams_attendance_reporting(module_refs=['MOD-1']), 0)
        self.sync.assert_not_called()

    def test_feedback_failure_does_not_report_saved_attendance_as_failed_or_log_private_error(self):
        self.reporting_mocks()
        self.sync.side_effect = RuntimeError('PRIVATE DATABASE MESSAGE')
        with self.assertLogs(feedback_delivery.__name__, level='WARNING') as captured:
            self.assertEqual(reporting.sync_verified_teams_attendance_reporting(module_refs=['MOD-1']), 1)
        self.assertIn('RuntimeError', captured.output[0])
        self.assertNotIn('PRIVATE DATABASE MESSAGE', '\n'.join(captured.output))

    def test_empty_commit_helper_never_expands_to_all_lectures(self):
        feedback_delivery.reconcile_feedback_after_attendance_commit([None, '', '  '], using='enrolment')
        self.sync.assert_not_called()

    def test_helper_snapshots_ids_and_deduplicates_before_commit(self):
        ids = [' OCC-1 ', 'OCC-1']
        with transaction.atomic(using='enrolment'):
            feedback_delivery.reconcile_feedback_after_attendance_commit(ids, using='enrolment')
            ids.append('UNRELATED')
            self.sync.assert_not_called()
        self.sync.assert_called_once_with(occurrence_ids=['OCC-1'])


class LateRecipientReconciliationTests(SimpleTestCase):
    databases = {'default', 'enrolment'}

    def test_late_shared_module_attendee_is_added_once_without_redrawing_or_replacing_answers(self):
        for alias in self.databases:
            self.assertEqual(connections[alias].settings_dict['ENGINE'], 'django.db.backends.sqlite3')
            self.assertEqual(connections[alias].settings_dict['NAME'], ':memory:')
        now = datetime(2026, 10, 28, 14, tzinfo=timezone.utc)
        form = SimpleNamespace(id=4, version=2, due_date=None,
                               created_at=datetime(2026, 10, 27, tzinfo=timezone.utc))
        delivery = SimpleNamespace(id=30, form=form, question_set_pinned=True)
        columns = ('occurrence_id', 'module_catalogue_id', 'module_title', 'programme_id',
                   'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name',
                   'session_number', 'scheduled_start', 'session_end', 'attendance_report_id',
                   'attendance_id', 'learner_name', 'attendance_status', 'learner_id')

        def row(account, module='MOD-1', status='present'):
            return ('OCC-1', module, 'Synthetic module', '', '', '', '', '', '',
                    4, now, now, 'REPORT-1', account or 99, 'Synthetic learner', status, account)

        cursor = mock.MagicMock()
        cursor.description = [(name,) for name in columns]
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [row(7)]
        existing = mock.Mock()
        existing.filter.return_value.first.return_value = delivery
        recipients = {'7': {'id': 10, 'revoked_at': None}}
        original = recipients['7']
        recipient_query = mock.Mock()

        def exclude(*, learner_id__in):
            def revoke(**values):
                changed = 0
                for identifier, record in recipients.items():
                    if identifier not in learner_id__in and record['revoked_at'] is None:
                        record['revoked_at'] = values['revoked_at']
                        changed += 1
                return changed
            return SimpleNamespace(update=revoke)

        recipient_query.exclude.side_effect = exclude

        def assign(*, delivery, learner_id, defaults):
            created = learner_id not in recipients
            recipients.setdefault(learner_id, {'id': len(recipients) + 10}).update(defaults)
            return recipients[learner_id], created

        with (
            mock.patch.object(feedback_delivery, 'connection', SimpleNamespace(cursor=lambda: cursor)),
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'select_related', return_value=existing),
            mock.patch.object(feedback_delivery.FeedbackDelivery.objects, 'update_or_create', return_value=(delivery, False)) as save_delivery,
            mock.patch.object(feedback_delivery.FeedbackForm.objects, 'filter') as new_template,
            mock.patch.object(feedback_delivery.EnrolmentUser.all_learners, 'filter', side_effect=lambda **kwargs: [
                SimpleNamespace(id=int(value), username='Synthetic learner', email='', programme='')
                for value in kwargs['id__in']]),
            mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'filter', return_value=recipient_query),
            mock.patch.object(feedback_delivery.FeedbackDeliveryRecipient.objects, 'update_or_create', side_effect=assign),
            mock.patch.object(feedback_delivery, '_pin_delivery_questions') as redraw,
            mock.patch.object(feedback_delivery.FeedbackResponse, 'objects') as responses,
        ):
            feedback_delivery.reconcile_feedback_after_attendance_commit(['OCC-1'], using='enrolment')
            self.assertEqual(set(recipients), {'7'})
            # A newly saved shared-module attendee joins; another account is
            # absent, one email is unmatched, and account 7 occurs in both modules.
            cursor.fetchall.return_value = [row(7), row(7, 'MOD-SHARED'), row(8, 'MOD-SHARED'),
                                           row(9, status='absent'), row(None)]
            for _ in range(2):
                with transaction.atomic(using='enrolment'):
                    feedback_delivery.reconcile_feedback_after_attendance_commit(['OCC-1'], using='enrolment')
                self.assertEqual(set(recipients), {'7', '8'})
                self.assertTrue(all(item['revoked_at'] is None for item in recipients.values()))
            self.assertIs(recipients['7'], original)
            self.assertEqual(recipients['7']['id'], 10)
            self.assertEqual(recipients['8']['id'], 11)
            for call in save_delivery.call_args_list:
                self.assertIs(call.kwargs['defaults']['form'], form)
                self.assertEqual(call.kwargs['defaults']['available_at'], now)
            new_template.assert_not_called()
            redraw.assert_not_called()
            self.assertEqual(responses.mock_calls, [])
            self.assertEqual(cursor.execute.call_args.args[1], [['OCC-1']])
