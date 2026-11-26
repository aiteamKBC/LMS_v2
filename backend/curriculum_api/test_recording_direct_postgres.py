"""Actual PostgreSQL locks/unique claims; isolated database and provider doubles only."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
import unittest
import uuid
from unittest.mock import Mock, patch

from django.db import connection, connections

from .bunny_stream import MissingProgrammeCollection, VideoImportError
from .models import CurriculumVideoImport
from . import recording_direct_fetch as direct
from . import video_imports
from coach_api import recordings_bunny as coaches


@unittest.skipUnless(connection.vendor == 'postgresql', 'Requires the verified disposable PostgreSQL runner.')
class DirectRecordingLockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not connection.settings_dict['NAME'].startswith('lms_gate_coaches_'):
            raise RuntimeError('A separately verified disposable coaching database is required.')
        with connection.schema_editor() as editor:
            editor.create_model(CurriculumVideoImport)

    @classmethod
    def tearDownClass(cls):
        with connection.schema_editor() as editor:
            editor.delete_model(CurriculumVideoImport)

    def setUp(self):
        CurriculumVideoImport.objects.all().delete()

    def asset(self):
        return CurriculumVideoImport.objects.create(fingerprint=uuid.uuid4().hex,
            target_kind='coach_recording', target_id='occurrence', component_id=uuid.uuid4().hex,
            source_url='https://graph.microsoft.com/synthetic/content',
            source_at_start='https://graph.microsoft.com/synthetic/content', library_id='999001',
            collection_id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            scope={'owner_email':'coach@example.invalid','event_key':'occurrence'})

    @staticmethod
    def threaded(function, *args):
        try:
            return function(*args)
        finally:
            connections.close_all()

    def test_simultaneous_graph_aliases_request_one_fetch(self):
        assets = [self.asset(), self.asset()]
        barrier = Barrier(2, timeout=10)
        def resolve(*_args):
            barrier.wait()
            return 'https://tenant.sharepoint.com/synthetic', {'drive':'drive','item':'item','version':'v1','size':1000000}
        client = Mock(library_id='999001')
        client.find_import.return_value = None
        with patch.object(direct, 'resolve_source', side_effect=resolve), \
                patch('coach_api.views.microsoft_graph_token', return_value='synthetic'), ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(self.threaded, direct.transfer_direct, asset, client, asset.source_url, {}) for asset in assets]
            for future in futures:
                self.assertIsNone(future.result(timeout=15))
        client.request.assert_called_once()
        self.assertEqual(CurriculumVideoImport.objects.filter(target_kind='recording_source').count(), 1)
        saved = list(CurriculumVideoImport.objects.filter(target_kind='coach_recording'))
        self.assertEqual(len({asset.scope['direct_owner_import_id'] for asset in saved}), 1)
        self.assertEqual(sum(bool(asset.scope.get(direct.PENDING)) for asset in saved), 1)

    def test_normal_worker_lease_allows_only_one_transfer(self):
        asset = self.asset()
        entered, release = Event(), Event()
        def transfer(current):
            entered.set()
            if not release.wait(10):
                raise RuntimeError('Test owner was not released.')
            current.status = 'processing'
        with patch.object(coaches, 'transfer', side_effect=transfer) as perform, \
                patch.object(coaches, 'publish'), ThreadPoolExecutor(2) as pool:
            first = pool.submit(self.threaded, video_imports.process, asset.pk)
            try:
                self.assertTrue(entered.wait(10))
                second = pool.submit(self.threaded, video_imports.process, asset.pk)
                self.assertEqual(second.result(timeout=10).status, 'uploading')
            finally:
                release.set()
            self.assertEqual(first.result(timeout=10).status, 'processing')
        perform.assert_called_once()
        asset.refresh_from_db()
        self.assertIsNone(asset.lease_until)

    def test_concurrent_collection_provisioning_creates_one_destination(self):
        row = CurriculumVideoImport.objects.create(fingerprint=uuid.uuid4().hex,
            target_kind=coaches.COLLECTION_KIND, target_id='coach-identity', component_id='',
            library_id='999001', scope={'collection_name':'Synthetic Coach [Coach:identity]'})
        barrier = Barrier(2, timeout=10)
        def missing(*_args):
            barrier.wait()
            raise MissingProgrammeCollection('missing')
        client = Mock(library_id='999001')
        client.collection.side_effect = missing
        client.create_programme_collection.return_value = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
        def ensure():
            try:
                current = CurriculumVideoImport.objects.get(pk=row.pk)
                return coaches.ensure_collection(current, client)
            except VideoImportError:
                return 'pending'
        with ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(self.threaded, ensure) for _ in range(2)]
            results = [future.result(timeout=15) for future in futures]
        client.create_programme_collection.assert_called_once()
        row.refresh_from_db()
        self.assertIn(row.collection_id, results)
        self.assertEqual(coaches.ensure_collection(row, client), row.collection_id)
