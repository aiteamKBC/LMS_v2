"""Actual PostgreSQL JSON selection and simultaneous leases; providers are mocked."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
import uuid
from unittest import skipUnless
from unittest.mock import patch

from django.db import close_old_connections, connection
from django.test import TransactionTestCase

from .models import CurriculumVideoImport
from . import recording_retry as retry, video_imports


@skipUnless(connection.vendor == 'postgresql', 'Requires a verified disposable PostgreSQL runner.')
class RecordingRetryPostgresTests(TransactionTestCase):
    databases = {'default'}

    def asset(self, **values):
        defaults = dict(target_kind='live_session', target_id='series', component_id=str(uuid.uuid4()),
                        fingerprint=uuid.uuid4().hex, title='Synthetic recording', source_url='https://graph.microsoft.com/synthetic',
                        source_at_start='https://graph.microsoft.com/synthetic', scope={}, status='failed',
                        video_id='11111111-2222-3333-4444-555555555555')
        return CurriculumVideoImport.objects.create(**{**defaults, **values})

    def test_postgres_selects_due_failure_before_limit_and_keeps_series_scope(self):
        self.asset(scope={'recording_retry': {'next_at': retry._stamp(retry.clock() + timedelta(hours=1)), 'failures': 8}})
        due = self.asset(target_id='selected')
        other = self.asset(target_id='other')
        with patch.object(video_imports, 'process') as process:
            self.assertEqual(retry.run_pending(limit=1, kinds=('live_session',), series_ids=['selected']), 1)
        process.assert_called_once_with(due.pk)
        other.refresh_from_db(); self.assertEqual(other.status, 'failed')

    def test_two_workers_can_only_transfer_the_same_recording_once(self):
        asset = self.asset()
        claimed, release = Event(), Event()

        def transfer(row, **kwargs):
            claimed.set()
            if not release.wait(timeout=15):
                raise RuntimeError('Synthetic worker did not release its transfer')
            row.status = 'ready'

        def process():
            close_old_connections()
            try:
                return video_imports.process(asset.pk).status
            finally:
                close_old_connections()

        with patch('curriculum_api.session_bunny.transfer_recording', side_effect=transfer) as move, \
                patch('curriculum_api.session_bunny.publish_outcome'), ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(process)
            try:
                self.assertTrue(claimed.wait(timeout=15))
                self.assertEqual(pool.submit(process).result(timeout=15), 'uploading')
            finally:
                release.set()
            self.assertEqual(first.result(timeout=15), 'ready')
        self.assertEqual(move.call_count, 1)
        asset.refresh_from_db()
        self.assertEqual(asset.status, 'ready')
        self.assertIsNone(asset.lease_until)
        self.assertEqual(asset.video_id, '11111111-2222-3333-4444-555555555555')
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_expired_process_lease_recovers_same_guid_after_restart(self):
        asset = self.asset(status='uploading', lease_until=retry.clock() - timedelta(seconds=1))
        def transfer(row, **kwargs): row.status = 'ready'
        with patch('curriculum_api.session_bunny.transfer_recording', side_effect=transfer), \
                patch('curriculum_api.session_bunny.publish_outcome'):
            self.assertEqual(retry.run_pending(kinds=('live_session',)), 1)
        asset.refresh_from_db()
        self.assertEqual(asset.status, 'ready')
        self.assertEqual(asset.video_id, '11111111-2222-3333-4444-555555555555')
        self.assertNotIn('recording_retry', asset.scope)
