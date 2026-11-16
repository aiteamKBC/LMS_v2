"""Library-wide authoring reuse; all media/storage requests are mocked."""
import hashlib
import importlib
import io
from contextlib import nullcontext
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.apps import apps
from django.db import connection
from django.test import TestCase
from django.utils import timezone

from . import video_imports as imports
from .bunny_stream import VideoImportError
from .models import CurriculumVideoImport, CurriculumVideoSource
from .video_dedup import source_key, upload_owner

MP4 = b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64
VIDEO = 'c1c2c3c4-1234-5678-abcd-123456789abc'
OTHER_VIDEO = 'd1d2d3d4-1234-5678-abcd-123456789abc'
YOUTUBE = 'https://www.youtube.com/watch?v=abcdefghijk'
SHORT = 'https://youtu.be/abcdefghijk?si=tracking&t=90'
MIGRATION = importlib.import_module('curriculum_api.migrations.0091_curriculum_video_source')


class VideoDedupTests(TestCase):
    def setUp(self):
        self.bunny = Mock()
        self.bunny.collection.return_value = 'programme-collection'
        self.bunny.free_course_collection.return_value = 'free-collection'
        self.bunny.find_import.return_value = None
        self.bunny.create.return_value = {'guid': VIDEO}
        self.bunny.video.return_value = {'guid': VIDEO, 'status': 4}
        self.enterContext(patch.object(imports, 'BunnyStream', return_value=self.bunny))
        self.download = self.enterContext(patch.object(imports, 'download_video', side_effect=lambda _: nullcontext(io.BytesIO(MP4))))
        self.stored = self.enterContext(patch.object(imports, 'stored_video', side_effect=lambda _: nullcontext(io.BytesIO(MP4))))
        self.matches = self.enterContext(patch.object(imports, '_matches_current_source', return_value=True))

    def asset(self, ident, source=YOUTUBE, kind='free_course', library='1', file_hash=''):
        scope = ({'free_course_module_id': ident, 'free_course_name': 'Course ' + ident,
                  'collection_name': 'Free course'} if kind == 'free_course' else
                 {'programme_id': 'P-' + ident, 'programme_name': 'Programme', 'group_id': 'G-' + ident})
        component = {'id': 'C-' + ident, 'title': 'Same title', 'settings_json': {'videoUrl': source, 'lessonContent': 'Keep'}}
        asset = imports.enqueue(kind, ident, component, scope, file_hash=file_hash)
        asset.library_id = library
        asset.save(update_fields=['library_id'])
        return asset

    def seed(self):
        MIGRATION.seed_sources(apps, SimpleNamespace(connection=connection))

    def test_youtube_is_shared_across_courses_modules_templates_and_groups(self):
        first = imports.process(self.asset('A').pk)
        for ident, kind in [('B', 'free_course'), ('C', 'module'), ('D', 'template'), ('E', 'module')]:
            alias = self.asset(ident, SHORT, kind)
            before = deepcopy((alias.scope, alias.source_url, alias.source_at_start, alias.title))
            result = imports.process(alias.pk)
            self.assertEqual((result.status, result.video_id, result.collection_id), ('ready', first.video_id, 'free-collection'))
            self.assertEqual((result.scope, result.source_url, result.source_at_start, result.title), before)
        self.assertEqual(CurriculumVideoImport.objects.count(), 5)
        self.assertEqual(CurriculumVideoSource.objects.count(), 1)
        self.bunny.create.assert_called_once()
        self.bunny.upload.assert_called_once()
        self.bunny.metadata.assert_called_once()
        self.bunny.collection.assert_not_called()
        self.download.assert_called_once()

    def test_programme_copy_is_reused_without_moving_or_renaming_it(self):
        first = imports.process(self.asset('A', kind='module').pk)
        self.bunny.reset_mock()
        alias = self.asset('B')
        alias.title = 'Different name'; alias.save()
        result = imports.process(alias.pk)
        self.assertEqual((result.video_id, result.collection_id), (first.video_id, 'programme-collection'))
        self.bunny.free_course_collection.assert_not_called()
        self.bunny.collection.assert_not_called()
        self.bunny.metadata.assert_not_called()
        self.bunny.create.assert_not_called()
        self.bunny.upload.assert_not_called()
        self.bunny.delete.assert_not_called()

    def test_mp4_hash_reuses_identical_bytes_across_storage_paths(self):
        digest = hashlib.sha256(MP4).hexdigest()
        a = self.asset('A', f'/curriculum_api/curriculum/uploads/videos/free_course/A/C/{digest}.mp4')
        b = self.asset('B', f'/curriculum_api/curriculum/uploads/videos/module/B/D/{digest}.mp4', 'module')
        first, second = imports.process(a.pk), imports.process(b.pk)
        self.assertEqual(first.video_id, second.video_id)
        self.bunny.upload.assert_called_once()
        self.stored.assert_called_once()

    def test_legacy_immediate_mp4_and_durable_mp4_use_same_hash(self):
        first = self.asset('A', file_hash='legacy-hash')
        imports.process(first.pk, io.BytesIO(MP4))
        digest = hashlib.sha256(MP4).hexdigest()
        second = self.asset('B', f'/curriculum_api/curriculum/uploads/videos/module/B/D/{digest}.mp4', 'module')
        self.assertEqual(imports.process(second.pk).video_id, VIDEO)
        self.bunny.upload.assert_called_once()

    def test_legacy_owner_retry_uses_identical_file_from_second_request(self):
        first = self.asset('A', file_hash='legacy-hash')
        upload_owner(first, io.BytesIO(MP4))
        second = self.asset('B', file_hash='legacy-hash')
        self.assertEqual(imports.process(second.pk, io.BytesIO(MP4)).status, 'ready')
        self.bunny.create.assert_called_once_with(first.pk, first.title, 'free-collection', scope=first.scope)
        self.bunny.upload.assert_called_once()

    def test_same_title_does_not_merge_different_youtube_videos(self):
        imports.process(self.asset('A').pk)
        imports.process(self.asset('B', 'https://youtu.be/lmnopqrstuv').pk)
        self.assertEqual(self.bunny.create.call_count, 2)

    def test_different_mp4_bytes_have_different_source_keys(self):
        first, second = self.asset('A', file_hash='one'), self.asset('B', file_hash='two')
        self.assertNotEqual(source_key(first, io.BytesIO(MP4)), source_key(second, io.BytesIO(MP4 + b'1')))

    def test_different_libraries_never_share_remote_identity(self):
        imports.process(self.asset('A', library='1').pk)
        imports.process(self.asset('B', library='2').pk)
        self.assertEqual(self.bunny.create.call_count, 2)
        self.assertEqual(CurriculumVideoSource.objects.count(), 2)

    def test_deleted_or_renamed_component_can_reuse_superseded_copy(self):
        self.matches.return_value = False
        old = imports.process(self.asset('A').pk)
        self.assertEqual(old.status, 'superseded')
        self.matches.return_value = True
        new = imports.process(self.asset('replacement', SHORT).pk)
        self.assertEqual((new.status, new.video_id), ('ready', old.video_id))
        self.bunny.create.assert_called_once()

    def test_pending_owner_lease_queues_alias_without_uploading(self):
        first = self.asset('A')
        upload_owner(first)
        first.lease_until = timezone.now() + timedelta(minutes=10); first.save()
        alias = self.asset('B', SHORT)
        pending = imports.process(alias.pk)
        self.assertEqual((pending.status, pending.video_id, pending.lease_until), ('queued', '', None))
        self.bunny.create.assert_not_called()
        self.bunny.upload.assert_not_called()
        first.lease_until = None; first.save()
        self.assertEqual(imports.process(alias.pk).status, 'ready')
        self.bunny.create.assert_called_once()

    def test_alias_during_owner_upload_follows_owner_without_reuploading(self):
        first = self.asset('A'); upload_owner(first)
        first.video_id, first.status = VIDEO, 'uploading'
        first.lease_until = timezone.now() + timedelta(minutes=10); first.save()
        self.bunny.video.return_value = {'status': 0}
        alias = self.asset('B')
        self.assertEqual(imports.process(alias.pk).status, 'processing')
        self.assertEqual(imports.process(alias.pk).status, 'processing')
        self.bunny.upload.assert_not_called()
        self.bunny.create.assert_not_called()

    def test_lost_create_response_retries_original_marker_for_new_context(self):
        first = self.asset('A')
        self.bunny.create.side_effect = VideoImportError('Response lost')
        self.assertEqual(imports.process(first.pk).status, 'failed')
        self.bunny.find_import.return_value = {'guid': VIDEO, 'status': 4}
        second = imports.process(self.asset('B', SHORT).pk)
        self.assertEqual((second.video_id, second.status), (VIDEO, 'ready'))
        self.bunny.find_import.assert_called_with(first.pk)
        self.bunny.create.assert_called_once()

    def test_owner_error_is_visible_to_reusing_course(self):
        first = self.asset('A'); upload_owner(first)
        self.download.side_effect = VideoImportError('Source unavailable')
        result = imports.process(self.asset('B').pk)
        self.assertEqual((result.status, result.error), ('failed', 'Source unavailable'))
        self.bunny.create.assert_not_called()

    def test_unavailable_existing_remote_copy_fails_without_creating_another(self):
        imports.process(self.asset('A').pk)
        self.bunny.reset_mock()
        self.bunny.video.side_effect = VideoImportError('Video unavailable')
        result = imports.process(self.asset('B').pk)
        self.assertEqual((result.status, result.error), ('failed', 'Video unavailable'))
        self.bunny.create.assert_not_called()
        self.bunny.upload.assert_not_called()

    def test_reused_copy_keeps_current_component_source_check(self):
        imports.process(self.asset('A').pk)
        self.matches.return_value = False
        self.assertEqual(imports.process(self.asset('B').pk).status, 'superseded')

    def test_migration_prefers_ready_existing_copy_and_preserves_old_duplicates(self):
        old, ready = self.asset('A'), self.asset('B', SHORT, 'module')
        old.video_id, old.status = OTHER_VIDEO, 'processing'; old.save()
        ready.video_id, ready.status, ready.collection_id = VIDEO, 'ready', 'original-collection'; ready.save()
        before = list(CurriculumVideoImport.objects.order_by('id').values())
        self.seed(); self.seed()
        self.assertEqual(list(CurriculumVideoImport.objects.order_by('id').values()), before)
        self.assertEqual(CurriculumVideoSource.objects.get().owner_import_id, ready.pk)
        self.assertEqual(imports.process(self.asset('C').pk).video_id, VIDEO)
        self.assertEqual(imports.process(old.pk).video_id, OTHER_VIDEO)
        self.bunny.create.assert_not_called()
        self.bunny.upload.assert_not_called()
        self.bunny.metadata.assert_not_called()
        self.bunny.delete.assert_not_called()

    def test_migration_and_runtime_normalize_sources_identically(self):
        digest = hashlib.sha256(MP4).hexdigest()
        for url in (YOUTUBE, SHORT, 'https://www.youtube.com/shorts/abcdefghijk',
                    'https://www.youtube-nocookie.com/embed/abcdefghijk', 'https://youtube.com/live/abcdefghijk',
                    'https://youtube.com/playlist?list=invalid', 'https://youtu.be/not-valid',
                    'https://youtube.com:443/watch?v=abcdefghijk', 'https://x:password@youtu.be/abcdefghijk',
                    'https://example.test/video.mp4', 'https://[broken',
                    f'/curriculum_api/curriculum/uploads/videos/module/A/B/{digest}.mp4', ''):
            row = SimpleNamespace(source_url=url, target_kind='module', library_id='1')
            with self.subTest(url=url):
                self.assertEqual(source_key(row), MIGRATION.source_key_v1(row))

    def test_migration_reinstallation_checks_existing_registry_without_replacing_it(self):
        asset = self.asset('A'); upload_owner(asset)
        before = list(CurriculumVideoSource.objects.values())
        editor = SimpleNamespace(connection=connection, create_model=Mock())
        MIGRATION.install(apps, editor)
        self.assertEqual(list(CurriculumVideoSource.objects.values()), before)
        editor.create_model.assert_not_called()

    def test_migration_rejects_existing_table_without_identity_constraint(self):
        editor = SimpleNamespace(connection=connection, create_model=Mock())
        with patch.object(connection.introspection, 'get_constraints', return_value={}):
            with self.assertRaisesMessage(RuntimeError, 'does not match migration 0091'):
                MIGRATION.install(apps, editor)
        editor.create_model.assert_not_called()

    def test_live_session_does_not_enter_registry_or_authoring_upload_path(self):
        asset = self.asset('meeting', kind='live_session')
        self.assertEqual(source_key(asset), '')
        asset.video_id = VIDEO; asset.save()
        self.seed()
        self.assertFalse(CurriculumVideoSource.objects.exists())
        with patch('curriculum_api.session_bunny.transfer_recording') as transfer, \
             patch('curriculum_api.session_bunny.publish_outcome'), patch('curriculum_api.video_dedup.upload_owner') as owner:
            imports.process(asset.pk)
        transfer.assert_called_once()
        owner.assert_not_called()
        self.bunny.create.assert_not_called()
