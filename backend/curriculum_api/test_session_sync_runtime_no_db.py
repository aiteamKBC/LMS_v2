"""Direct tests: no Django setup, real threads, database, Graph or Azure calls."""
import ast
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import MagicMock, Mock, patch
from datetime import datetime

ROOT = Path(__file__).parent


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        guard = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        guard.start(); self.addCleanup(guard.stop)
        spec = importlib.util.spec_from_file_location('session_runtime_under_test', ROOT / 'session_sync_runtime.py')
        self.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runtime)
        thread = patch.object(self.runtime.threading, 'Thread')
        self.thread = thread.start(); self.addCleanup(thread.stop)
        self.thread.return_value.is_alive.return_value = True
        self.settings = types.SimpleNamespace(CHAT_TEST_MODE=False, RUN_APP_ON_TEST_BRANCH=False)
        self.command = Mock()
        self.CommandError = type('CommandError', (Exception,), {})
        self.connections = Mock()
        self.close_old = Mock()
        self.cache = Mock()
        self.cache.add.return_value = True
        modules = patch.dict(sys.modules, {
            'django.conf': types.SimpleNamespace(settings=self.settings),
            'django.core.cache': types.SimpleNamespace(cache=self.cache),
            'django.core.management': types.SimpleNamespace(call_command=self.command),
            'django.core.management.base': types.SimpleNamespace(CommandError=self.CommandError),
            'django.db': types.SimpleNamespace(close_old_connections=self.close_old, connections=self.connections),
        })
        modules.start(); self.addCleanup(modules.stop)
        environment = patch.dict(os.environ, {}, clear=True)
        environment.start(); self.addCleanup(environment.stop)

    def test_import_does_not_start_scheduler_or_import_django(self):
        self.assertIsNone(self.runtime._automatic_thread)
        self.assertIsNone(self.runtime._review_thread)
        self.thread.assert_not_called()
        self.command.assert_not_called()

    def test_serving_process_starts_once_and_restarts_a_dead_thread(self):
        self.assertTrue(self.runtime.start_automatic_sync())
        self.assertTrue(self.runtime.start_automatic_sync())
        self.assertEqual(self.thread.call_count, 2)
        self.assertEqual(self.thread.return_value.start.call_count, 2)
        self.assertEqual({call.kwargs['name'] for call in self.thread.call_args_list},
                         {'session-results-auto', 'session-recording-review'})
        self.assertTrue(self.thread.call_args.kwargs['daemon'])
        self.thread.return_value.is_alive.return_value = False
        fresh = [Mock(), Mock()]
        for item in fresh:
            item.is_alive.return_value = True
        self.thread.side_effect = fresh
        self.assertTrue(self.runtime.start_automatic_sync())
        self.assertEqual(self.thread.call_count, 4)
        self.command.assert_not_called()

    def test_external_scheduler_opt_out_and_test_environments_do_not_start(self):
        with patch.dict(os.environ, {'SESSION_RESULTS_AUTOMATIC': 'false'}):
            self.assertFalse(self.runtime.start_automatic_sync())
        self.settings.CHAT_TEST_MODE = True
        self.assertFalse(self.runtime.start_automatic_sync())
        self.settings.CHAT_TEST_MODE = False
        self.settings.RUN_APP_ON_TEST_BRANCH = True
        self.assertFalse(self.runtime.start_automatic_sync())
        self.settings.RUN_APP_ON_TEST_BRANCH = False
        with patch.object(sys, 'argv', ['manage.py', 'test']):
            self.assertFalse(self.runtime.start_automatic_sync())
        self.thread.assert_not_called()

    def test_start_failure_can_retry_on_next_request(self):
        self.thread.return_value.start.side_effect = RuntimeError('No thread')
        with self.assertLogs(self.runtime.log, level='ERROR'):
            self.assertFalse(self.runtime.start_automatic_sync())
        self.assertIsNone(self.runtime._automatic_thread)
        self.thread.return_value.start.side_effect = None
        self.assertTrue(self.runtime.start_automatic_sync())

    def test_periodic_processing_keeps_running_without_any_browser_request(self):
        self.runtime._stop = Mock()
        self.runtime._stop.is_set.side_effect = [False, False, True]
        self.runtime._automatic_loop()
        self.assertEqual(self.command.call_count, 2)
        self.assertTrue(all(call.kwargs['scheduled'] for call in self.command.call_args_list))
        self.runtime._stop.wait.assert_called_with(60)

    def test_reviewer_runs_independently_every_five_minutes(self):
        self.runtime._stop = Mock()
        self.runtime._stop.wait.return_value = False
        self.runtime._stop.is_set.side_effect = [False, False, False, True]
        self.runtime.run_reviewer = Mock()
        self.runtime.run_worker = Mock()
        self.runtime._review_loop()
        self.assertEqual(self.runtime.run_reviewer.call_count, 3)
        self.runtime.run_worker.assert_not_called()
        self.runtime._stop.wait.assert_called_with(300)

    def test_reviewer_waits_before_first_head_and_stop_cancels_startup(self):
        self.runtime._stop = Mock()
        self.runtime._stop.wait.return_value = True
        self.runtime.run_reviewer = Mock()
        self.runtime._review_loop()
        self.runtime._stop.wait.assert_called_once_with(300)
        self.runtime.run_reviewer.assert_not_called()

    def test_review_slot_is_shared_between_serving_processes_and_expires(self):
        with patch.object(self.runtime.time, 'time', return_value=900):
            self.assertTrue(self.runtime._claim_review_slot())
            self.cache.add.return_value = False
            self.assertFalse(self.runtime._claim_review_slot())
        self.assertEqual(self.cache.add.call_args.args, ('session-recording-review:slot:3', 1))
        self.assertEqual(self.cache.add.call_args.kwargs, {'timeout': 600})

    def test_cache_failure_keeps_review_enabled_without_private_logging(self):
        self.cache.add.side_effect = RuntimeError('private endpoint')
        with self.assertLogs(self.runtime.log, level='WARNING') as logs:
            self.assertTrue(self.runtime._claim_review_slot())
        self.assertNotIn('private endpoint', '\n'.join(logs.output))

    def test_foreground_scope_cleans_up_on_view_failure(self):
        def app(*args):
            self.assertEqual(self.runtime._active_requests, 1)
            raise ValueError('synthetic')
        with self.assertRaises(ValueError):
            self.runtime.SessionSyncWSGI(app)({}, Mock())
        self.assertEqual(self.runtime._active_requests, 0)

    def test_reviewer_waits_for_current_views_without_blocking_new_views(self):
        self.runtime._active_requests = 1
        self.runtime._foreground = MagicMock()
        def idle(**kwargs):
            self.runtime._active_requests = 0
        self.runtime._foreground.wait.side_effect = idle
        self.assertTrue(self.runtime._wait_for_foreground())
        self.runtime._foreground.wait.assert_called_once_with(timeout=1)

    def test_continuous_traffic_cannot_starve_recording_review(self):
        self.runtime._active_requests = 1
        with patch.object(self.runtime.time, 'monotonic', side_effect=[0,31]):
            self.assertTrue(self.runtime._wait_for_foreground())

    def test_same_process_module_reload_retains_live_thread_handles(self):
        self.assertTrue(self.runtime.start_automatic_sync())
        reviewer, worker, stop = self.runtime._review_thread, self.runtime._automatic_thread, self.runtime._stop
        self.runtime._active_requests = 1
        self.runtime.__spec__.loader.exec_module(self.runtime)
        self.assertIs(self.runtime._review_thread, reviewer)
        self.assertIs(self.runtime._automatic_thread, worker)
        self.assertIs(self.runtime._stop, stop)
        self.assertEqual(self.runtime._active_requests, 1)
        self.assertTrue(self.runtime.start_automatic_sync())
        self.assertEqual(self.thread.call_count, 2)

    def test_reload_from_previous_runtime_initializes_new_foreground_state(self):
        self.assertTrue(self.runtime.start_automatic_sync())
        reviewer = self.runtime._review_thread
        del self.runtime._foreground
        del self.runtime._active_requests
        self.runtime.__spec__.loader.exec_module(self.runtime)
        self.assertIs(self.runtime._review_thread, reviewer)
        with self.runtime._foreground_request():
            self.assertEqual(self.runtime._active_requests, 1)
        self.assertEqual(self.runtime._active_requests, 0)

    def test_lost_periodic_claim_skips_head_but_keeps_next_pass(self):
        self.runtime._stop = Mock()
        self.runtime._stop.wait.return_value = False
        self.runtime._stop.is_set.side_effect = [False, False, True]
        self.cache.add.side_effect = [False, True]
        self.runtime.run_reviewer = Mock()
        self.runtime._review_loop()
        self.runtime.run_reviewer.assert_called_once_with()

    def test_saved_retry_outcome_is_distinct_from_a_worker_crash(self):
        error = self.CommandError('private Graph body')
        error.session_jobs_need_retry = True
        error.failed_jobs = 2
        self.command.side_effect = error
        with self.assertLogs(self.runtime.log, level='WARNING') as logs:
            self.runtime.run_worker(scheduled=True)
        self.assertIn('retry state for 2 jobs', '\n'.join(logs.output))
        self.assertNotIn('private Graph body', '\n'.join(logs.output))
        self.assertFalse(any('ERROR' in line for line in logs.output))
        self.connections.close_all.assert_called_once()

    def test_unexpected_command_error_still_reports_failure(self):
        self.command.side_effect = self.CommandError('private configuration')
        with self.assertLogs(self.runtime.log, level='ERROR') as logs:
            self.runtime.run_worker()
        self.assertIn('command failed (CommandError)', '\n'.join(logs.output))
        self.assertNotIn('private configuration', '\n'.join(logs.output))

    def test_first_request_is_marked_active_before_starting_automatic_threads(self):
        def start():
            self.assertEqual(self.runtime._active_requests, 1)
        with patch.object(self.runtime, 'start_automatic_sync', side_effect=start):
            self.runtime.SessionSyncWSGI(Mock(return_value=[]))({}, Mock())
        self.assertEqual(self.runtime._active_requests, 0)

    def test_automatic_worker_waits_for_foreground_before_graph_work(self):
        self.runtime._stop = Mock()
        self.runtime._stop.is_set.side_effect = [False, True]
        order = []
        self.runtime._wait_for_foreground = Mock(side_effect=lambda: order.append('wait') or True)
        self.runtime.run_worker = Mock(side_effect=lambda **kwargs: order.append('worker'))
        self.runtime._automatic_loop()
        self.assertEqual(order, ['wait','worker'])

    def test_reviewer_command_uses_the_separate_queue_check(self):
        self.runtime.run_reviewer()
        self.assertEqual(self.command.call_args.args, ('review_session_recordings',))
        self.connections.close_all.assert_called_once()

    def test_worker_logs_counts_without_transport_output(self):
        def command(*args, **kwargs):
            kwargs['stdout'].write('private transport detail\nProcessed 3 session jobs; 0 need retry.\n')
        self.command.side_effect = command
        with self.assertLogs(self.runtime.log, level='INFO') as logs:
            self.runtime.run_worker(scheduled=True)
        self.assertIn('Processed 3 session jobs; 0 need retry.', '\n'.join(logs.output))
        self.assertNotIn('private transport detail', '\n'.join(logs.output))
        self.connections.close_all.assert_called_once()

    def test_reviewer_logs_counts_even_when_checks_fail(self):
        def command(*args, **kwargs):
            kwargs['stdout'].write('Checked 4 saved recordings; 1 queued for repair; 2 need review.\n')
            raise self.CommandError('private storage detail')
        self.command.side_effect = command
        with self.assertLogs(self.runtime.log, level='INFO') as logs:
            self.runtime.run_reviewer()
        self.assertIn('Checked 4 saved recordings; 1 queued for repair; 2 need review.', '\n'.join(logs.output))
        self.assertNotIn('private storage detail', '\n'.join(logs.output))
        self.connections.close_all.assert_called_once()

    def test_summary_with_appended_private_text_is_not_logged(self):
        def command(*args, **kwargs):
            kwargs['stdout'].write('Processed 3 session jobs; 0 need retry. private detail\n')
        self.command.side_effect = command
        with patch.object(self.runtime.log, 'info') as info:
            self.runtime.run_worker()
        info.assert_not_called()

    def test_periodic_loop_recovers_from_worker_initialization_failure(self):
        self.runtime._stop = Mock()
        self.runtime._stop.is_set.side_effect = [False, False, True]
        self.runtime.run_worker = Mock(side_effect=[RuntimeError('private detail'), None])
        with self.assertLogs(self.runtime.log, level='ERROR') as logs:
            self.runtime._automatic_loop()
        self.assertEqual(self.runtime.run_worker.call_count, 2)
        self.assertNotIn('private detail', '\n'.join(logs.output))

    def test_reviewer_failure_does_not_stop_the_primary_worker(self):
        self.runtime._stop = Mock()
        self.runtime._stop.wait.return_value = False
        self.runtime._stop.is_set.side_effect = [False, True]
        self.runtime.run_reviewer = Mock(side_effect=RuntimeError('private detail'))
        self.runtime.run_worker = Mock()
        with self.assertLogs(self.runtime.log, level='ERROR') as logs:
            self.runtime._review_loop()
        self.runtime._stop.is_set.side_effect = [False, True]
        self.runtime._automatic_loop()
        self.runtime.run_worker.assert_called_once_with(scheduled=True)
        self.assertNotIn('private detail', '\n'.join(logs.output))

    def test_manual_sync_dispatch_is_immediate_targeted_and_coalesced(self):
        self.assertTrue(self.runtime.start_requested_sync('SERIES-12'))
        self.assertFalse(self.runtime.start_requested_sync('SERIES-12'))
        self.thread.return_value.start.assert_called_once()
        self.assertEqual(self.thread.call_args.kwargs['args'], ('SERIES-12',))
        self.runtime._manual_run('SERIES-12')
        self.assertEqual(self.command.call_args.args, ('process_session_results',))
        self.assertEqual(self.command.call_args.kwargs['live_session_ids'], ['SERIES-12'])
        self.assertEqual(self.command.call_args.kwargs['limit'], 1)
        self.assertFalse(self.command.call_args.kwargs['scheduled'])
        self.connections.close_all.assert_called_once()
        self.assertTrue(self.runtime.start_requested_sync('SERIES-12'))

    def test_busy_process_preserves_capacity_for_already_running_requests(self):
        self.runtime.start_requested_sync('S1')
        self.runtime.start_requested_sync('S2')
        self.assertFalse(self.runtime.start_requested_sync('S3'))
        self.assertEqual(self.thread.call_count, 2)
        self.assertEqual(self.runtime._manual_series, {'S1', 'S2'})

    def test_failed_manual_start_releases_slot_and_reports_failure(self):
        self.thread.return_value.start.side_effect = RuntimeError('No thread')
        with self.assertRaises(RuntimeError):
            self.runtime.start_requested_sync('S1')
        self.assertFalse(self.runtime._manual_series)

    def test_command_failure_logs_no_private_error_and_releases_connections_and_slot(self):
        self.runtime._manual_series.add('S1')
        self.command.side_effect = RuntimeError('synthetic-private-token')
        with self.assertLogs(self.runtime.log, level='ERROR') as logs:
            self.runtime._manual_run('S1')
        self.assertNotIn('synthetic-private-token', '\n'.join(logs.output))
        self.connections.close_all.assert_called_once()
        self.assertFalse(self.runtime._manual_series)

    def test_wsgi_wrapper_passes_through_response_without_waiting_for_sync(self):
        app = Mock(return_value=[b'saved-response'])
        environ, response = {}, Mock()
        self.assertEqual(self.runtime.SessionSyncWSGI(app)(environ, response), [b'saved-response'])
        app.assert_called_once_with(environ, response)
        self.assertEqual(self.thread.return_value.start.call_count, 2)
        self.command.assert_not_called()

    def test_asgi_wrapper_preserves_response_and_does_not_bootstrap_websockets(self):
        seen = []
        async def app(scope, receive, send):
            seen.append(scope['type'])
        # asyncio's selector uses a local socketpair; keep network blocked by
        # driving this coroutine directly (the stub app never suspends).
        wrapper = self.runtime.SessionSyncASGI(app)
        for kind in ('websocket', 'http'):
            coroutine = wrapper({'type': kind}, None, None)
            with self.assertRaises(StopIteration):
                coroutine.send(None)
            if kind == 'websocket':
                self.thread.assert_not_called()
        self.assertEqual(seen, ['websocket', 'http'])
        self.assertEqual(self.thread.return_value.start.call_count, 2)


