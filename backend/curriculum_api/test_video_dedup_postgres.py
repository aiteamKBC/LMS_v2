"""Concurrent source claims, for a verified disposable PostgreSQL runner only."""
import io
import os
import threading
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from contextlib import nullcontext
from unittest import skipUnless
from unittest.mock import Mock, patch

from django.db import connection, connections
from django.test import SimpleTestCase

from . import video_dedup, video_imports as imports
from .models import CurriculumVideoImport, CurriculumVideoSource


@skipUnless(os.environ.get('VIDEO_DEDUP_POSTGRES_TESTS') == '1', 'requires verified disposable PostgreSQL')
class VideoDedupPostgresTests(SimpleTestCase):
    databases = {'default'}

    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.assertEqual(connection.settings_dict['HOST'], '127.0.0.1')
        self.assertTrue(connection.settings_dict['NAME'].startswith('lms_gate_'))
        CurriculumVideoSource.objects.all().delete()
        CurriculumVideoImport.objects.all().delete()

    def asset(self, ident, source):
        return imports.enqueue('module', ident, {
            'id': 'C-' + ident, 'title': 'Concurrent source', 'settings_json': {'videoUrl': source},
        }, {'programme_id': ident, 'programme_name': ident, 'group_id': ident})

    def test_parallel_workers_create_and_upload_one_copy(self):
        first = self.asset('A', 'https://www.youtube.com/watch?v=abcdefghijk')
        second = self.asset('B', 'https://youtu.be/abcdefghijk?si=tracking')
        barrier, release = threading.Barrier(2), threading.Event()
        entered = threading.local()
        original_owner = video_dedup.upload_owner
        remote_id = 'c1c2c3c4-1234-5678-abcd-123456789abc'
        bunny = Mock()
        bunny.find_import.return_value = None
        bunny.collection.return_value = 'collection'
        bunny.video.return_value = {'guid': remote_id, 'status': 4}

        def claim(*args, **kwargs):
            if not getattr(entered, 'value', False):
                entered.value = True
                barrier.wait(timeout=10)
            return original_owner(*args, **kwargs)

        def create(*args, **kwargs):
            self.assertFalse(connection.in_atomic_block, 'Network work must not hold a database transaction')
            if not release.wait(timeout=10):
                raise AssertionError('The other worker did not finish its pending request')
            return {'guid': remote_id}

        def process(ident):
            try:
                return imports.process(ident)
            finally:
                connections.close_all()

        bunny.create.side_effect = create
        mp4 = b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64
        with patch.object(video_dedup, 'upload_owner', side_effect=claim), \
             patch.object(imports, 'BunnyStream', return_value=bunny), \
             patch.object(imports, 'download_video', side_effect=lambda _: nullcontext(io.BytesIO(mp4))), \
             patch.object(imports, '_matches_current_source', return_value=True):
            with ThreadPoolExecutor(max_workers=2) as pool:
                jobs = [pool.submit(process, asset.pk) for asset in (first, second)]
                try:
                    done, pending = wait(jobs, timeout=8, return_when=FIRST_COMPLETED)
                    self.assertEqual(len(done), 1)
                    self.assertEqual(next(iter(done)).result().status, 'queued')
                finally:
                    release.set()
                results = [job.result(timeout=10) for job in jobs]
            # The pending alias now observes the completed owner.
            entered.value = True
            results = [imports.process(result.pk) for result in results]
        self.assertEqual({(r.status, r.video_id) for r in results}, {('ready', remote_id)})
        self.assertEqual(CurriculumVideoSource.objects.count(), 1)
        self.assertEqual(CurriculumVideoImport.objects.count(), 2)
        bunny.create.assert_called_once()
        bunny.upload.assert_called_once()
        bunny.metadata.assert_called_once()
        owner = CurriculumVideoSource.objects.get().owner_import_id
        self.assertEqual(bunny.create.call_args.args[0], owner)

    def test_concurrent_registry_claims_elect_one_owner(self):
        assets = [self.asset(str(i), 'https://youtu.be/abcdefghijk') for i in range(6)]
        barrier = threading.Barrier(len(assets))

        def claim(asset):
            try:
                barrier.wait(timeout=10)
                return video_dedup.upload_owner(asset).pk
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(assets)) as pool:
            owners = list(pool.map(claim, assets))
        self.assertEqual(len(set(owners)), 1)
        self.assertEqual(CurriculumVideoSource.objects.get().owner_import_id, owners[0])
