"""Guard-specific continuation, writer tagging and migration safety (no database I/O)."""
import importlib
import json
from datetime import datetime
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.db import IntegrityError
from django.test import SimpleTestCase

from . import feedback_delivery, feedback_delivery_guard as guard
from .management.commands.sync_post_lecture_feedback import Command


def rejected_error(name=guard.CONSTRAINT_NAME, sqlstate='23514'):
    cause = Exception('PRIVATE DRIVER MESSAGE')
    cause.sqlstate = sqlstate
    cause.diag = SimpleNamespace(constraint_name=name, message_detail='{"form_id": 12}')
    error = IntegrityError('PRIVATE DRIVER MESSAGE')
    error.__cause__ = cause
    return error


class FeedbackDeliveryGuardTests(SimpleTestCase):
    def cursor(self):
        columns = ('occurrence_id', 'module_catalogue_id', 'module_title', 'programme_id',
                   'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name',
                   'session_number', 'scheduled_start', 'session_end', 'attendance_report_id',
                   'attendance_id', 'learner_name', 'attendance_status', 'learner_id')
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.description = [(name,) for name in columns]
        cursor.fetchall.return_value = [
            (key, 'MOD-1', 'Synthetic module', '', '', '', '', '', '', index,
             datetime(2026, 10, 27, 10 + index), datetime(2026, 10, 27, 12 + index),
             'PRIVATE-REPORT', index, 'PRIVATE LEARNER NAME', 'present', 8)
            for index, key in enumerate(('rejected@example.test', 'VALID-2'))
        ]
        return cursor

    def test_database_rejection_is_reported_and_next_occurrence_is_processed(self):
        success = {'deliveryIds': [24], 'formsMatched': 1, 'recipientsMatched': 1,
                   'recipientsRevoked': 0, 'missingLearnerIds': []}
        with (mock.patch.object(feedback_delivery, 'connection', SimpleNamespace(cursor=self.cursor)),
              mock.patch.object(feedback_delivery, 'sync_post_lecture_feedback',
                                side_effect=[rejected_error(), success]) as sync,
              self.assertLogs(guard.logger, level='WARNING') as logs):
            result = feedback_delivery.sync_post_lecture_feedback_from_attendance(occurrence_ids=['OLD', 'NEW'])
        self.assertEqual(sync.call_count, 2)
        self.assertEqual(result['occurrencesProcessed'], 2)
        self.assertEqual(result['creationGuardRejected'], 1)
        self.assertEqual(result['deliveryIds'], [24])
        self.assertEqual(result['formsMatched'], 1)
        self.assertEqual(result['recipientsMatched'], 1)
        payload = json.loads(logs.records[0].getMessage().split(' ', 1)[1])
        self.assertEqual(payload['form_id'], 12)
        self.assertEqual(payload['action'], 'database_rejected')
        self.assertTrue(payload['host'])
        self.assertGreater(payload['pid'], 0)
        self.assertEqual(len(payload['code']), 20)
        for private in ('PRIVATE', 'rejected@example.test'):
            self.assertNotIn(private, ''.join(logs.output))

    def test_unrelated_integrity_errors_propagate_and_are_not_reported_as_success(self):
        for error in (rejected_error('another_check'), rejected_error(sqlstate='23503'), IntegrityError('other')):
            with (self.subTest(error=type(error).__name__),
                  mock.patch.object(feedback_delivery, 'connection', SimpleNamespace(cursor=self.cursor)),
                  mock.patch.object(feedback_delivery, 'sync_post_lecture_feedback', side_effect=error) as sync):
                with self.assertRaises(IntegrityError):
                    feedback_delivery.sync_post_lecture_feedback_from_attendance()
                self.assertEqual(sync.call_count, 1)

    def test_only_numeric_form_id_is_read_from_database_error_details(self):
        for value in ('not json', '[]', '{"form_id": "secret"}', '{"form_id": true}'):
            error = rejected_error()
            error.__cause__.diag.message_detail = value
            self.assertIsNone(guard.rejected_form_id(error))
        self.assertEqual(guard.rejected_form_id(rejected_error()), 12)

    def test_writer_pid_is_evaluated_after_fork(self):
        with mock.patch.object(guard.os, 'getpid', side_effect=[100, 200]):
            first, second = guard.writer_context(), guard.writer_context()
        self.assertEqual((first['pid'], second['pid']), (100, 200))
        self.assertEqual(first['code'], second['code'])

    def test_postgres_tag_is_transaction_local_and_parameterized(self):
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        connection = SimpleNamespace(vendor='postgresql', cursor=mock.Mock(return_value=cursor))
        guard.tag_transaction(connection)
        sql, params = cursor.execute.call_args.args
        self.assertEqual(sql, "SELECT set_config('feedback.writer_context', %s, true)")
        self.assertEqual(set(json.loads(params[0])), {'host', 'pid', 'code'})

    def test_non_postgres_tag_does_not_open_connection(self):
        connection = SimpleNamespace(vendor='sqlite', cursor=mock.Mock())
        guard.tag_transaction(connection)
        connection.cursor.assert_not_called()

    def test_command_exposes_partial_rejection_count(self):
        result = {'occurrencesProcessed': 2, 'formsMatched': 1, 'recipientsMatched': 1,
                  'recipientsRevoked': 0, 'unmatchedPresentAttendees': 0, 'creationGuardRejected': 1}
        output = StringIO()
        with mock.patch('engagement_api.management.commands.sync_post_lecture_feedback.sync_post_lecture_feedback_from_attendance', return_value=result):
            Command(stdout=output).handle(live_session_ids=[], occurrence_ids=[])
        self.assertIn('1 rejected by lecture creation guard', output.getvalue())


class FeedbackCreationGuardMigrationTests(SimpleTestCase):
    migration = importlib.import_module('engagement_api.migrations.0007_feedback_lecture_creation_guard')

    def test_canonical_postgres_install_and_rollback_use_uncomposed_sql(self):
        editor = SimpleNamespace(connection=SimpleNamespace(vendor='postgresql', alias='default'), execute=mock.Mock())
        self.migration.install(None, editor)
        self.migration.uninstall(None, editor)
        self.assertEqual(editor.execute.call_args_list, [mock.call(self.migration.SQL, params=None), mock.call(self.migration.REVERSE_SQL, params=None)])

    def test_other_databases_are_rejected_and_sqlite_is_noop(self):
        for vendor, alias in (('postgresql', 'enrolment'), ('mysql', 'default'), ('sqlite', 'default')):
            editor = SimpleNamespace(connection=SimpleNamespace(vendor=vendor, alias=alias), execute=mock.Mock())
            if vendor == 'sqlite':
                self.migration.install(None, editor)
            else:
                with self.assertRaisesRegex(RuntimeError, 'canonical PostgreSQL'):
                    self.migration.install(None, editor)
            editor.execute.assert_not_called()

    def test_manual_sql_installs_the_same_guard(self):
        manual = (Path(__file__).resolve().parents[1] / 'sql/2026-10-27_feedback_lecture_creation_guard.sql').read_text(encoding='utf-8')
        self.assertEqual(manual.split('BEGIN;\n', 1)[1].split('\nCOMMIT;', 1)[0], self.migration.SQL)
