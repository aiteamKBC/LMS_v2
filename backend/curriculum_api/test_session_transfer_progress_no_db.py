"""Progress, API and storage regressions. No Django setup, DB or network."""
import json
import logging
import threading
import types
import sys
import unittest
from unittest.mock import Mock, patch

from test_session_results_no_db import ROOT, functions
from curriculum_api import session_transfer_progress as progress


class TransferProgressTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start(); self.addCleanup(network.stop)
        persist = patch.object(progress, 'save_transfer_progress')
        self.persist = persist.start(); self.addCleanup(persist.stop)
        clock = patch.object(progress.time, 'monotonic', return_value=10)
        self.clock = clock.start(); self.addCleanup(clock.stop)
        self.reporter = progress.TransferProgress('S', 'A', 'lease-1')

    def test_throttles_chunks_but_publishes_phase_changes_and_final_counts(self):
        self.reporter.update('downloading', 0, 100)
        for value in range(1, 10):
            self.reporter.update('downloading', value, 100)
        self.assertEqual(self.persist.call_count, 1)
        self.clock.return_value = 15
        self.reporter.update('downloading', 50, 100)
        self.assertEqual(self.persist.call_count, 2)
        self.assertEqual(self.persist.call_args.args[3]['bytesTransferred'], 50)
        self.reporter.update('downloading', 100, 100, force=True)
        self.assertEqual(self.persist.call_count, 3)
        self.reporter.update('uploading', 0, 100)
        self.assertEqual(self.persist.call_args.args[3]['bytesTransferred'], 0)

    def test_out_of_order_upload_callbacks_never_move_backwards(self):
        self.reporter.uploaded(80, 100)
        self.clock.return_value = 20
        self.reporter.uploaded(40, 100)
        self.assertEqual(self.persist.call_args.args[3]['bytesTransferred'], 80)

    def test_unknown_or_inconsistent_size_stays_unknown(self):
        for total in (None, 'invalid', -1, 0, 1):
            self.reporter.update('downloading', 20, total, force=True)
            self.assertIsNone(self.persist.call_args.args[3]['totalBytes'])

    def test_no_owned_lease_means_no_telemetry_write(self):
        progress.TransferProgress('S', 'A', None).update('downloading', 10, 100)
        self.persist.assert_not_called()

    def test_upload_thread_connections_are_released_without_closing_owner_connection(self):
        self.reporter.update('downloading', 1, 100)
        self.assertFalse(self.persist.call_args.kwargs['close_connection'])
        with patch.object(progress.threading, 'current_thread', return_value=object()):
            self.reporter.uploaded(10, 100)
        self.assertTrue(self.persist.call_args.kwargs['close_connection'])

    def test_reporting_failure_does_not_abort_transfer_or_leak_error_content(self):
        self.persist.side_effect = RuntimeError('private signed URL')
        with self.assertLogs(progress.log, level=logging.WARNING) as logs:
            self.reporter.update('downloading', 4, 100)
        self.assertNotIn('private signed URL', ''.join(logs.output))


class ProgressPersistenceTests(unittest.TestCase):
    def test_updates_only_owned_series_artifact_and_current_worker_lease(self):
        cursor = Mock(); cursor.__enter__ = Mock(return_value=cursor); cursor.__exit__ = Mock(return_value=False)
        connection = Mock(); connection.cursor.return_value = cursor
        with patch.dict(sys.modules, {'django.db': types.SimpleNamespace(connections={'default': connection})}):
            progress.save_transfer_progress('S', 'A', 'lease-1', {'phase': 'uploading'}, close_connection=True)
        sql, values = cursor.execute.call_args.args
        self.assertIn('jsonb_set(coalesce(a.metadata::jsonb', sql)
        self.assertIn("j.state='running' AND j.lease_id=%s", sql)
        self.assertIn('a.id=%s', sql)
        self.assertIn('o.live_session_id=%s', sql)
        self.assertEqual(values[1:], ['A', 'S', 'lease-1'])
        self.assertEqual(json.loads(values[0])['leaseId'], 'lease-1')
        connection.close.assert_called_once()

    def test_progress_endpoint_scopes_series_and_never_exposes_private_metadata(self):
        rows = [{'live_session_id': 'S', 'session_number': 12, 'artifact_type': 'recording', 'status': 'pending',
                 'transfer': {'phase': 'downloading', 'bytesTransferred': 25, 'totalBytes': 100,
                              'updatedAt': '2026-09-17T12:00:00Z', 'leaseId': 'private', 'url': 'private'}},
                {'live_session_id': 'OTHER', 'session_number': 6, 'artifact_type': 'transcript', 'status': 'ready'}]
        ns = {'read': Mock(return_value=rows), 'summarize_transfers': progress.summarize_transfers}
        functions(ROOT/'session_results.py', {'add_sync_progress'}, ns)
        jobs = [{'live_session_id': 'S', 'state': 'running'}]
        ns['add_sync_progress'](jobs)
        sql, params = ns['read'].call_args.args
        self.assertEqual(params, [['S']])
        self.assertIn("->>'leaseId'=j.lease_id", sql)
        result = jobs[0]['progress']
        self.assertEqual((result['filesReady'], result['totalFiles']), (0, 1))
        self.assertEqual(result['transfer']['sessionNumber'], 12)
        self.assertNotIn('private', json.dumps(result))
        for state in ('queued', 'complete'):
            jobs[0]['state'] = state
            ns['add_sync_progress'](jobs)
            self.assertIsNone(jobs[0]['progress']['transfer'])

    def test_counts_partial_success_and_ignores_bad_or_ready_telemetry(self):
        rows = [{'status': 'ready', 'transfer': {'phase': 'downloading'}},
                {'status': 'failed', 'artifact_type': 'recording', 'session_number': 1,
                 'transfer': {'phase': 'uploading', 'bytesTransferred': 20, 'totalBytes': 100, 'updatedAt': '2026-09-17T12:00:00Z'}},
                {'status': 'pending', 'transfer': {'phase': 'downloading', 'updatedAt': 'invalid'}}]
        result = progress.summarize_transfers(rows)
        self.assertEqual((result['filesReady'], result['totalFiles']), (1, 3))
        self.assertEqual(result['transfer']['bytesTransferred'], 20)


class StorageCallbackTests(unittest.TestCase):
    def test_optional_progress_does_not_change_other_upload_callers(self):
        client = Mock()
        ns = {'_service_client': Mock(return_value=client), 'ContentSettings': lambda **kw: kw,
              'AZURE_UPLOAD_CONNECTION_TIMEOUT_SECONDS': 60, 'AZURE_UPLOAD_READ_TIMEOUT_SECONDS': 60}
        functions(ROOT.parent/'learner_api/evidence_storage.py', {'upload_blob'}, ns)
        upload = client.get_blob_client.return_value.upload_blob
        self.assertEqual(ns['upload_blob'](b'file', 'container', 'name', 'video/mp4'), 'name')
        self.assertNotIn('progress_hook', upload.call_args.kwargs)
        self.assertTrue(upload.call_args.kwargs['overwrite'])
        hook = Mock()
        ns['upload_blob'](b'file', 'container', 'name', 'video/mp4', overwrite=False, progress_hook=hook)
        self.assertIs(upload.call_args.kwargs['progress_hook'], hook)
        self.assertFalse(upload.call_args.kwargs['overwrite'])
        self.assertEqual(upload.call_args.kwargs['connection_timeout'], 60)


if __name__ == '__main__':
    unittest.main()
