"""The Audit Trail keeps seven days of page activity and deletes the rest."""
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

    def test_deletes_only_page_activity_older_than_seven_days(self):
        cursor = FakeCursor(batches=(3,))
        self.assertEqual(self.run_purge(cursor), 3)
        deletes = [(sql, params) for sql, params in cursor.statements if 'delete from' in sql]
        self.assertEqual(len(deletes), 1)
        sql, params = deletes[0]
        self.assertIn('activity_events', sql)
        self.assertNotIn('record_revisions', sql)
        self.assertIn('occurred_at < %s', sql)
        # Curriculum Studio's page activity is never deleted.
        self.assertIn("coalesce(workspace, '') not in", sql)
        self.assertEqual(params[1:], ['curriculum'])
        cutoff = params[0]
        now = activity.datetime.utcnow()
        self.assertAlmostEqual((now - cutoff).total_seconds(), 7 * 86400, delta=60)

    def test_a_large_backlog_is_deleted_in_bounded_batches(self):
        full = activity.PURGE_BATCH
        cursor = FakeCursor(batches=(full, full, 10))
        self.assertEqual(self.run_purge(cursor), full * 2 + 10)

    def test_runs_at_most_once_an_hour_per_process(self):
        self.run_purge(FakeCursor(batches=(1,)))
        second = FakeCursor(batches=(1,))
        self.assertEqual(self.run_purge(second), 0)
        self.assertEqual(second.statements, [])

    def test_another_process_holding_the_lock_is_left_to_it(self):
        cursor = FakeCursor(lock=False, batches=(5,))
        self.assertEqual(self.run_purge(cursor), 0)
        self.assertFalse(any('delete from' in sql for sql, _ in cursor.statements))

    def test_a_failed_purge_never_breaks_the_request(self):
        cursor = FakeCursor()
        cursor.execute = mock.Mock(side_effect=RuntimeError('database gone'))
        with self.assertLogs(activity.logger, level='WARNING'):
            self.assertEqual(self.run_purge(cursor), 0)
