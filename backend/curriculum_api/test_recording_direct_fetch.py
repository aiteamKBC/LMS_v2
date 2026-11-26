"""Real queue writes in verified in-memory SQLite; every provider is doubled."""
from copy import deepcopy
import hashlib
import json
import os
import unittest
import uuid
from unittest.mock import Mock, patch

from django.conf import settings
from django.db import connection
from django.test import override_settings

from curriculum_api.bunny_stream import VideoImportError, MissingProgrammeCollection
from curriculum_api.models import CurriculumVideoImport
from curriculum_api import recording_direct_fetch as direct
from curriculum_api import live_recording_routing as routing
from curriculum_api import video_imports
from coach_api.models import CoachingRecordingJob
from coach_api import recordings_bunny as coach
from coach_api import recordings_jobs as jobs

OWNER = 'coach@example.invalid'
CONTEXT = {'owner': OWNER, 'event': 'calendar-event', 'start': '2026-11-26T10:00:00+00:00', 'end': '2026-11-26T11:00:00+00:00'}
SOURCE = 'https://graph.microsoft.com/v1.0/users/owner/onlineMeetings/meeting/recordings/file/content'
FILE = {'drive': 'drive', 'item': 'item', 'version': 'v1', 'size': 1000000}
VIDEO = '11111111-2222-3333-4444-555555555555'
COLLECTION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'


class DirectRecordingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert settings.COACH_TEST_MODE
        assert connection.vendor == 'sqlite' and connection.settings_dict['NAME'] == ':memory:'
        with connection.schema_editor() as editor:
            editor.create_model(CoachingRecordingJob)

    @classmethod
    def tearDownClass(cls):
        with connection.schema_editor() as editor:
            editor.delete_model(CoachingRecordingJob)

    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {'BUNNY_COACH_RECORDING_UPLOADS_ENABLED': 'true',
            'BUNNY_COACH_STREAM_LIBRARY_ID': '999001', 'BUNNY_COACH_STREAM_API_KEY': 'test-library-key',
            'BUNNY_COACH_STREAM_TOKEN_KEY': 'test-playback-key'}).start()
        self.addCleanup(CurriculumVideoImport.objects.all().delete)
        self.addCleanup(CoachingRecordingJob.objects.all().delete)
        self.client = Mock(library_id='999001')
        self.client.find_import.return_value = None
        self.client.video.return_value = self.video()
        self.client.move_to_collection.return_value = self.video()
        self.resolve = patch.object(direct, 'resolve_source', return_value=('https://tenant.sharepoint.com/file?temporary-secret', FILE)).start()
        patch('coach_api.views.microsoft_graph_token', return_value='tenant-secret').start()

    def video(self, **fields):
        return {'guid': VIDEO, 'status': 4, 'collectionId': COLLECTION, 'metaTags': [], 'availableResolutions': '720p', **fields}

    def asset(self, **fields):
        defaults = {'fingerprint': uuid.uuid4().hex, 'target_kind': coach.KIND,
            'target_id': 'occurrence', 'component_id': 'file', 'library_id': '999001',
            'collection_id': COLLECTION, 'source_url': SOURCE, 'source_at_start': SOURCE,
            'scope': {'owner_email': OWNER, 'event_key': 'occurrence'}}
        return CurriculumVideoImport.objects.create(**{**defaults, **fields})

    def job(self, **fields):
        defaults = {'key': 'evidence:test', 'kind': 'evidence', 'owner_email': OWNER, 'context': CONTEXT,
            'result': {'base': 'users/owner/onlineMeetings/meeting', 'artifacts': []}}
        return CoachingRecordingJob.objects.create(**{**defaults, **fields})

    def artifact(self, identity='file', **fields):
        return {'graph_artifact_id': identity, 'artifact_type': 'recording',
            'created_datetime': CONTEXT['start'], 'end_datetime': CONTEXT['end'], **fields}

    def test_cutoff_uses_meeting_start_in_business_zone_not_discovery_day(self):
        with override_settings(TIME_ZONE='Europe/London'):
            self.assertTrue(coach.eligible(CONTEXT))
            self.assertTrue(coach.eligible({**CONTEXT, 'start': '2026-11-26T00:00:00Z'}))
            self.assertFalse(coach.eligible({**CONTEXT, 'start': '2026-11-25T23:59:59Z'}))
            self.assertFalse(coach.eligible({**CONTEXT, 'start': 'invalid'}))
        with override_settings(TIME_ZONE='Africa/Cairo'):
            self.assertTrue(coach.eligible({**CONTEXT, 'start': '2026-11-25T22:00:00Z'}))

    def test_historical_and_disabled_jobs_are_untouched(self):
        job = self.job(context={**CONTEXT, 'start': '2026-11-25T10:00:00Z'})
        files = [self.artifact()]
        self.assertIs(coach.enqueue_evidence(job, files), files)
        with patch.dict(os.environ, {'BUNNY_COACH_RECORDING_UPLOADS_ENABLED': 'false'}):
            job.context = CONTEXT
            self.assertIs(coach.enqueue_evidence(job, files), files)
        self.assertEqual(CurriculumVideoImport.objects.count(), 0)

    def test_repeated_discovery_queues_one_import_per_actual_recording(self):
        job = self.job()
        first = coach.enqueue_evidence(job, [self.artifact()])
        second = coach.enqueue_evidence(job, [self.artifact()])
        self.assertEqual(first, second)
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        self.assertEqual(first[0]['lmsBunnyRecording']['state'], 'pending')
        job.result['artifacts'] = first
        self.assertEqual(jobs.source_summary(job)['state'], 'pending')
        coach.enqueue_evidence(job, [self.artifact('second-part')])
        self.assertEqual(CurriculumVideoImport.objects.count(), 2)

    def test_wrong_occurrence_cannot_enqueue_or_change_another_meeting(self):
        job = self.job()
        with self.assertRaises(VideoImportError):
            coach.enqueue_evidence(job, [self.artifact(created_datetime='2026-11-27T10:00:00Z', end_datetime='2026-11-27T11:00:00Z')])
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_each_coach_gets_one_collection_and_lost_create_does_not_repeat(self):
        row = coach.queue_coach({'email': OWNER, 'name': 'Coach One'})
        self.assertEqual(row.pk, coach.queue_coach({'email': OWNER, 'name': 'Changed name'}).pk)
        other = coach.queue_coach({'email': 'second@example.invalid', 'name': 'Coach One'})
        self.assertNotEqual(row.scope['collection_name'], other.scope['collection_name'])
        self.client.collection.side_effect = MissingProgrammeCollection('missing')
        self.client.create_programme_collection.side_effect = VideoImportError('timeout')
        for _ in range(2):
            with self.assertRaises(VideoImportError):
                coach.ensure_collection(row, self.client)
        self.client.create_programme_collection.assert_called_once()
        self.client.collection.side_effect = None
        self.client.collection.return_value = COLLECTION
        self.assertEqual(coach.ensure_collection(row, self.client), COLLECTION)
        self.assertEqual(coach.ensure_collection(row, self.client), COLLECTION)

    def test_lost_fetch_response_never_posts_twice_and_recovers_same_guid(self):
        asset = self.asset()
        self.client.request.side_effect = VideoImportError('timeout')
        with self.assertRaises(VideoImportError):
            direct.transfer_direct(asset, self.client, SOURCE, {})
        asset.refresh_from_db()
        self.assertIn(direct.PENDING, asset.scope)
        for _ in range(2):
            with self.assertRaises(VideoImportError):
                direct.transfer_direct(asset, self.client, SOURCE, {})
        self.client.request.assert_called_once()
        self.client.find_import.return_value = self.video()
        direct.transfer_direct(asset, self.client, SOURCE, {})
        self.assertEqual(asset.video_id, VIDEO)
        self.assertNotIn('temporary-secret', json.dumps(asset.scope))
        payload = self.client.request.call_args.kwargs['json']
        self.assertEqual(payload['headers'], {})
        self.assertNotIn('tenant-secret', json.dumps(payload))
        self.client.upload.assert_not_called()
        self.client.create.assert_not_called()

    def test_accepted_fetch_waits_for_search_and_alias_waits_for_same_owner(self):
        first, alias = self.asset(), self.asset()
        self.assertIsNone(direct.transfer_direct(first, self.client, SOURCE, {}))
        self.assertIsNone(direct.transfer_direct(alias, self.client, SOURCE, {}))
        self.client.request.assert_called_once()
        self.client.find_import.return_value = self.video()
        direct.transfer_direct(first, self.client, SOURCE, {})
        self.client.find_import.return_value = None
        direct.transfer_direct(alias, self.client, SOURCE, {})
        self.assertEqual(first.video_id, alias.video_id)
        self.client.request.assert_called_once()
        self.assertEqual(self.resolve.call_count, 2)

    def test_changed_file_version_is_blocked_before_second_post(self):
        first, alias = self.asset(), self.asset()
        direct.transfer_direct(first, self.client, SOURCE, {})
        self.resolve.return_value = ('https://tenant.sharepoint.com/another', {**FILE, 'version': 'v2'})
        with self.assertRaisesRegex(VideoImportError, 'source changed'):
            direct.transfer_direct(alias, self.client, SOURCE, {})
        self.client.request.assert_called_once()

    def test_failed_guid_is_retained_without_new_fetch_or_upload(self):
        asset = self.asset(video_id=VIDEO)
        self.client.video.return_value = self.video(status=6, storageSize=0, length=0)
        with self.assertRaises(VideoImportError):
            direct.transfer_direct(asset, self.client, SOURCE, {})
        asset.refresh_from_db()
        self.assertEqual(asset.video_id, VIDEO)
        self.client.request.assert_not_called()
        self.resolve.assert_not_called()

    def test_previous_create_intent_prevents_direct_duplicate(self):
        asset = self.asset(scope={'owner_email': OWNER, 'event_key': 'occurrence', 'live_video_create_pending': True})
        with self.assertRaises(VideoImportError):
            direct.transfer_direct(asset, self.client, SOURCE, {})
        self.client.request.assert_not_called()

    def test_source_claim_does_not_cross_coach_or_occurrence(self):
        first = self.asset()
        other = self.asset(scope={'owner_email': 'second@example.invalid', 'event_key': 'other-occurrence'})
        self.assertEqual(direct.source_owner(first, FILE).pk, first.pk)
        self.assertEqual(direct.source_owner(other, FILE).pk, other.pk)
        with self.assertRaises(VideoImportError):
            direct.source_owner(first, {'drive': 'drive', 'item': 'item'})

    def test_published_player_keeps_other_files_and_requires_matching_authorized_scope(self):
        job = self.job()
        files = coach.enqueue_evidence(job, [self.artifact(), self.artifact('other')])
        job.result['artifacts'] = files
        job.save()
        asset = CurriculumVideoImport.objects.get(pk=files[0]['lmsBunnyRecording']['importId'])
        asset.video_id, asset.collection_id, asset.status = VIDEO, COLLECTION, 'ready'
        asset.scope = {**asset.scope, 'playback_verified_video_id': VIDEO}
        asset.save()
        coach.publish(asset)
        job.refresh_from_db()
        self.assertEqual(job.result['artifacts'][1], files[1])
        self.assertEqual(jobs.source_summary(job)['readyCount'], 1)
        manifest = coach.playback(job, job.result['artifacts'][0])
        self.assertEqual(manifest['kind'], 'bunny')
        self.assertIn('token=', manifest['url'])
        changed = deepcopy(job.result['artifacts'][0])
        changed['graph_artifact_id'] = 'other'
        with self.assertRaises(VideoImportError):
            coach.playback(job, changed)

    def test_existing_lease_prevents_another_worker_transfer(self):
        from datetime import timedelta
        from django.utils import timezone
        asset = self.asset(lease_until=timezone.now()+timedelta(minutes=5))
        with patch.object(coach, 'transfer') as transfer:
            video_imports.process(asset.pk)
        transfer.assert_not_called()

    def test_missing_or_reused_library_cannot_upload_coaching_to_student_library(self):
        for library in ('', '796471', '798153', 'not-a-library'):
            with patch.dict(os.environ, {'BUNNY_COACH_STREAM_LIBRARY_ID': library}):
                with self.assertRaises(VideoImportError):
                    coach.library_id()

    def test_direct_file_alias_matches_only_same_live_occurrence_and_module(self):
        scope = {'occurrence_id': 'occurrence', 'module_id': 'module', 'series_id': 'series', 'direct_source_key': 'key'}
        video = self.video(metaTags=[{'property': 'lms.'+key, 'value': value} for key, value in scope.items()])
        self.assertTrue(routing.matches_source(video, scope))
        self.assertFalse(routing.matches_source(video, {**scope, 'module_id': 'other'}))
        self.assertFalse(routing.matches_source(video, {**scope, 'occurrence_id': 'other'}))
        self.assertFalse(routing.matches_source(video, {**scope, 'direct_source_key': 'other'}))

    def test_caption_failure_does_not_remove_ready_video_and_can_retry_late_transcript(self):
        job = self.job()
        files = coach.enqueue_evidence(job, [self.artifact()])
        job.result['artifacts'] = files
        job.save()
        asset = CurriculumVideoImport.objects.get(pk=files[0]['lmsBunnyRecording']['importId'])
        asset.video_id, asset.status = VIDEO, 'ready'
        asset.save()
        with patch('coach_api.recordings_transcripts.recording_captions', side_effect=ValueError):
            coach.refresh_captions(asset, client=self.client)
        asset.refresh_from_db()
        self.assertEqual(asset.status, 'ready')
        self.assertEqual(asset.scope['captions_state'], 'failed')
        with patch('coach_api.recordings_transcripts.recording_captions', return_value='WEBVTT\n\n'):
            coach.refresh_captions(asset, client=self.client)
        self.assertEqual(asset.scope['captions_state'], 'ready')
        self.client.caption.assert_called_once()

    def prepare_transfer(self):
        job = self.job()
        files = coach.enqueue_evidence(job, [self.artifact()])
        job.result['artifacts'] = files
        job.save()
        asset = CurriculumVideoImport.objects.get(pk=files[0]['lmsBunnyRecording']['importId'])
        event = {'id': CONTEXT['event'], 'start': {'dateTime': CONTEXT['start']},
                 'end': {'dateTime': CONTEXT['end']}, 'isCancelled': False}
        current = {'id': 'file', 'createdDateTime': CONTEXT['start'], 'endDateTime': CONTEXT['end']}
        self.graph = patch('coach_api.views.microsoft_graph_request', side_effect=[event, current]).start()
        patch('coach_api.recordings_api._coaches', return_value=[{'email': OWNER, 'name': 'Coach'}]).start()
        patch('coach_api.recordings_calendar_sync.graph_target', return_value=(job.result['base'], OWNER)).start()
        patch.object(coach, 'BunnyStream', return_value=self.client).start()
        patch.object(coach, 'ensure_collection', return_value=COLLECTION).start()
        patch('coach_api.recordings_transcripts.recording_captions', return_value=None).start()
        return job, asset

    def test_existing_worker_runs_full_discovery_transfer_and_publication_without_local_upload(self):
        job, asset = self.prepare_transfer()
        self.client.find_import.side_effect = [None, self.video()]
        outcome = video_imports.process(asset.pk)
        self.assertEqual(outcome.status, 'ready')
        asset.refresh_from_db(); job.refresh_from_db()
        self.assertIsNone(asset.lease_until)
        self.assertEqual(job.result['artifacts'][0]['lmsBunnyRecording']['videoId'], VIDEO)
        self.assertEqual(jobs.source_summary(job)['recordings'][0]['source'], 'bunny')
        self.client.verify_embed.assert_called_once()
        self.client.request.assert_called_once()
        self.client.upload.assert_not_called()
        self.client.create.assert_not_called()
        self.assertEqual(coach.playback(job, job.result['artifacts'][0])['videoId'], VIDEO)

    def test_changed_cancelled_or_foreign_source_never_publishes_or_fetches(self):
        for change in ('rescheduled', 'cancelled', 'foreign-recording'):
            with self.subTest(change=change):
                CurriculumVideoImport.objects.all().delete(); CoachingRecordingJob.objects.all().delete()
                job, asset = self.prepare_transfer()
                event = {'id': CONTEXT['event'], 'start': {'dateTime': CONTEXT['start']}, 'end': {'dateTime': CONTEXT['end']}}
                current = {'id': 'file', 'createdDateTime': CONTEXT['start'], 'endDateTime': CONTEXT['end']}
                if change == 'rescheduled': event['start']['dateTime'] = '2026-11-27T10:00:00Z'
                if change == 'cancelled': event['isCancelled'] = True
                if change == 'foreign-recording': current['id'] = 'foreign'
                self.graph.side_effect = [event, current]
                self.client.reset_mock()
                outcome = video_imports.process(asset.pk)
                self.assertEqual(outcome.status, 'failed')
                self.client.request.assert_not_called()
                self.client.verify_embed.assert_not_called()
                job.refresh_from_db()
                self.assertEqual(job.result['artifacts'][0]['lmsBunnyRecording']['state'], 'failed')

    def test_playback_security_failure_retains_guid_and_source_for_repair(self):
        job, asset = self.prepare_transfer()
        self.client.find_import.return_value = self.video()
        self.client.verify_embed.side_effect = VideoImportError('Invalid protection')
        outcome = video_imports.process(asset.pk)
        self.assertEqual(outcome.status, 'failed')
        self.assertEqual(outcome.video_id, VIDEO)
        self.assertEqual(outcome.source_at_start, SOURCE)
        job.refresh_from_db()
        with self.assertRaises(VideoImportError):
            coach.playback(job, job.result['artifacts'][0])

    def test_direct_source_uses_versioned_drive_identity_and_only_bounded_byte_probes(self):
        from curriculum_api import session_cloud_archive as archive
        metadata = {'id': 'file', 'name': 'Recording.mp4', 'file': {}, 'size': 2*archive.EDGE_BYTES,
                    'createdDateTime': CONTEXT['start'], 'parentReference': {'driveId': 'drive'},
                    'cTag': 'v1', '@microsoft.graph.downloadUrl': 'https://tenant.sharepoint.com/file?secret'}
        detail = Mock(return_value=metadata)
        with patch.object(archive, 'collection', return_value=[metadata]), \
                patch.object(archive, '_edges', return_value=(2*archive.EDGE_BYTES, b'first', b'last')) as probes:
            url, identity = archive.matched_recording_download({'created_datetime': CONTEXT['start']}, OWNER,
                SOURCE, 'token', graph_get=detail, graph_base='https://graph.microsoft.com/v1.0', include_identity=True)
        self.assertIn('secret', url)
        self.assertEqual(identity, {'drive': 'drive', 'item': 'file', 'version': 'v1', 'size': 2*archive.EDGE_BYTES})
        self.assertEqual(probes.call_count, 2)
        self.assertEqual(detail.call_count, 2)

    def test_direct_source_rejects_version_changes_and_incomplete_file_identity(self):
        from curriculum_api import session_cloud_archive as archive
        metadata = {'id': 'file', 'name': 'Recording.mp4', 'file': {}, 'size': 2*archive.EDGE_BYTES,
                    'createdDateTime': CONTEXT['start'], 'parentReference': {'driveId': 'drive'},
                    'cTag': 'v1', '@microsoft.graph.downloadUrl': 'https://tenant.sharepoint.com/file?secret'}
        for revised in ({**metadata, 'cTag': 'v2'}, {**metadata, 'parentReference': {}}, {**metadata, 'size': 1}):
            with self.subTest(revised=revised['size']), patch.object(archive, 'collection', return_value=[metadata]), \
                    patch.object(archive, '_edges', return_value=(2*archive.EDGE_BYTES, b'first', b'last')):
                detail = Mock(side_effect=[metadata, revised])
                with self.assertRaises(ValueError):
                    archive.matched_recording_download({'created_datetime': CONTEXT['start']}, OWNER,
                        SOURCE, 'token', graph_get=detail, graph_base='https://graph.microsoft.com/v1.0', include_identity=True)

    def test_verified_transcript_survives_caption_transport_failure_and_is_occurrence_bound(self):
        from coach_api.recordings_calendar_media import calendar_record
        job = self.job()
        files = coach.enqueue_evidence(job, [self.artifact()])
        job.result['artifacts'] = files; job.save()
        asset = CurriculumVideoImport.objects.get(pk=files[0]['lmsBunnyRecording']['importId'])
        asset.video_id = VIDEO; asset.save()
        self.client.caption.side_effect = VideoImportError('Caption API unavailable')
        text = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSynthetic transcript\n'
        with patch('coach_api.recordings_transcripts.recording_captions', return_value=text):
            coach.refresh_captions(asset, client=self.client)
        self.assertEqual(asset.scope['captions_state'], 'failed')
        record = calendar_record(CONTEXT)
        self.assertEqual(coach.saved_transcript(record, job)['content'], text)
        with self.assertRaises(ValueError):
            coach.saved_transcript(calendar_record({**CONTEXT, 'event': 'another-meeting'}), job)
        self.client.caption.side_effect = None
        with patch('coach_api.recordings_transcripts.recording_captions', side_effect=AssertionError('Use saved text')):
            coach.refresh_captions(asset, client=self.client)
        self.assertEqual(asset.scope['captions_state'], 'ready')

    def test_microsoft_retention_keeps_only_verified_bunny_artifacts_in_same_occurrence(self):
        job = self.job()
        files = coach.enqueue_evidence(job, [self.artifact()])
        job.result['artifacts'] = files; job.save()
        asset = CurriculumVideoImport.objects.get(pk=files[0]['lmsBunnyRecording']['importId'])
        asset.video_id, asset.status = VIDEO, 'ready'
        asset.scope = {**asset.scope, 'playback_verified_video_id': VIDEO}; asset.save()
        coach.publish(asset); job.refresh_from_db()
        retained = coach.retain_ready(job, [])
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0]['lmsBunnyRecording']['videoId'], VIDEO)
        self.assertFalse(retained[0]['sourceAvailable'])
        asset.scope['context'] = {**CONTEXT, 'event': 'another'}; asset.save()
        self.assertEqual(coach.retain_ready(job, []), [])

    def test_discovery_completion_cannot_overwrite_a_newer_video_publication(self):
        job = self.job(state='running', claim=uuid.uuid4())
        files = coach.enqueue_evidence(job, [self.artifact()])
        job.result['artifacts'] = files; job.save()
        stale = deepcopy(job.result)
        asset = CurriculumVideoImport.objects.get(pk=files[0]['lmsBunnyRecording']['importId'])
        asset.video_id, asset.status = VIDEO, 'ready'; asset.save()
        coach.publish(asset)
        jobs.complete(job, stale)
        job.refresh_from_db()
        self.assertEqual(job.result['artifacts'][0]['lmsBunnyRecording']['state'], 'ready')

    def test_coaching_multiple_or_oversized_resolutions_cannot_be_published(self):
        job, asset = self.prepare_transfer()
        self.client.find_import.return_value = self.video(availableResolutions='360p,720p,1080p')
        outcome = video_imports.process(asset.pk)
        self.assertEqual(outcome.status, 'failed')
        self.assertIn('one encoded resolution', outcome.error)
        self.client.verify_embed.assert_not_called()
