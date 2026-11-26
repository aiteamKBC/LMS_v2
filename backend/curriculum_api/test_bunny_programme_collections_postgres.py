"""Real concurrent workers; only run through the verified local PostgreSQL gate."""
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from unittest.mock import Mock

from django.db import close_old_connections, connection

from .bunny_programme_collections import PENDING, programme_collection
from .bunny_stream import MissingProgrammeCollection, VideoImportError
from .models import CurriculumVideoImport

COLLECTION = 'c1c2c3c4-1234-5678-abcd-123456789abc'


@unittest.skipUnless(connection.vendor == 'postgresql', 'Requires the isolated PostgreSQL worker gate')
class ProgrammeCollectionRaceTests(unittest.TestCase):
    def setUp(self):
        # This unittest case deliberately uses committed rows, without Django's
        # per-test transaction or a broad fixture flush of unrelated tables.
        with connection.cursor() as cursor:
            cursor.execute('SELECT current_database(),host(inet_server_addr())')
            name, host = cursor.fetchone()
        if not name.startswith('test_lms_gate_') or host != '127.0.0.1':
            raise RuntimeError('Only the verified disposable loopback PostgreSQL test database is allowed.')
        self.scope = 'collection-race-' + uuid.uuid4().hex
        self.addCleanup(lambda: CurriculumVideoImport.objects.filter(target_id=self.scope).delete())

    def race(self, distinct_programme_ids=False):
        programme = 'P-' + uuid.uuid4().hex
        name = 'Synthetic programme ' + uuid.uuid4().hex
        assets = [CurriculumVideoImport.objects.create(target_kind='live_session', target_id=self.scope,
            component_id='COMP-' + str(index), fingerprint=uuid.uuid4().hex,
            scope={'programme_id': programme + (str(index) if distinct_programme_ids else ''),
                   'programme_name': name}) for index in range(2)]
        discovery = threading.Barrier(2)
        creating, release = threading.Event(), threading.Event()
        client = Mock()
        def missing(*args):
            discovery.wait(timeout=10)
            raise MissingProgrammeCollection('No collection yet')
        def create(*args):
            creating.set()
            if not release.wait(timeout=15):
                raise AssertionError('The parallel worker failed to complete')
            return COLLECTION
        client.collection.side_effect = missing
        client.create_programme_collection.side_effect = create
        def worker(asset_id):
            close_old_connections()
            try:
                return programme_collection(CurriculumVideoImport.objects.get(pk=asset_id), client)
            except VideoImportError as error:
                return str(error)
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(worker, asset.pk) for asset in assets]
            try:
                self.assertTrue(creating.wait(timeout=12))
                # A different DB connection sees the committed claim before POST
                # finishes. A process crash here therefore cannot lose the claim.
                saved = list(CurriculumVideoImport.objects.filter(target_id=self.scope))
                self.assertEqual(sum(bool(asset.scope.get(PENDING)) for asset in saved), 1)
                first = next(as_completed(futures, timeout=12))
                self.assertIn('awaiting confirmation', first.result())
            finally:
                release.set()
            outcomes = [future.result(timeout=15) for future in futures]
        self.assertEqual(outcomes.count(COLLECTION), 1)
        client.create_programme_collection.assert_called_once()
        for asset in assets:
            self.assertEqual(programme_collection(asset, client), COLLECTION)

    def test_parallel_recordings_create_one_committed_programme_destination(self):
        self.race()

    def test_same_name_on_two_programme_ids_still_creates_one_destination(self):
        self.race(distinct_programme_ids=True)
