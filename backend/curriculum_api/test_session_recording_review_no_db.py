"""Reviewer recovery cases without a database, Azure account, or Teams calls."""

import ast
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
import logging
from pathlib import Path
import types
import unittest
from unittest.mock import Mock


ROOT = Path(__file__).parent


def reviewer_namespace():
    cursor = Mock()
    cursor.__enter__ = Mock(return_value=cursor)
    cursor.__exit__ = Mock(return_value=False)
    blob = Mock()
    client = Mock()
    client.get_blob_client.return_value = blob
    missing = type('ResourceNotFoundError', (Exception,), {})
    namespace = {
        'connections': {'default': types.SimpleNamespace(cursor=lambda: cursor)},
        'transaction': types.SimpleNamespace(atomic=nullcontext),
        'storage_client': Mock(return_value=client),
        'ResourceNotFoundError': missing,
        'datetime': datetime, 'timedelta': timedelta, 'timezone': timezone,
        'REVIEW_SECONDS': 300, 'REVIEW_BUCKETS': 12, 'log': Mock(),
    }
    tree = ast.parse((ROOT / 'session_recording_review.py').read_text(encoding='utf-8'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in {'queue_missing_recording', 'review_ready_recordings'}]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'reviewer', 'exec'), namespace)
    return namespace, cursor, client, blob, missing


class RecordingReviewerTests(unittest.TestCase):
    def setUp(self):
        self.ns, self.cursor, self.client, self.blob, self.missing = reviewer_namespace()
        self.now = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)
        self.cursor.fetchall.return_value = [('A', 'S', 'private', 'saved.mp4')]
        self.blob.get_blob_properties.return_value.size = 150
        self.ns['queue_missing_recording'] = Mock(return_value=True)

    def test_small_time_slice_checks_ready_recordings_without_requeueing_healthy_blobs(self):
        result = self.ns['review_ready_recordings'](now=self.now)
        self.assertEqual(result, {'checked': 1, 'queued': 0, 'errors': 0})
        sql, params = self.cursor.execute.call_args.args
        self.assertIn("r.status='ready' AND a.artifact_type='recording'", sql)
        self.assertIn('mod(hashtext(a.id)::bigint + 2147483648', sql)
        self.assertEqual(params[:2], [False, self.now - timedelta(hours=6)])
        self.blob.get_blob_properties.assert_called_once_with(logging_enable=False)
        self.ns['queue_missing_recording'].assert_not_called()

    def test_missing_azure_blob_queues_the_same_series_once(self):
        self.blob.get_blob_properties.side_effect = self.missing()
        result = self.ns['review_ready_recordings'](now=self.now)
        self.assertEqual(result, {'checked': 1, 'queued': 1, 'errors': 0})
        self.ns['queue_missing_recording'].assert_called_once_with('A', 'S', 'private', 'saved.mp4')

    def test_missing_archive_path_is_requeued_without_azure_request(self):
        self.cursor.fetchall.return_value = [('A', 'S', '', '')]
        result = self.ns['review_ready_recordings'](now=self.now)
        self.assertEqual(result['queued'], 1)
        self.client.get_blob_client.assert_not_called()

    def test_transient_storage_error_does_not_hide_a_ready_recording(self):
        self.blob.get_blob_properties.side_effect = RuntimeError('private storage detail')
        result = self.ns['review_ready_recordings'](now=self.now)
        self.assertEqual(result, {'checked': 1, 'queued': 0, 'errors': 1})
        self.ns['queue_missing_recording'].assert_not_called()
        self.assertNotIn('private storage detail', str(self.ns['log'].warning.call_args))

    def test_empty_existing_blob_is_queued_for_immutable_repair(self):
        self.blob.get_blob_properties.return_value.size = 0
        result = self.ns['review_ready_recordings'](now=self.now)
        self.assertEqual(result, {'checked': 1, 'queued': 1, 'errors': 0})
        self.ns['queue_missing_recording'].assert_called_once()

    def test_full_review_checks_all_ready_recordings(self):
        self.ns['review_ready_recordings'](now=self.now, full=True)
        self.assertTrue(self.cursor.execute.call_args.args[1][0])


class RecoveryQueueTests(unittest.TestCase):
    def setUp(self):
        self.ns, self.cursor, _, _, _ = reviewer_namespace()

    def test_queue_uses_the_shared_job_and_locks_archive_and_job(self):
        self.cursor.fetchone.return_value = ('ready', 'private', 'saved.mp4', 'complete')
        self.assertTrue(self.ns['queue_missing_recording']('A', 'S', 'private', 'saved.mp4'))
        queries = self.cursor.execute.call_args_list
        self.assertIn('ON CONFLICT(live_session_id) DO NOTHING', queries[0].args[0])
        self.assertIn('FOR UPDATE OF r,j SKIP LOCKED', queries[1].args[0])
        self.assertEqual(queries[1].args[1], ['A', 'S'])
        self.assertIn("SET status='failed'", queries[2].args[0])
        self.assertIn("SET state='queued'", queries[3].args[0])
        self.assertEqual(queries[3].args[1], ['S'])

    def test_running_worker_keeps_its_lease_and_is_not_requeued(self):
        self.cursor.fetchone.return_value = ('ready', 'private', 'saved.mp4', 'running')
        self.assertFalse(self.ns['queue_missing_recording']('A', 'S', 'private', 'saved.mp4'))
        self.assertEqual(self.cursor.execute.call_count, 2)

    def test_changed_or_locked_archive_is_not_overwritten(self):
        for row in (None, ('failed', 'private', 'saved.mp4', 'complete'),
                    ('ready', 'private', 'other.mp4', 'complete')):
            with self.subTest(row=row):
                self.cursor.reset_mock()
                self.cursor.fetchone.return_value = row
                self.assertFalse(self.ns['queue_missing_recording']('A', 'S', 'private', 'saved.mp4'))
                self.assertEqual(self.cursor.execute.call_count, 2)


if __name__ == '__main__':
    unittest.main()
