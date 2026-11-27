"""Real queue writes in verified in-memory SQLite; every provider is doubled."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
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


class DirectSourceIdentityTests(unittest.TestCase):
    def setUp(self):
        settings_patch = patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'})
        settings_patch.start()
        self.addCleanup(settings_patch.stop)
        channel_patch = patch('curriculum_api.recording_channel_source.matched_channel_recording', return_value=False)
        channel_patch.start()
        self.addCleanup(channel_patch.stop)

    def test_recording_owner_guid_resolves_drive_when_organizer_email_is_an_alias(self):
        owner = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb'
        source = SOURCE.replace('/owner/', '/' + owner + '/')
        with patch('curriculum_api.session_cloud_archive.matched_recording_download', return_value=('safe-url', FILE)) as match:
            self.assertEqual(direct.resolve_source(source, 'token', {'organizer_email': OWNER}), ('safe-url', FILE))
        self.assertEqual(match.call_args.args[1], owner)
        self.assertTrue(match.call_args.kwargs['include_identity'])

    def test_non_guid_owner_retains_existing_organizer_lookup(self):
        with patch('curriculum_api.session_cloud_archive.matched_recording_download', return_value=('safe-url', FILE)) as match:
            direct.resolve_source(SOURCE, 'token', {'organizer_email': OWNER})
        self.assertEqual(match.call_args.args[1], OWNER)

    def test_untrusted_authority_or_path_cannot_supply_a_drive_owner(self):
        owner = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb'
        valid = SOURCE.replace('/owner/', '/' + owner + '/')
        for source in (valid.replace('graph.microsoft.com', 'other.example.invalid'), valid + '?owner=override',
                       valid.replace('/recordings/', '/other/'), valid + '#fragment'):
            with self.subTest(source=source), patch('curriculum_api.session_cloud_archive.matched_recording_download', return_value=('safe-url', FILE)) as match:
                direct.resolve_source(source, 'token', {'organizer_email': OWNER})
                self.assertEqual(match.call_args.args[1], OWNER)

    def test_source_identity_failure_still_blocks_the_transfer(self):
        owner = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb'
        with patch('curriculum_api.session_cloud_archive.matched_recording_download', return_value=False):
            with self.assertRaisesRegex(VideoImportError, 'unique Microsoft file'):
                direct.resolve_source(SOURCE.replace('/owner/', '/' + owner + '/'), 'token', {'organizer_email': OWNER})


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

    def test_background_retry_recovers_accepted_fetch_without_another_video(self):
        from curriculum_api import recording_retry as retry
        job, asset = self.prepare_transfer()
        now = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)
        self.client.request.side_effect = TimeoutError('Provider response was lost')
        with patch.object(retry, 'clock', return_value=now):
            video_imports.process(asset.pk)
            asset.refresh_from_db()
            self.assertEqual(asset.status, 'failed')
            self.assertEqual(retry.run_pending(kinds=(coach.KIND,)), 0)
        self.client.request.assert_called_once()
        self.client.request.side_effect = None
        self.client.find_import.return_value = self.video()
        event = {'id': CONTEXT['event'], 'start': {'dateTime': CONTEXT['start']},
                 'end': {'dateTime': CONTEXT['end']}}
        current = {'id': 'file', 'createdDateTime': CONTEXT['start'], 'endDateTime': CONTEXT['end']}
        self.graph.side_effect = [event, current]
        with patch.object(retry, 'clock', return_value=now + timedelta(hours=2)):
            self.assertEqual(retry.run_pending(kinds=(coach.KIND,)), 1)
        asset.refresh_from_db(); job.refresh_from_db()
        self.assertEqual(asset.status, 'ready')
        self.assertEqual(asset.video_id, VIDEO)
        self.assertEqual(job.result['artifacts'][0]['lmsBunnyRecording']['videoId'], VIDEO)
        self.assertEqual(CurriculumVideoImport.objects.filter(target_kind=coach.KIND).count(), 1)
        self.client.request.assert_called_once()
        self.client.create.assert_not_called(); self.client.upload.assert_not_called()

    def test_recording_retry_continues_after_eight_failures_and_preserves_source(self):
        from curriculum_api import recording_retry as retry
        asset = self.asset(video_id=VIDEO)
        now = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)
        with patch.object(coach, 'transfer', side_effect=VideoImportError('Source temporarily unavailable')), \
                patch.object(coach, 'publish'):
            for attempt in range(12):
                with patch.object(retry, 'clock', return_value=now + timedelta(hours=2 * attempt)):
                    self.assertEqual(retry.run_pending(kinds=(coach.KIND,)), 1)
                asset.refresh_from_db()
                self.assertEqual(asset.video_id, VIDEO)
                self.assertEqual(asset.source_url, SOURCE)
                self.assertEqual(asset.source_at_start, SOURCE)
        self.assertEqual(CurriculumVideoImport.objects.filter(target_kind=coach.KIND).count(), 1)

    def test_failed_live_retry_does_not_depend_on_another_discovery_pass(self):
        from curriculum_api import recording_retry as retry
        asset = self.asset(target_kind='live_session', scope={'module_id': 'module', 'occurrence_id': 'occurrence'})
        now = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)
        def transfer(row, **kwargs):
            if transfer.attempts == 0:
                transfer.attempts += 1
                raise VideoImportError('Source is not published yet')
            row.video_id = VIDEO
            row.status = 'ready'
            row.save(update_fields=['video_id'])
        transfer.attempts = 0
        with patch('curriculum_api.session_bunny.transfer_recording', side_effect=transfer), \
                patch('curriculum_api.session_bunny.publish_outcome'), \
                patch('curriculum_api.views.curriculum_teams_meeting_artifacts', side_effect=AssertionError('No discovery needed')):
            with patch.object(retry, 'clock', return_value=now):
                self.assertEqual(retry.run_pending(kinds=('live_session',)), 1)
                self.assertEqual(retry.run_pending(kinds=('live_session',)), 0)
            with patch.object(retry, 'clock', return_value=now + timedelta(hours=2)):
                self.assertEqual(retry.run_pending(kinds=('live_session',)), 1)
        asset.refresh_from_db()
        self.assertEqual(asset.status, 'ready')
        self.assertEqual(asset.scope['occurrence_id'], 'occurrence')
        self.assertEqual(asset.video_id, VIDEO)

    def test_publication_failure_is_retried_without_stopping_another_import(self):
        from curriculum_api import recording_retry as retry
        first = self.asset(video_id=VIDEO, status='failed')
        second = self.asset(video_id='22222222-3333-4444-5555-666666666666', status='failed',
                            scope={'owner_email': 'other@example.invalid', 'event_key': 'other-occurrence'})
        now = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)
        def transfer(row): row.status = 'ready'
        def publish(row):
            if row.pk == first.pk: raise RuntimeError('Synthetic database publication failure')
        with patch.object(coach, 'transfer', side_effect=transfer), patch.object(coach, 'publish', side_effect=publish), \
                patch.object(retry, 'clock', return_value=now):
            self.assertEqual(retry.run_pending(kinds=(coach.KIND,)), 2)
        first.refresh_from_db(); second.refresh_from_db()
        self.assertEqual(first.status, 'failed')
        self.assertEqual(first.video_id, VIDEO)
        self.assertEqual(second.status, 'ready')
        with patch.object(coach, 'transfer', side_effect=transfer), patch.object(coach, 'publish'), \
                patch.object(retry, 'clock', return_value=now + timedelta(hours=2)):
            self.assertEqual(retry.run_pending(kinds=(coach.KIND,)), 1)
        first.refresh_from_db()
        self.assertEqual(first.status, 'ready')
        self.assertEqual(first.video_id, VIDEO)

    def test_delayed_failure_does_not_starve_other_due_recordings(self):
        from curriculum_api import recording_retry as retry
        delayed = self.asset(status='failed')
        now = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)
        with patch.object(coach, 'transfer', side_effect=VideoImportError('Wait')), patch.object(coach, 'publish'), \
                patch.object(retry, 'clock', return_value=now):
            video_imports.process(delayed.pk)
        due = self.asset(status='failed', target_kind='live_session')
        unrelated = self.asset(status='failed', target_kind='authoring_module')
        with patch.object(video_imports, 'process') as process, patch.object(retry, 'clock', return_value=now):
            self.assertEqual(retry.run_pending(limit=1), 1)
        process.assert_called_once_with(due.pk)
        unrelated.refresh_from_db()
        self.assertEqual(unrelated.status, 'failed')

    def test_disappearing_quality_artifact_is_a_visible_retry_not_false_ready(self):
        from curriculum_api import recording_retry as retry
        job, asset = self.prepare_transfer()
        asset.video_id = VIDEO; asset.save(update_fields=['video_id'])
        original = deepcopy(job.result)
        job.result = {**job.result, 'artifacts': []}; job.save(update_fields=['result'])
        now = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)
        def transfer(row): row.status = 'ready'
        with patch.object(coach, 'transfer', side_effect=transfer), patch.object(retry, 'clock', return_value=now):
            video_imports.process(asset.pk)
        asset.refresh_from_db()
        self.assertEqual(asset.status, 'failed')
        self.assertEqual(asset.video_id, VIDEO)
        self.assertIn('recording_retry', asset.scope)
        job.result = original; job.save(update_fields=['result'])
        with patch.object(coach, 'transfer', side_effect=transfer), \
                patch.object(retry, 'clock', return_value=now + timedelta(hours=2)):
            self.assertEqual(retry.run_pending(kinds=(coach.KIND,)), 1)
        asset.refresh_from_db(); job.refresh_from_db()
        self.assertEqual(asset.status, 'ready')
        self.assertEqual(job.result['artifacts'][0]['lmsBunnyRecording']['videoId'], VIDEO)
        self.client.request.assert_not_called()

    def test_background_retry_does_not_take_an_active_upload_lease(self):
        from curriculum_api import recording_retry as retry
        now = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)
        asset = self.asset(status='uploading', lease_until=now + timedelta(hours=1))
        with patch.object(video_imports, 'process') as process, patch.object(retry, 'clock', return_value=now):
            self.assertEqual(retry.run_pending(), 0)
        process.assert_not_called()
        asset.refresh_from_db()
        self.assertEqual(asset.status, 'uploading')
        self.assertEqual(asset.lease_until, now + timedelta(hours=1))

    def test_scheduled_worker_retries_only_the_requested_live_series(self):
        from contextlib import nullcontext
        from curriculum_api.management.commands import process_session_results as worker
        from curriculum_api import recording_retry as retry
        selected = self.asset(target_kind='live_session', target_id='selected', status='failed')
        self.asset(target_kind='live_session', target_id='other', status='failed')
        self.asset(status='failed')
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor); cursor.__exit__ = Mock(return_value=False)
        cursor.fetchone.return_value = None
        database = Mock(); database.cursor.return_value = cursor
        command = worker.Command(); command.stdout = Mock()
        with patch.object(worker, 'connections', {'default': database}), \
                patch.object(worker.transaction, 'atomic', side_effect=nullcontext), \
                patch.object(worker, 'archive_runtime_preflight', return_value='synthetic:instance:1:s3'), \
                patch('curriculum_api.session_captions.sync_pending_captions'), \
                patch('curriculum_api.teams_people_refresh.sync_due_people', return_value={'checked': 0, 'failed': 0}), \
                patch.object(video_imports, 'process') as process:
            command.handle(limit=2, scheduled=True, provision_container=False, live_session_ids=['selected'])
        process.assert_called_once_with(selected.pk)

    def test_completed_original_keeps_its_scope_after_same_event_is_rescheduled(self):
        job, asset = self.prepare_transfer()
        original = {'id': CONTEXT['event'], 'start': {'dateTime': CONTEXT['start']},
                    'end': {'dateTime': CONTEXT['end']}}
        job.result = {**job.result, 'event': original}
        job.last_success_at = datetime(2026, 11, 26, 12, tzinfo=timezone.utc)
        job.save(update_fields=['result', 'last_success_at'])
        moved = {**original, 'start': {'dateTime': '2026-12-03T10:00:00Z'},
                 'end': {'dateTime': '2026-12-03T11:00:00Z'}}
        self.graph.side_effect = [moved, {'id': 'file', 'createdDateTime': CONTEXT['start'], 'endDateTime': CONTEXT['end']}]
        self.client.find_import.side_effect = [None, self.video()]
        video_imports.process(asset.pk)
        asset.refresh_from_db(); job.refresh_from_db()
        self.assertEqual(asset.status, 'ready')
        self.assertEqual(asset.scope['context'], CONTEXT)
        self.assertTrue(asset.scope['original_occurrence_retained'])
        self.assertEqual(job.context, CONTEXT)
        self.assertEqual(job.result['event'], original)
        self.assertTrue(all(call.args[0] == 'GET' for call in self.graph.call_args_list))
        from coach_api.recordings_retained import retained_events
        first = datetime(2026, 11, 26, tzinfo=timezone.utc)
        last = first + timedelta(days=1)
        self.assertEqual(retained_events(OWNER, first, last, []), [{**original, 'lmsHistoricalRecording': True}])
        self.assertEqual(retained_events(OWNER, first, last, [original]), [original])
        self.assertEqual(retained_events('another@example.invalid', first, last, []), [])
        self.assertEqual(retained_events(OWNER, last, last + timedelta(days=1), []), [])
        asset.status = 'failed'; asset.save(update_fields=['status'])
        self.assertEqual(retained_events(OWNER, first, last, []), [])

    def test_early_part_requires_a_fresh_timed_part_of_the_same_physical_call(self):
        for matching in (True, False):
            with self.subTest(matching=matching):
                CurriculumVideoImport.objects.all().delete(); CoachingRecordingJob.objects.all().delete()
                self.client.reset_mock()
                job, asset = self.prepare_transfer()
                event = {'id': CONTEXT['event'], 'start': {'dateTime': CONTEXT['start']}, 'end': {'dateTime': CONTEXT['end']}}
                early = {'id': 'file', 'createdDateTime': '2026-11-26T09:58:52Z',
                         'endDateTime': '2026-11-26T09:59:53Z', 'callId': 'physical-call'}
                timed = {'id': 'main', 'createdDateTime': CONTEXT['start'], 'endDateTime': CONTEXT['end'],
                         'callId': 'physical-call' if matching else 'another-call'}
                self.graph.side_effect = [event, early, {'value': [early, timed]}]
                self.client.find_import.side_effect = [None, self.video()]
                with patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}):
                    video_imports.process(asset.pk)
                asset.refresh_from_db()
                self.assertEqual(asset.status, 'ready' if matching else 'failed')
                if not matching: self.client.request.assert_not_called()

    def test_cancelled_original_stays_blocked_even_with_a_successful_snapshot(self):
        job, asset = self.prepare_transfer()
        event = {'id': CONTEXT['event'], 'start': {'dateTime': CONTEXT['start']}, 'end': {'dateTime': CONTEXT['end']}}
        job.result = {**job.result, 'event': event}
        job.last_success_at = datetime(2026, 11, 26, 12, tzinfo=timezone.utc)
        job.save(update_fields=['result', 'last_success_at'])
        self.graph.side_effect = [{**event, 'isCancelled': True}]
        video_imports.process(asset.pk)
        asset.refresh_from_db()
        self.assertEqual(asset.status, 'failed')
        self.client.request.assert_not_called()

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
