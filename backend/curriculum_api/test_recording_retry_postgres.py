"""Actual PostgreSQL JSON selection and simultaneous leases; providers are mocked."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
import os
import uuid
from unittest import skipUnless
from unittest.mock import Mock, patch

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

    def test_different_coaches_claim_one_physical_original_under_concurrency(self):
        self.assert_shared_fetch('different-coaches')

    def test_same_occurrence_aliases_still_claim_one_original_under_concurrency(self):
        self.assert_shared_fetch('same-occurrence')

    def test_tutor_and_coach_claim_one_original_across_libraries_under_concurrency(self):
        self.assert_shared_fetch('tutor-and-coach')

    def assert_shared_fetch(self, variant):
        from . import recording_direct_fetch as direct, shared_recordings as shared
        source = 'https://graph.microsoft.com/v1.0/users/owner/onlineMeetings/meeting/recordings/file/content'
        assets = [self.asset(target_kind='coach_recording', target_id='occurrence-'+str(index),
            source_url=source, source_at_start=source, library_id='999001',
            collection_id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', video_id='', status='queued',
            scope={'owner_email': f'coach{index}@example.invalid', 'event_key': 'event-'+str(index)}) for index in range(2)]
        if variant == 'same-occurrence':
            assets[1].scope = dict(assets[0].scope)
            assets[1].save(update_fields=['scope'])
        elif variant == 'tutor-and-coach':
            assets[1].target_kind, assets[1].library_id = 'live_session', '999002'
            assets[1].scope = {'module_id': 'module', 'series_id': 'series', 'occurrence_id': 'lecture',
                'programme_id': 'programme', 'cohort_id': 'cohort', 'group_id': 'group'}
            assets[1].save(update_fields=['target_kind', 'library_id', 'scope'])
        barrier = Barrier(2, timeout=15)
        def resolve(*args):
            barrier.wait()
            return 'https://tenant.sharepoint.com/synthetic', {'drive': 'drive', 'item': 'item', 'version': 'v1', 'size': 1000000}
        clients = {library: Mock(library_id=library) for library in ('999001', '999002')}
        for client in clients.values(): client.find_import.return_value = None
        def transfer(asset):
            close_old_connections()
            try: return direct.transfer_direct(asset, clients[asset.library_id], source, {})
            finally: close_old_connections()
        with patch.dict(os.environ, {'BUNNY_COACH_STREAM_LIBRARY_ID': '999001', 'BUNNY_LIVE_STREAM_LIBRARY_ID': '999002'}), \
                patch.object(direct, 'resolve_source', side_effect=resolve), \
                patch('curriculum_api.live_recording_routing.find_existing_recording', return_value=None), \
                patch('coach_api.views.microsoft_graph_token', return_value='synthetic'), ThreadPoolExecutor(2) as pool:
            outcomes = [pool.submit(transfer, asset) for asset in assets]
            for future in outcomes: self.assertIsNone(future.result(timeout=25))
        self.assertEqual(sum(client.request.call_count for client in clients.values()), 1)
        self.assertEqual(CurriculumVideoImport.objects.filter(target_kind=shared.KIND).count(), 1)
        saved = list(CurriculumVideoImport.objects.filter(target_kind__in=shared.KINDS))
        self.assertEqual(len({asset.scope[shared.OWNER] for asset in saved}), 1)
        self.assertEqual(sum(bool(asset.scope.get(direct.PENDING)) for asset in saved), 1)
