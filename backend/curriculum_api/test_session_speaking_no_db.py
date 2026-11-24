"""Actual helper + worker control flow with explicit mocks; no settings/DB/network."""
import ast
from contextlib import nullcontext
import logging
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).parent


def helper_namespace():
    tree = ast.parse((ROOT / 'session_speaking.py').read_text(encoding='utf-8'))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    cursor = Mock()
    cursor.__enter__ = Mock(return_value=cursor)
    cursor.__exit__ = Mock(return_value=False)
    cursor.fetchone.return_value = (1, 1, 0)
    connection = SimpleNamespace(in_atomic_block=False, cursor=lambda: cursor)
    ns = {'connections': {'default': connection}, 'transaction': SimpleNamespace(atomic=lambda **_: nullcontext()),
          'log': logging.getLogger('speaking_test')}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(ROOT / 'session_speaking.py'), 'exec'), ns)
    return ns, cursor, connection


class SpeakingHelperTests(unittest.TestCase):
    def test_transaction_isolation_precedes_any_query_and_scope_is_preserved(self):
        ns, cursor, _ = helper_namespace()
        status = ns['process_pending_speaking'](limit=200, series_ids=[' S1 ', 'S1', 'S2'])
        self.assertEqual(status, {'processed': 1, 'completed': 1, 'retrying': 0})
        calls = cursor.execute.call_args_list
        self.assertEqual(calls[0].args, ('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',))
        self.assertEqual(calls[-1].args[1], [['S1', 'S2'], 100])
        self.assertNotIn('save_session_student_speaking(', calls[-1].args[0])

    def test_cannot_run_inside_caller_transaction(self):
        ns, cursor, connection = helper_namespace()
        connection.in_atomic_block = True
        with self.assertRaises(RuntimeError):
            ns['process_pending_speaking']()
        cursor.execute.assert_not_called()

    def test_database_failure_is_logged_without_private_exception_text(self):
        ns, cursor, _ = helper_namespace()
        cursor.execute.side_effect = RuntimeError('private learner and password')
        with self.assertLogs('speaking_test', level='WARNING') as logs:
            self.assertIsNone(ns['run_speaking_phase']())
        self.assertNotIn('private learner', ''.join(logs.output))
        self.assertIn('RuntimeError', ''.join(logs.output))

    def test_retry_count_is_visible(self):
        ns, cursor, _ = helper_namespace()
        cursor.fetchone.return_value = (2, 1, 1)
        with self.assertLogs('speaking_test', level='WARNING') as logs:
            status = ns['run_speaking_phase'](limit=2)
        self.assertEqual(status['retrying'], 1)
        self.assertIn('live_session_speaking_jobs', ''.join(logs.output))

    def test_missing_result_is_an_error_not_fabricated_success(self):
        ns, cursor, _ = helper_namespace()
        cursor.fetchone.return_value = None
        with self.assertRaises(RuntimeError):
            ns['process_pending_speaking']()


class SpeakingWorkerIntegrationTests(unittest.TestCase):
    def test_idle_worker_still_retries_speaking_without_running_graph_or_archive(self):
        # Reuse the existing framework-free worker fixture. No assertions from
        # that suite are removed or narrowed.
        from test_session_results_no_db import ArchiveWorkerTests
        fixture = ArchiveWorkerTests()
        fixture.setUp()
        try:
            command, ns, _ = fixture.worker(queued=False)
            speaking = ModuleType('curriculum_api.session_speaking')
            speaking.run_speaking_phase = Mock()
            with patch.dict(sys.modules, {'curriculum_api.session_speaking': speaking}):
                command.handle(limit=2, scheduled=False, provision_container=False, live_session_ids=[' S1 ', 'S1'])
            speaking.run_speaking_phase.assert_called_once_with(limit=2, series_ids=['S1'])
            ns['archive_series'].assert_not_called()
            fixture.views.curriculum_teams_meeting_artifacts.assert_not_called()
        finally:
            fixture.doCleanups()

    def test_speaking_failure_does_not_change_successful_sync_verdict(self):
        from test_session_results_no_db import ArchiveWorkerTests
        fixture = ArchiveWorkerTests()
        fixture.setUp()
        try:
            command, ns, cursor = fixture.worker()
            helper, helper_cursor, _ = helper_namespace()
            helper_cursor.execute.side_effect = RuntimeError('synthetic database unavailable')
            speaking = ModuleType('curriculum_api.session_speaking')
            speaking.run_speaking_phase = helper['run_speaking_phase']
            with patch.dict(sys.modules, {'curriculum_api.session_speaking': speaking}), self.assertLogs('speaking_test', level='WARNING'):
                command.handle(limit=2, scheduled=False, provision_container=False)
            finish = next(call for call in cursor.execute.call_args_list if 'finished_at=now()' in call.args[0])
            self.assertEqual(finish.args[1][:2], ['complete', ''])
            ns['archive_series'].assert_called_once()
        finally:
            fixture.doCleanups()


if __name__ == '__main__':
    with patch('socket.socket', side_effect=AssertionError('Network forbidden')):
        unittest.main(verbosity=2)
