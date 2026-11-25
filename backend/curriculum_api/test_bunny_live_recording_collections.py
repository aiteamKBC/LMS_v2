"""Canonical recording ownership, metadata-only moves and bounded recovery."""
import copy
import os
import uuid
from unittest.mock import Mock, patch

from django.test import TestCase

from . import bunny_live_recording_collections as organizer
from .bunny_module_collections import queue_module
from .bunny_stream import VideoImportError
from .models import CurriculumVideoImport

VIDEO = 'c1c2c3c4-1234-5678-abcd-123456789abc'
SECOND = 'd1d2d3d4-1234-5678-abcd-123456789abc'
COLLECTION = 'a1a2a3a4-1234-5678-abcd-123456789abc'


class LiveRecordingCollectionTests(TestCase):
    def setUp(self):
        env = patch.dict(os.environ, BUNNY_STREAM_ENABLED='true', BUNNY_LIVE_STREAM_LIBRARY_ID='796471')
        env.start(); self.addCleanup(env.stop)
        self.client = Mock(library_id='796471')
        self.client.collection.return_value = COLLECTION
        self.owner = {'occurrence_id': 'OCC-ONE', 'series_id': 'SERIES',
                      'module_catalogue_id': 'MODULE', 'title': 'Canonical module'}
        owner = patch.object(organizer, '_owners', return_value={'OCC-ONE': self.owner})
        self.owners = owner.start(); self.addCleanup(owner.stop)

    def video(self, guid=VIDEO, **fields):
        return {'guid': guid, 'title': 'A different display title', 'status': 4, 'collectionId': '',
                'metaTags': [{'property': 'kbc_lms_occurrence_id', 'value': 'OCC-ONE'}], **fields}

    def scan(self):
        return CurriculumVideoImport.objects.get(target_kind=organizer.SCAN_KIND)

    def test_canonical_occurrence_selects_module_without_uploading_or_changing_playback(self):
        video = self.video()
        original = copy.deepcopy(video)
        self.client.request.return_value = {'items': [video]}
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 1)
        self.assertEqual(video, original)
        self.owners.assert_called_once_with({'OCC-ONE'})
        self.client.move_to_collection.assert_called_once_with(VIDEO, COLLECTION)
        job = CurriculumVideoImport.objects.get(target_kind='live_collection')
        self.assertEqual((job.target_id, job.library_id, job.video_id), ('MODULE', '796471', ''))
        self.assertEqual(job.scope['existing_recording_bindings'][VIDEO],
                         {'occurrence_id': 'OCC-ONE', 'series_id': 'SERIES'})
        self.client.create.assert_not_called(); self.client.upload.assert_not_called()
        self.client.rename.assert_not_called(); self.client.metadata.assert_not_called()

    def test_retry_sees_the_existing_folder_and_does_not_move_or_copy_again(self):
        video = self.video()
        self.client.request.return_value = {'items': [video]}
        self.client.move_to_collection.side_effect = lambda *args: video.update(collectionId=COLLECTION)
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 1)
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 0)
        self.client.move_to_collection.assert_called_once()
        self.client.collection.assert_called_once()
        self.assertEqual(CurriculumVideoImport.objects.filter(target_kind='live_collection').count(), 1)

    def test_multiple_recording_parts_share_the_module_but_keep_each_video_id(self):
        self.client.request.return_value = {'items': [self.video(), self.video(SECOND)]}
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 2)
        job = CurriculumVideoImport.objects.get(target_kind='live_collection')
        self.assertEqual(set(job.scope['existing_recording_bindings']), {VIDEO, SECOND})
        self.assertEqual(self.client.move_to_collection.call_count, 2)
        self.client.create.assert_not_called(); self.client.upload.assert_not_called()

    def test_unrecognized_occurrence_never_falls_back_to_the_video_title(self):
        self.owners.return_value = {}
        self.client.request.return_value = {'items': [self.video()]}
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 0)
        self.client.move_to_collection.assert_not_called()
        self.client.create_programme_collection.assert_not_called()
        self.assertFalse(CurriculumVideoImport.objects.filter(target_kind='live_collection').exists())

    def test_existing_operator_folders_and_inflight_uploads_are_retained(self):
        self.client.request.return_value = {'items': [
            self.video(collectionId='OPERATOR-FOLDER'), self.video(SECOND, status=2)]}
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 0)
        self.client.move_to_collection.assert_not_called()

    def test_conflicting_occurrence_tags_cannot_assign_a_recording(self):
        video = self.video()
        video['metaTags'].append({'property': 'kbc_lms_occurrence_id', 'value': 'OTHER'})
        self.client.request.return_value = {'items': [video]}
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 0)
        self.client.move_to_collection.assert_not_called()

    def test_an_archived_programme_does_not_create_new_destinations(self):
        self.owner['is_programme_deleted'] = True
        self.client.request.return_value = {'items': [self.video()]}
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 0)
        self.client.move_to_collection.assert_not_called()

    def test_provider_failure_keeps_the_same_video_and_retries_with_the_existing_job(self):
        self.client.request.return_value = {'items': [self.video()]}
        self.client.move_to_collection.side_effect = VideoImportError('Unavailable')
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 0)
        self.assertEqual(self.scan().scope['next_page'], 2)
        self.client.move_to_collection.side_effect = None
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 1)
        self.client.collection.assert_called_once()
        self.client.create.assert_not_called()

    def test_existing_component_and_week_binding_metadata_is_preserved(self):
        job = queue_module(self.owner, wake=False)
        job.collection_id, job.status = COLLECTION, 'ready'
        job.scope['existing_recording_bindings'] = {VIDEO: {'component_ids': ['COMP'], 'week_ids': ['WEEK']}}
        job.save()
        self.client.request.return_value = {'items': [self.video()]}
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 1)
        job.refresh_from_db()
        ref = job.scope['existing_recording_bindings'][VIDEO]
        self.assertEqual((ref['component_ids'], ref['week_ids']), (['COMP'], ['WEEK']))

    def test_paginated_recovery_also_checks_new_uploads_on_each_pass(self):
        filed = [self.video(str(uuid.uuid4()), collectionId=COLLECTION) for _ in range(100)]
        older = [*filed[:99], self.video()]
        newest = [*filed[:99], self.video(SECOND)]
        self.client.request.side_effect = [{'items': filed}, {'items': older}, {'items': newest}, {'items': []}]
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 1)
        self.assertEqual(self.scan().scope['next_page'], 3)
        self.assertEqual(organizer.organize_ready_recordings(client=self.client), 1)
        self.assertEqual([call.kwargs['params']['page'] for call in self.client.request.call_args_list], [1, 2, 1, 3])
        self.assertEqual(self.scan().scope['next_page'], 2)

    def test_a_page_over_budget_is_retained_until_remaining_records_are_processed(self):
        filed = [self.video(str(uuid.uuid4()), collectionId=COLLECTION) for _ in range(97)]
        waiting = [self.video(str(uuid.uuid4())) for _ in range(3)]
        page = [*filed, *waiting]
        self.client.request.side_effect = lambda *args, **kwargs: {'items': page if kwargs['params']['page'] == 1 else []}
        self.client.move_to_collection.side_effect = lambda guid, folder: next(v for v in waiting if v['guid'] == guid).update(collectionId=folder)
        for _ in range(3):
            self.assertEqual(organizer.organize_ready_recordings(limit=1, client=self.client), 1)
        self.assertEqual(self.client.move_to_collection.call_count, 3)
        self.assertTrue(all(v['collectionId'] == COLLECTION for v in waiting))

    def test_disabled_feature_does_not_contact_provider_or_create_scan_jobs(self):
        with patch.dict(os.environ, BUNNY_STREAM_ENABLED='false'):
            self.assertEqual(organizer.organize_ready_recordings(client=self.client), 0)
        self.client.request.assert_not_called()
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_malformed_provider_inventory_and_wrong_library_fail_before_moves(self):
        for items in (None, [{'guid': '../../other'}]):
            self.client.request.return_value = {'items': items}
            with self.assertRaises(VideoImportError):
                organizer.organize_ready_recordings(client=self.client)
        self.client.library_id = '798153'
        with self.assertRaises(VideoImportError):
            organizer.organize_ready_recordings(client=self.client)
        self.client.move_to_collection.assert_not_called()