class OccurrenceBindingTests(unittest.TestCase):
    def test_existing_week_and_resync_regressions_against_actual_resolver(self):
        # Execute the existing regression cases with the actual pure resolver,
        # excluding all Django imports, decorators, fixtures and schema setup.
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        names = {'clean_str', 'parse_graph_datetime', 'closest_live_occurrence', 'launch_linked_live_occurrence'}
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual(len(nodes), len(names))
        namespace = {'datetime': datetime}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<occurrence-resolver>', 'exec'), namespace)
        tests = ast.parse((ROOT / 'tests.py').read_text(encoding='utf-8-sig'))
        cls = next(node for node in tests.body if isinstance(node, ast.ClassDef) and node.name == 'TeamsAttendanceRosterTests')
        selected = {'test_join_launches_override_closest_scheduled_week', 'test_existing_report_launch_binding_wins_on_resync'}
        cls.body = [node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name in selected]
        self.assertEqual(len(cls.body), len(selected))
        test_namespace = {'SimpleTestCase': unittest.TestCase, 'datetime': datetime,
                          'views': types.SimpleNamespace(**namespace)}
        exec(compile(ast.Module(body=[cls], type_ignores=[]), '<existing-tracker-tests>', 'exec'), test_namespace)
        with patch('socket.socket', side_effect=AssertionError('Network forbidden')):
            for name in sorted(selected):
                with self.subTest(regression=name):
                    case = test_namespace['TeamsAttendanceRosterTests'](name)
                    getattr(case, name)()


if __name__ == '__main__':
    unittest.main(verbosity=2)
