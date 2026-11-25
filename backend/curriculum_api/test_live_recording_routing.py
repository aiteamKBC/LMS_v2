"""Live-only routing, historical playback safety and source-level deduplication."""
import copy
import hashlib
import io
import os
from contextlib import nullcontext
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase

from . import live_recording_migration as migration
from . import live_recording_routing as routing
from . import session_bunny, video_imports
from .bunny_stream import BunnyStream, VideoImportError
from .models import CurriculumVideoImport
from . import live_recording_transfer
from .session_recording_source import download_recording

VIDEO = 'c1c2c3c4-1234-5678-abcd-123456789abc'
OTHER = 'd1d2d3d4-1234-5678-abcd-123456789abc'
ENV = {'BUNNY_STREAM_ENABLED': 'true', 'BUNNY_STREAM_LIBRARY_ID': '798153',
    'BUNNY_STREAM_API_KEY': 'synthetic-materials-api', 'BUNNY_STREAM_TOKEN_KEY': 'synthetic-materials-token',
    'BUNNY_LIVE_STREAM_LIBRARY_ID': '796471', 'BUNNY_LIVE_STREAM_API_KEY': 'synthetic-live-api',
    'BUNNY_LIVE_STREAM_TOKEN_KEY': 'synthetic-live-token', routing.UPLOAD_FLAG: 'false'}


def video(guid=VIDEO, *, occurrence='O', identity='source-one', status=4, extra=None):
    tags = {'lms.occurrence_id': occurrence, 'lms.recording_identity': identity, **(extra or {})}
    return {'guid': guid, 'status': status, 'collectionId': 'COLLECTION',
            'metaTags': [{'property': key, 'value': value} for key, value in tags.items()]}


