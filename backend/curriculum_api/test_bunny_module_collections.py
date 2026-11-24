"""Synthetic module jobs and metadata-only moves; no external requests."""
import os
import uuid
from unittest.mock import Mock, patch

from django.test import TestCase

from . import bunny_module_collections as folders
from .bunny_stream import BunnyStream, MissingProgrammeCollection, VideoImportError, playback_url
from .models import CurriculumVideoImport

COLLECTION = 'a1a2a3a4-1234-5678-abcd-123456789abc'
VIDEO = 'c1c2c3c4-1234-5678-abcd-123456789abc'


class ModuleCollectionTests(TestCase):
    def setUp(self):
        env = patch.dict(os.environ, BUNNY_STREAM_ENABLED='true', BUNNY_STREAM_LIBRARY_ID='798153')
        env.start(); self.addCleanup(env.stop)
        self.client = Mock(library_id='798153')
        self.client.collection.side_effect = MissingProgrammeCollection('Missing')
        self.client.create_programme_collection.return_value = COLLECTION

    def job(self, module='M', title='Example module', **kwargs):
        return folders.queue_module({'module_catalogue_id': module, 'title': title, **kwargs}, wake=False)

    def test_save_queues_one_empty_container_without_creating_a_video_or_contacting_provider(self):
        with patch.object(folders, 'BunnyStream', side_effect=AssertionError('No network on save')):
            one, two = self.job(), self.job()
        self.assertEqual(one.pk, two.pk)
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        self.assertEqual((one.video_id, one.component_id, one.source_url), ('', '', ''))
        self.assertEqual(one.target_kind, folders.KIND)

    def test_save_wakes_worker_only_after_commit(self):
        with patch('curriculum_api.video_imports.wake_worker') as wake:
            with self.captureOnCommitCallbacks(execute=True):
                folders.queue_module({'module_catalogue_id': 'M', 'title': 'Module'})
                wake.assert_not_called()
            wake.assert_called_once()

    def test_authoring_module_save_hook_queues_once_and_other_tables_do_not(self):
        from .views import note_live_rows
        with patch('curriculum_api.module_live.note_rows'), patch('curriculum_api.content_cache.note_rows'), \
             patch('curriculum_api.video_imports.wake_worker') as wake:
            with self.captureOnCommitCallbacks(execute=True):
                row = {'module_catalogue_id': 'M', 'title': 'Example module'}
                note_live_rows('curriculum.modules', [row])
                note_live_rows('curriculum.modules', [row])
                note_live_rows('curriculum.components', [{'module_catalogue_id': 'OTHER'}])
            wake.assert_called_once()
        self.assertEqual(CurriculumVideoImport.objects.filter(target_kind=folders.KIND).count(), 1)

    def test_disabled_deleted_and_free_course_saves_do_not_queue(self):
        with patch.dict(os.environ, BUNNY_STREAM_ENABLED='false'):
            self.assertIsNone(self.job())
        for values in ({'deleted_at': '2026-01-01'}, {'is_programme_deleted': True}, {'source_type': 'free_course'}):
            self.assertIsNone(self.job(**values))
        self.assertEqual(CurriculumVideoImport.objects.count(), 0)

    def test_same_title_in_two_modules_has_separate_destinations(self):
        one, two = self.job('ONE'), self.job('TWO')
        self.assertNotEqual(one.pk, two.pk)
        self.assertNotEqual(one.scope['collection_name'], two.scope['collection_name'])
        self.assertTrue(one.scope['collection_name'].startswith('Example module [Module:'))
        folders.ensure_collection(one, self.client)
        folders.ensure_collection(two, self.client)
        self.assertEqual(self.client.create_programme_collection.call_count, 2)

    def test_existing_container_survives_title_change_without_new_collection(self):
        one = self.job()
        folders.ensure_collection(one, self.client)
        renamed = self.job(title='Renamed')
        self.assertEqual(folders.ensure_collection(renamed, self.client), COLLECTION)
        self.client.create_programme_collection.assert_called_once()

    def test_lost_create_response_and_concurrent_retry_never_create_a_second_folder(self):
        job = self.job()
        self.client.create_programme_collection.side_effect = VideoImportError('Bunny could not be reached.')
        with self.assertRaises(VideoImportError):
            folders.ensure_collection(job, self.client)
        with self.assertRaisesRegex(VideoImportError, 'awaiting confirmation'):
            folders.ensure_collection(job, self.client)
        self.client.collection.side_effect = None
        self.client.collection.return_value = COLLECTION
        self.assertEqual(folders.ensure_collection(job, self.client), COLLECTION)
        self.client.create_programme_collection.assert_called_once()
        self.assertNotIn(folders.PENDING, job.scope)

    def test_claim_is_visible_to_concurrent_creator(self):
        job = self.job()
        def create(*args):
            with self.assertRaisesRegex(VideoImportError, 'awaiting confirmation'):
                folders.ensure_collection(self.job(), self.client)
            return COLLECTION
        self.client.create_programme_collection.side_effect = create
        self.assertEqual(folders.ensure_collection(job, self.client), COLLECTION)
        self.client.create_programme_collection.assert_called_once()

    def test_rejected_create_can_be_retried_but_unavailable_discovery_cannot_create(self):
        job = self.job()
        self.client.collection.side_effect = VideoImportError('Unavailable')
        folders.process_collection(job, self.client)
        self.client.create_programme_collection.assert_not_called()
        self.assertEqual(job.status, 'queued')
        self.assertIsNotNone(job.lease_until)
        self.client.collection.side_effect = MissingProgrammeCollection('Missing')
        self.client.create_programme_collection.side_effect = VideoImportError('Forbidden', status_code=403)
        folders.process_collection(job, self.client)
        self.assertNotIn(folders.PENDING, job.scope)
        self.client.create_programme_collection.side_effect = None
        folders.process_collection(job, self.client)
        self.assertEqual((job.status, job.error, job.video_id), ('ready', '', ''))

    def test_container_process_never_requires_source_or_creates_a_video(self):
        from .video_imports import process
        job = self.job()
        with patch.object(folders, 'BunnyStream', return_value=self.client):
            result = process(job.pk)
        self.assertEqual((result.status, result.collection_id), ('ready', COLLECTION))
        self.client.create.assert_not_called()
        self.client.upload.assert_not_called()

    def test_wrong_library_refuses_provider_operations(self):
        self.client.library_id = '999'
        with self.assertRaisesRegex(VideoImportError, 'another library'):
            folders.ensure_collection(self.job(), self.client)
        self.client.collection.assert_not_called()

    def test_scheduled_recovery_processes_only_due_container_jobs(self):
        from datetime import timedelta
        from django.utils import timezone
        due, leased, ready = self.job('DUE'), self.job('LEASED'), self.job('READY')
        leased.lease_until = timezone.now() + timedelta(hours=1)
        leased.save()
        ready.collection_id, ready.status = COLLECTION, 'ready'
        ready.save()
        with patch.object(folders, 'capture_modules') as capture, \
             patch.object(folders, 'BunnyStream', return_value=self.client):
            self.assertEqual(folders.run_pending_collections(limit=5), 1)
        capture.assert_called_once_with(5)
        due.refresh_from_db(); leased.refresh_from_db()
        self.assertEqual(due.status, 'ready')
        self.assertEqual(leased.status, 'queued')
        self.client.create_programme_collection.assert_called_once()

    def test_existing_recording_keeps_all_identity_and_binding_fields_when_moved(self):
        scope = {'module_id': 'M', 'module_title': 'Example module', 'programme_id': 'P',
                 'occurrence_id': 'O', 'component_ids': 'COMP1,COMP2', 'week_ids': 'W',
                 'bunny_programme_collection_key': 'old programme'}
        asset = CurriculumVideoImport.objects.create(target_kind='live_session', target_id='SERIES',
            component_id='ARTIFACT', fingerprint=uuid.uuid4().hex, video_id=VIDEO, collection_id='OLD',
            scope=scope, status='ready', source_url='original', source_at_start='original')
        original = {key: getattr(asset, key) for key in ('pk', 'target_id', 'component_id', 'fingerprint',
                    'video_id', 'status', 'source_url', 'source_at_start')}
        url = playback_url(asset.library_id, asset.video_id)
        folders.recording_collection(asset, self.client)
        asset.refresh_from_db()
        self.assertEqual({key: getattr(asset, key) for key in original}, original)
        self.assertEqual(playback_url(asset.library_id, asset.video_id), url)
        for key in ('module_id', 'programme_id', 'occurrence_id', 'component_ids', 'week_ids'):
            self.assertEqual(asset.scope[key], scope[key])
        self.assertEqual(asset.collection_id, COLLECTION)
        self.client.move_to_collection.assert_called_once_with(VIDEO, COLLECTION)
        self.client.create.assert_not_called(); self.client.upload.assert_not_called()
        folders.recording_collection(asset, self.client)
        self.client.move_to_collection.assert_called_once()

    def test_move_failure_leaves_journal_and_component_binding_unchanged(self):
        asset = CurriculumVideoImport.objects.create(target_kind='live_session', target_id='S',
            component_id='A', fingerprint=uuid.uuid4().hex, video_id=VIDEO, collection_id='OLD',
            scope={'module_id': 'M', 'module_title': 'Module', 'component_ids': 'COMP'})
        self.client.move_to_collection.side_effect = VideoImportError('Not confirmed')
        with self.assertRaises(VideoImportError):
            folders.recording_collection(asset, self.client)
        asset.refresh_from_db()
        self.assertEqual(asset.collection_id, 'OLD')
        self.assertEqual(asset.scope, {'module_id': 'M', 'module_title': 'Module', 'component_ids': 'COMP'})


