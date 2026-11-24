"""Audit read windows do not authorize deletion of retained history."""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import quality
from system_audit import activity


class FakeCursor:
    def __init__(self, lock=True, batches=(0,)):
        self.lock = lock
        self.batches = list(batches)
        self.statements = []
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.statements.append((sql, params))
        if 'delete from' in sql:
            self.rowcount = self.batches.pop(0) if self.batches else 0

    def fetchone(self):
        return (self.lock,)


class RetentionTests(SimpleTestCase):
    def setUp(self):
        activity._PURGE.clear()
        self.addCleanup(activity._PURGE.clear)
        for name in ('activity_available', 'workspace_column_available'):
            patcher = mock.patch.object(activity, name, return_value=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        atomic = mock.patch.object(activity.transaction, 'atomic', return_value=mock.MagicMock())
        atomic.start()
        self.addCleanup(atomic.stop)

    def run_purge(self, cursor, vendor='postgresql'):
        connection = mock.Mock(vendor=vendor)
        connection.cursor.return_value = cursor
        with mock.patch.object(activity, 'connection', connection):
            return activity.purge_expired_activity()

    def test_the_audit_trail_reads_seven_days_outside_curriculum_studio(self):
        self.assertEqual(activity.RETENTION_DAYS, 7)
        self.assertEqual((activity.DEFAULT_WINDOW_DAYS, activity.MAX_WINDOW_DAYS), (7, 7))
        self.assertEqual((quality.DEFAULT_WINDOW_DAYS, quality.MAX_WINDOW_DAYS), (7, 7))
        self.assertEqual(quality.parse_bounded_int('30', 7, 1, quality.window_limit('learner')), 7)
        self.assertEqual(quality.parse_bounded_int('90', 7, 1, quality.window_limit('curriculum')), 90)

    def test_nothing_is_deleted_when_rows_cannot_be_told_apart_by_workspace(self):
        with mock.patch.object(activity, 'workspace_column_available', return_value=False):
            cursor = FakeCursor(batches=(5,))
            self.assertEqual(self.run_purge(cursor), 0)
            self.assertEqual(cursor.statements, [])

    def test_all_workspaces_retain_history_without_database_access(self):
        # The validated history contract supersedes automatic seven-day deletion.
        for workspace in ('curriculum', 'learner', 'coach', ''):
            with self.subTest(workspace=workspace):
                cursor = FakeCursor(batches=(5000, 5000, 10))
                self.assertEqual(self.run_purge(cursor), 0)
                self.assertEqual(cursor.statements, [])

    def test_repeated_recording_never_starts_a_purge(self):
        cursor = FakeCursor(batches=(5,))
        for _ in range(3):
            self.assertEqual(self.run_purge(cursor), 0)
        self.assertEqual(cursor.statements, [])