class RecordingIdentityTests(SimpleTestCase):
    def setUp(self):
        self.scope = {'occurrence_id': 'O', 'module_id': 'M', 'series_id': 'S',
            'graph_artifact_id': 'GRAPH', 'recording_identity': 'source-one'}

    def test_exact_source_is_selected_across_multiple_parts(self):
        self.assertEqual(routing.select_existing_recording([
            video(OTHER, identity='another-part'), video()], self.scope)['guid'], VIDEO)
        self.assertIsNone(routing.select_existing_recording([video(OTHER, identity='another-part')], self.scope))

    def test_live_cutover_cannot_select_the_materials_library(self):
        with patch.dict(os.environ, {**ENV, 'BUNNY_LIVE_STREAM_LIBRARY_ID': '798153', routing.UPLOAD_FLAG: 'true'}):
            with self.assertRaisesRegex(VideoImportError, 'separate library'):
                routing.new_recording_library()

    def test_occurrence_title_or_part_alone_cannot_adopt_or_trigger_another_upload(self):
        row = {'guid': VIDEO, 'status': 4, 'title': 'Same title', 'metaTags': [
            {'property': 'kbc_lms_occurrence_id', 'value': 'O'}, {'property': 'kbc_part', 'value': '1'}]}
        with self.assertRaisesRegex(VideoImportError, 'source-identity reconciliation'):
            routing.select_existing_recording([row], self.scope)

    def test_verified_peer_mapping_must_match_the_exact_microsoft_source(self):
        row = {'guid': VIDEO, 'metaTags': [{'property': 'kbc_lms_occurrence_id', 'value': 'O'},
            {'property': 'kbc_recording_identity', 'value': 'peer-source'}]}
        scope = {**self.scope, 'verified_peer_recording_identity': 'peer-source',
            'verified_peer_graph_artifact_id': 'GRAPH'}
        self.assertEqual(routing.select_existing_recording([row], scope)['guid'], VIDEO)
        with self.assertRaisesRegex(VideoImportError, 'source-identity reconciliation'):
            routing.select_existing_recording([row], {**scope, 'verified_peer_graph_artifact_id': 'OTHER'})

    def test_duplicate_source_matches_or_conflicting_owners_require_review(self):
        with self.assertRaisesRegex(VideoImportError, 'More than one'):
            routing.select_existing_recording([video(), video(OTHER)], self.scope)
        with self.assertRaisesRegex(VideoImportError, 'conflicting session owners'):
            routing.select_existing_recording([video(extra={'kbc_lms_occurrence_id': 'OTHER'})], self.scope)
        with self.assertRaisesRegex(VideoImportError, 'conflicting session owners'):
            routing.select_existing_recording([video(occurrence='OTHER', extra={'kbc_lms_occurrence_id': 'O'})], self.scope)

    def test_graph_alias_keeps_the_same_canonical_source(self):
        self.assertTrue(routing.matches_source(video(extra={'lms.graph_artifact_id': 'ALIAS'}), self.scope))

    def test_metadata_merge_retains_peer_identity_tags(self):
        client = BunnyStream('796471', api_key='synthetic')
        with patch.object(client, 'request') as request:
            client.metadata(VIDEO, self.scope, 'Synthetic recording', existing_tags=[
                {'property': 'kbc_recording_identity', 'value': 'peer-source'}])
        tags = {row['property']: row['value'] for row in request.call_args.kwargs['json']['metaTags']}
        self.assertEqual(tags['kbc_recording_identity'], 'peer-source')
        self.assertEqual(tags['lms.recording_identity'], 'source-one')

    def test_exact_bytes_can_identify_two_graph_aliases_without_merging_other_parts(self):
        row = video(extra={'lms.series_id': 'S', 'lms.module_id': 'M', 'lms.source_content_sha256': 'a' * 64})
        scope = {**self.scope, 'recording_identity': 'different-graph-alias', 'source_content_sha256': 'a' * 64}
        self.assertEqual(routing.select_existing_recording([row], scope)['guid'], VIDEO)
        self.assertIsNone(routing.select_existing_recording([row], {**scope, 'source_content_sha256': 'b' * 64}))

    def test_sharepoint_fallback_never_receives_the_graph_bearer_token(self):
        content = b'\x00\x00\x00\x20ftypisom' + b'x' * 64
        url = 'https://example.sharepoint.com/download.aspx?UniqueId=synthetic'
        response = Mock()
        response.status = 206
        response.headers = {'Content-Type': 'video/mp4', 'Content-Range': f'bytes 0-{len(content)-1}/{len(content)}'}
        response.geturl.return_value = url
        response.read.side_effect = [content, b'']
        opener = Mock()
        opener.open.return_value = nullcontext(response)
        with patch('curriculum_api.session_recording_source.build_opener', return_value=opener):
            with download_recording(url, 'synthetic-graph-token', _sharepoint_source=True) as stream:
                self.assertEqual(stream.read(), content)
        self.assertIsNone(opener.open.call_args.args[0].get_header('Authorization'))
        with self.assertRaises(VideoImportError):
            with download_recording(url, 'synthetic-graph-token'):
                pass

    def test_upload_error_cannot_trigger_another_fallback_download(self):
        with patch.object(live_recording_transfer, 'download_recording', return_value=nullcontext(io.BytesIO(b'bytes'))) as download:
            with self.assertRaisesRegex(VideoImportError, 'HTTP 404'):
                with live_recording_transfer.original_stream('synthetic-source', 'synthetic-token', {}, Mock()):
                    raise VideoImportError('Bunny returned HTTP 404.')
        self.assertEqual(download.call_count, 1)

    def test_inventory_is_complete_before_selecting_to_detect_duplicates(self):
        client = Mock()
        client.request.side_effect = [{'items': [video(occurrence='OTHER')] * 100}, {'items': [video()]}]
        self.assertEqual(routing.find_existing_recording(client, self.scope)['guid'], VIDEO)
        self.assertEqual(client.request.call_count, 2)

    def test_incomplete_or_unreadable_inventory_never_allows_a_second_upload(self):
        client = Mock()
        client.request.return_value = {'items': None}
        with self.assertRaises(VideoImportError):
            routing.find_existing_recording(client, self.scope)


