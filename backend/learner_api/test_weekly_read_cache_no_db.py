"""Weekly read reuse never survives a request or changes reader-owned results."""
from contextvars import Context
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from .weekly_read_cache import reuse_weekly_read, weekly_read_scope


class WeeklyReadReuseTests(SimpleTestCase):
    def reader(self):
        calls = Mock(return_value=[{'nested': {'value': 1}}])

        @reuse_weekly_read
        def read(owner, modules=None, database='enrolment'):
            return calls(owner, modules, database)

        return read, calls

    def test_outside_weekly_projection_reads_remain_independent(self):
        read, calls = self.reader()
        read(1)
        read(1)
        self.assertEqual(calls.call_count, 2)

    def test_repeated_scoped_reads_share_io_but_not_mutable_results(self):
        read, calls = self.reader()
        with weekly_read_scope():
            first = read(1, ['M1'])
            first[0]['nested']['value'] = 99
            self.assertEqual(read(owner=1, modules=['M1']), [{'nested': {'value': 1}}])
        calls.assert_called_once_with(1, ['M1'], 'enrolment')

    def test_learners_modules_databases_and_source_instances_stay_separate(self):
        read, calls = self.reader()
        with weekly_read_scope():
            read(1, ['M1'])
            read(2, ['M1'])
            read(1, ['M2'])
            read(1, ['M1'], 'default')
            read(SimpleNamespace(pk=1), ['M1'])
            read(SimpleNamespace(pk=1), ['M1'])
        self.assertEqual(calls.call_count, 6)

    def test_exceptions_are_not_cached_and_scope_resets_after_failure(self):
        read, calls = self.reader()
        calls.side_effect = [ValueError('unavailable'), [], [], []]
        with weekly_read_scope():
            with self.assertRaises(ValueError):
                read(1)
            self.assertEqual(read(1), [])
        with self.assertRaises(RuntimeError), weekly_read_scope():
            read(1)
            raise RuntimeError('failed projection')
        read(1)
        self.assertEqual(calls.call_count, 4)

    def test_requests_and_nested_or_concurrent_contexts_do_not_share_caches(self):
        read, calls = self.reader()
        with weekly_read_scope():
            read(1)
            with weekly_read_scope():
                read(1)
            read(1)
            Context().run(read, 1)
        with weekly_read_scope():
            read(1)
        self.assertEqual(calls.call_count, 4)

    def test_sql_parameters_and_readers_are_distinct_and_writes_invalidate(self):
        calls = Mock(return_value=[])

        @reuse_weekly_read
        def read(sql, params=()):
            return calls(sql, params)

        with weekly_read_scope():
            read('SELECT value', [1])
            read('SELECT value', [1])
            read('SELECT value', [2])
            read('UPDATE values SET value=1')
            read('SELECT value', [1])
            read('SELECT value FOR UPDATE', [1])
            read('SELECT value FOR UPDATE', [1])
        self.assertEqual(calls.call_count, 6)

    def test_real_session_reader_runs_identical_select_once_in_a_projection(self):
        from curriculum_api import session_results
        cursor = Mock()
        cursor.description = [('value',)]
        cursor.fetchall.return_value = [(1,)]
        connection = Mock()
        connection.cursor.return_value.__enter__ = Mock(return_value=cursor)
        connection.cursor.return_value.__exit__ = Mock(return_value=False)
        with patch.object(session_results, 'connections', {'default': connection}), weekly_read_scope():
            result = session_results.read('SELECT value WHERE owner=%s', [1])
            result[0]['value'] = 9
            self.assertEqual(session_results.read('SELECT value WHERE owner=%s', [1]), [{'value': 1}])
        cursor.execute.assert_called_once_with('SELECT value WHERE owner=%s', [1])