class InPlaceMoveTests(TestCase):
    def setUp(self):
        self.client = BunnyStream('798153', api_key='synthetic')
        self.before = {'guid': VIDEO, 'collectionId': 'OLD', 'status': 4, 'length': 123, 'storageSize': 456}

    def test_only_collection_metadata_is_posted_and_playback_identity_is_retained(self):
        after = {**self.before, 'collectionId': COLLECTION}
        with patch.object(self.client, 'request', side_effect=[self.before, {'success': True}, after]) as request:
            self.assertEqual(self.client.move_to_collection(VIDEO, COLLECTION), after)
        self.assertEqual(request.call_args_list[1].args, ('POST', '/videos/' + VIDEO))
        self.assertEqual(request.call_args_list[1].kwargs, {'json': {'collectionId': COLLECTION}})
        self.assertEqual(len(request.call_args_list), 3)

    def test_already_moved_retry_performs_only_reads(self):
        after = {**self.before, 'collectionId': COLLECTION}
        with patch.object(self.client, 'request', return_value=after) as request:
            self.client.move_to_collection(VIDEO, COLLECTION)
        self.assertTrue(all(call.args[0] == 'GET' for call in request.call_args_list))

    def test_wrong_guid_or_media_changes_refuse_success(self):
        for changed in ({'guid': 'OTHER'}, {'length': 999}, {'storageSize': 0}, {'status': 1}, {'collectionId': 'OLD'}):
            after = {**self.before, 'collectionId': COLLECTION, **changed}
            with self.subTest(changed=changed), patch.object(self.client, 'request', side_effect=[self.before, {}, after]):
                with self.assertRaises(VideoImportError):
                    self.client.move_to_collection(VIDEO, COLLECTION)