class LiveRoutingTests(TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, ENV)
        self.environment.start(); self.addCleanup(self.environment.stop)
        self.read_patch = patch('curriculum_api.session_results.read', return_value=[{'id': 'COMP', 'week_id': 'WEEK'}])
        self.read = self.read_patch.start(); self.addCleanup(self.read_patch.stop)
        self.owner = patch('curriculum_api.views.teams_online_meeting_owner_id', return_value='OWNER')
        self.owner.start(); self.addCleanup(self.owner.stop)
        self.series = {'id': 'S', 'module_catalogue_id': 'M', 'module_title': 'Synthetic module',
            'online_meeting_id': 'MEETING', 'organizer_email': 'owner@example.invalid', 'join_url': ''}
        self.occurrence = {'id': 'O', 'scheduled_start': '2026-11-25T10:00:00Z', 'session_number': 1}
        self.artifact = {'id': 'A', 'artifact_type': 'recording', 'graph_artifact_id': 'GRAPH'}
        self.module = {'programme_id': 'P', 'cohort_id': 'C', 'group_id': 'G'}

    def enqueue(self):
        return session_bunny.enqueue_recording(self.series, self.occurrence, self.artifact, self.module)

    def historical(self):
        asset = self.enqueue()
        asset.status, asset.video_id, asset.collection_id = 'ready', OTHER, 'OLD-COLLECTION'
        asset.save()
        return asset

    def test_cutover_switch_routes_new_live_originals_only(self):
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true'}):
            asset = self.enqueue()
        self.assertEqual(asset.library_id, '796471')
        self.assertEqual(asset.scope['component_ids'], 'COMP')
        self.assertEqual(asset.scope['week_ids'], 'WEEK')
        self.assertEqual(asset.scope['recording_identity'], asset.fingerprint)
        self.assertEqual(os.environ['BUNNY_STREAM_LIBRARY_ID'], '798153')

    def test_default_keeps_existing_transfer_until_single_owner_cutover(self):
        self.assertEqual(self.enqueue().library_id, '798153')

    def test_missing_playback_key_blocks_only_new_live_uploads(self):
        historical = self.historical()
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true', 'BUNNY_LIVE_STREAM_TOKEN_KEY': ''}):
            self.assertEqual(self.enqueue().pk, historical.pk)
            self.artifact = {**self.artifact, 'id': 'NEW', 'graph_artifact_id': 'NEW'}
            with self.assertRaisesRegex(VideoImportError, 'playback security key'):
                self.enqueue()
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_historical_migration_is_idempotent_and_keeps_original_journal(self):
        historical = self.historical()
        one = migration.queue_migration(historical)
        historical.refresh_from_db()
        two = migration.queue_migration(historical)
        self.assertEqual(one.pk, two.pk)
        self.assertEqual((one.library_id, one.component_id, one.target_id), ('796471', historical.component_id, historical.target_id))
        self.assertEqual((historical.library_id, historical.video_id, historical.status), ('798153', OTHER, 'ready'))
        self.assertEqual(CurriculumVideoImport.objects.count(), 2)
        self.assertEqual(self.enqueue().pk, one.pk)

    def test_materials_or_inflight_imports_cannot_be_migrated(self):
        asset = self.enqueue()
        with self.assertRaises(VideoImportError):
            migration.queue_migration(asset)
        asset.target_kind, asset.status, asset.video_id = 'module', 'ready', OTHER
        with self.assertRaises(VideoImportError):
            migration.queue_migration(asset)

    def test_mapping_requires_a_matching_source_and_valid_video_identity(self):
        asset = self.historical()
        with self.assertRaisesRegex(VideoImportError, 'exact Microsoft'):
            migration.queue_migration(asset, peer_mapping={'graph_artifact_id': 'OTHER', 'peer_recording_identity': 'peer', 'video_id': VIDEO})
        replacement = migration.queue_migration(asset, peer_mapping={
            'graph_artifact_id': 'GRAPH', 'peer_recording_identity': 'peer', 'video_id': VIDEO})
        self.assertEqual(replacement.video_id, VIDEO)
        self.assertEqual(replacement.scope['verified_peer_graph_artifact_id'], 'GRAPH')

    def test_cross_occurrence_replacement_is_rejected(self):
        original = self.historical()
        replacement = migration.queue_migration(original)
        replacement.scope['occurrence_id'] = 'OTHER'
        replacement.save()
        original.refresh_from_db()
        with self.assertRaisesRegex(VideoImportError, 'does not belong'):
            migration.replacement_import(original)

    def test_pending_or_failed_replacement_retains_the_original_player_projection(self):
        original = self.historical()
        replacement = migration.queue_migration(original)
        for status in ('queued', 'processing', 'failed'):
            replacement.status = status
            replacement.save()
            with patch.object(migration, 'checked_previous', return_value=original), \
                 patch.object(session_bunny.connections['default'], 'cursor') as cursor:
                cursor.return_value.__enter__.return_value.fetchall.return_value = [('A',)]
                session_bunny.publish_outcome(replacement)
                params = next(call.args[1] for call in cursor.return_value.__enter__.return_value.execute.call_args_list
                              if call.args[0].startswith('UPDATE curriculum.live_session_artifacts'))
                self.assertIn('"libraryId": "798153"', params[0])
                self.assertIn(OTHER, params[0])

    def test_new_player_is_not_published_until_protected_playback_is_verified(self):
        original = self.historical()
        replacement = migration.queue_migration(original)
        replacement.status, replacement.video_id = 'ready', VIDEO
        replacement.save()
        with self.assertRaisesRegex(VideoImportError, 'must be verified'):
            session_bunny.publish_outcome(replacement)

    def test_playback_verification_requires_the_same_video_and_library(self):
        asset = migration.queue_migration(self.historical())
        asset.status, asset.video_id = 'ready', VIDEO
        client = Mock()
        client.request.return_value = {'video': {'guid': OTHER, 'videoLibraryId': 796471}}
        with self.assertRaises(VideoImportError):
            migration.verify_live_playback(asset, client)
        client.request.return_value = {'video': {'guid': VIDEO, 'videoLibraryId': 796471}}
        migration.verify_live_playback(asset, client)
        self.assertEqual(asset.scope['live_playback_verified_video_id'], VIDEO)
        client.request.reset_mock()
        migration.verify_live_playback(asset, client)
        client.request.assert_not_called()

    def test_ready_replacement_remains_authoritative_when_old_import_is_republished(self):
        original = self.historical()
        replacement = migration.queue_migration(original)
        replacement.status, replacement.video_id = 'ready', VIDEO
        replacement.scope.update(live_playback_verified_video_id=VIDEO, live_playback_verified_library_id='796471')
        replacement.save()
        original.refresh_from_db()
        with patch.object(migration, 'checked_previous', return_value=None), \
             patch.object(migration, 'replacement_import', return_value=replacement), \
             patch.object(session_bunny.connections['default'], 'cursor') as cursor:
            cursor.return_value.__enter__.return_value.fetchall.return_value = [('A',)]
            session_bunny.publish_outcome(original)
            params = next(call.args[1] for call in cursor.return_value.__enter__.return_value.execute.call_args_list
                          if call.args[0].startswith('UPDATE curriculum.live_session_artifacts'))
            self.assertIn('"libraryId": "796471"', params[0])
            self.assertIn(VIDEO, params[0])

    def process_live(self, items):
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true'}):
            asset = self.enqueue()
        row = {**self.series, **self.artifact, 'occurrence_join_url': '', 'occurrence_meeting_id': ''}
        self.read.return_value = [row]
        client = Mock()
        client.library_id = '796471'
        client.find_import.return_value = None
        client.video.return_value = copy.deepcopy(items[0]) if items else None

        def request(method, path, **kwargs):
            if method == 'GET' and path == '/videos':
                return {'items': items}
            if method == 'GET' and path.endswith('/play'):
                return {'video': {'guid': VIDEO, 'videoLibraryId': 796471}}
            raise AssertionError('Unexpected provider call')

        client.request.side_effect = request
        with patch.object(session_bunny, 'BunnyStream', return_value=client), \
             patch('curriculum_api.bunny_module_collections.recording_collection', return_value='COLLECTION'), \
             patch.object(session_bunny, 'publish_outcome') as publish, \
             patch.object(session_bunny, 'download_recording', side_effect=AssertionError('No duplicate download')), \
             patch.object(session_bunny, '_queue_remote_fetch', side_effect=AssertionError('No duplicate remote fetch')):
            result = video_imports.process(asset.pk)
        return result, client, publish

    def test_live_source_already_uploaded_is_adopted_without_a_second_transfer(self):
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true'}):
            original = self.enqueue()
        existing = video(identity=original.fingerprint, extra={'kbc_recording_identity': 'retained-peer-id'})
        result, client, publish = self.process_live([existing])
        self.assertEqual((result.library_id, result.video_id, result.status), ('796471', VIDEO, 'ready'))
        client.upload.assert_not_called()
        client.create.assert_not_called()
        self.assertEqual(client.metadata.call_args.kwargs['existing_tags'], existing['metaTags'])
        self.assertEqual(result.scope['live_playback_verified_video_id'], VIDEO)
        publish.assert_called_once()

    def test_ambiguous_peer_source_fails_without_a_second_transfer(self):
        existing = {'guid': VIDEO, 'status': 4, 'metaTags': [
            {'property': 'kbc_lms_occurrence_id', 'value': 'O'},
            {'property': 'kbc_recording_identity', 'value': 'unmapped-peer-id'}]}
        result, client, _ = self.process_live([existing])
        self.assertEqual(result.status, 'failed')
        self.assertIn('source-identity reconciliation', result.error)
        client.create.assert_not_called()
        client.upload.assert_not_called()

    def test_peer_created_or_encoding_video_is_never_overwritten_with_an_upload(self):
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true'}):
            original = self.enqueue()
        for status in (0, 1, 2, 3):
            result, client, _ = self.process_live([video(identity=original.fingerprint, status=status)])
            self.assertEqual(result.status, 'processing')
            self.assertEqual(result.scope['adopted_existing_live_video'], VIDEO)
            client.create.assert_not_called()
            client.upload.assert_not_called()

    def test_changed_source_cannot_be_applied_with_an_older_approved_plan(self):
        original = self.historical()
        client = Mock()
        client.request.return_value = {'items': [video(identity=original.fingerprint)]}
        plan = migration.plan_migrations([original], client)
        original.source_url += '?changed=1'
        with self.assertRaisesRegex(VideoImportError, 'source changed'):
            migration.apply_migration_plan(plan, [original], migration.plan_fingerprint(plan))
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_migration_plan_refuses_ambiguous_peer_records_without_writes(self):
        original = self.historical()
        client = Mock()
        client.request.return_value = {'items': [{'guid': VIDEO, 'status': 4, 'metaTags': [
            {'property': 'kbc_lms_occurrence_id', 'value': 'O'},
            {'property': 'kbc_recording_identity', 'value': 'unknown-peer'}]}]}
        plan = migration.plan_migrations([original], client)
        self.assertEqual(plan['imports'][0]['action'], 'blocked')
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        with self.assertRaisesRegex(VideoImportError, 'unresolved source'):
            migration.apply_migration_plan(plan, [original], migration.plan_fingerprint(plan))
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_verified_adoption_can_be_queued_before_enabling_new_original_uploads(self):
        original = self.historical()
        client = Mock()
        client.request.return_value = {'items': [video(identity=original.fingerprint)]}
        plan = migration.plan_migrations([original], client)
        self.assertEqual(plan['imports'][0]['action'], 'adopt_existing')
        with self.assertRaisesRegex(VideoImportError, 'plan changed'):
            migration.apply_migration_plan(plan, [original], 'outdated-plan')
        queued = migration.apply_migration_plan(plan, [original], migration.plan_fingerprint(plan))
        self.assertEqual(len(queued), 1)
        self.assertEqual(CurriculumVideoImport.objects.count(), 2)

    def test_original_upload_plan_requires_single_uploader_cutover(self):
        original = self.historical()
        client = Mock()
        client.request.return_value = {'items': []}
        plan = migration.plan_migrations([original], client)
        self.assertEqual(plan['imports'][0]['action'], 'upload_original_after_cutover')
        with self.assertRaisesRegex(VideoImportError, 'single-uploader cutover'):
            migration.apply_migration_plan(plan, [original], migration.plan_fingerprint(plan))
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_scheduled_migration_processing_uses_the_existing_worker_claim(self):
        replacement = migration.queue_migration(self.historical())
        with patch.object(video_imports, 'process') as process:
            self.assertEqual(migration.run_pending_migrations(limit=1), 1)
        process.assert_called_once_with(replacement.pk)

    def test_migration_command_requires_explicit_scope_and_defaults_to_read_only(self):
        from io import StringIO
        from django.core.management import call_command
        from django.core.management.base import CommandError
        self.historical()
        with self.assertRaises(CommandError):
            call_command('migrate_live_recordings', stdout=StringIO())
        client = Mock()
        client.request.return_value = {'items': []}
        output = StringIO()
        with patch('curriculum_api.management.commands.migrate_live_recordings.BunnyStream', return_value=client):
            call_command('migrate_live_recordings', series_id='S', stdout=output)
        self.assertIn('"read_only": true', output.getvalue())
        self.assertIn('"transfers_executed_by_this_command": 0', output.getvalue())
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_distinct_graph_ids_with_identical_original_bytes_create_only_one_video(self):
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true'}):
            first = self.enqueue()
            second = session_bunny.enqueue_recording(self.series, self.occurrence,
                {**self.artifact, 'id': 'ALIAS', 'graph_artifact_id': 'GRAPH-ALIAS'}, self.module)
        rows = {'A': {**self.series, **self.artifact, 'occurrence_join_url': '', 'occurrence_meeting_id': ''},
            'ALIAS': {**self.series, **self.artifact, 'id': 'ALIAS', 'graph_artifact_id': 'GRAPH-ALIAS',
                      'occurrence_join_url': '', 'occurrence_meeting_id': ''}}
        self.read.side_effect = lambda sql, params: [rows[params[0]]]
        client = Mock()
        client.library_id = '796471'
        client.find_import.return_value = None
        client.create.return_value = {'guid': VIDEO}
        client.video.return_value = video(extra={'videoLibraryId': '796471'})
        client.request.side_effect = lambda method, path, **kwargs: (
            {'items': []} if path == '/videos' else {'video': {'guid': VIDEO, 'videoLibraryId': 796471}})
        original_bytes = b'\x00\x00\x00\x20ftypisom' + b'x' * 128
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true'}), \
             patch.object(session_bunny, 'BunnyStream', return_value=client), \
             patch('curriculum_api.bunny_module_collections.recording_collection', return_value='COLLECTION'), \
             patch.object(session_bunny, 'publish_outcome'), \
             patch.object(live_recording_transfer, 'original_stream', side_effect=lambda *args: nullcontext(io.BytesIO(original_bytes))), \
             patch('coach_api.views.microsoft_graph_token', return_value='synthetic'), \
             patch.object(live_recording_transfer, 'TransferProgress'):
            one = video_imports.process(first.pk)
            two = video_imports.process(second.pk)
        self.assertEqual((one.video_id, two.video_id, one.status, two.status), (VIDEO, VIDEO, 'ready', 'ready'))
        self.assertNotEqual(one.scope['recording_identity'], two.scope['recording_identity'])
        self.assertEqual(one.scope['source_content_sha256'], two.scope['source_content_sha256'])
        self.assertEqual(client.create.call_count, 1)
        self.assertEqual(client.upload.call_count, 1)
        self.assertEqual(CurriculumVideoImport.objects.filter(target_kind='live_source').count(), 1)

    def test_busy_source_owner_is_reused_without_another_download_or_upload(self):
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true'}):
            first = self.enqueue()
            second = session_bunny.enqueue_recording(self.series, self.occurrence,
                {**self.artifact, 'id': 'ALIAS', 'graph_artifact_id': 'GRAPH-ALIAS'}, self.module)
        content_hash = hashlib.sha256(b'synthetic-original').hexdigest()
        first.scope['source_content_sha256'] = content_hash
        first.save()
        self.assertEqual(migration.original_source_owner(first).pk, first.pk)
        second.scope['source_content_sha256'] = content_hash
        second.save()
        self.assertEqual(migration.original_source_owner(second).pk, first.pk)
        client = Mock()
        with patch.object(live_recording_transfer, 'original_stream', side_effect=AssertionError('Must reuse owner')):
            self.assertIsNone(live_recording_transfer.transfer_original(second, client, 'synthetic', {}))
        client.create.assert_not_called()
        client.upload.assert_not_called()

    def test_identical_bytes_in_a_different_occurrence_have_a_separate_authorized_owner(self):
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true'}):
            first = self.enqueue()
            second = session_bunny.enqueue_recording(self.series, {**self.occurrence, 'id': 'OTHER'},
                {**self.artifact, 'id': 'OTHER'}, self.module)
        for asset in (first, second):
            asset.scope['source_content_sha256'] = 'a' * 64
            asset.save()
        self.assertEqual(migration.original_source_owner(first).pk, first.pk)
        self.assertEqual(migration.original_source_owner(second).pk, second.pk)
        self.assertEqual(CurriculumVideoImport.objects.filter(target_kind='live_source').count(), 2)

    def test_changed_original_bytes_cannot_overwrite_a_claimed_source(self):
        with patch.dict(os.environ, {routing.UPLOAD_FLAG: 'true'}):
            asset = self.enqueue()
        asset.scope['source_content_sha256'] = hashlib.sha256(b'original-version').hexdigest()
        asset.save()
        migration.original_source_owner(asset)
        client = Mock()
        with patch.object(live_recording_transfer, 'original_stream', return_value=nullcontext(io.BytesIO(b'changed-version'))), \
             patch('coach_api.views.microsoft_graph_token', return_value='synthetic'), \
             patch.object(live_recording_transfer, 'TransferProgress'):
            with self.assertRaisesRegex(VideoImportError, 'bytes changed'):
                live_recording_transfer.transfer_original(asset, client, 'synthetic', {})
        client.create.assert_not_called()
        client.upload.assert_not_called()
