"""Run with config.settings_sqlite_test; all storage/network calls are mocked."""
import io
import json
from contextlib import nullcontext
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.http import JsonResponse
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, TestCase
from django.utils import timezone

from . import video_imports as imports
from .bunny_stream import VideoImportError, playback_url
from .models import CurriculumVideoImport
from .video_uploads import stored_video_path

VIDEO_ID = 'c1c2c3c4-1234-5678-abcd-123456789abc'
SCOPE = {'programme_id': 'PROG-PCP-L6', 'programme_name': 'Project Controls Professional Level 6',
         'cohort_id': 'C1', 'cohort_name': 'Example cohort', 'group_id': 'G1', 'group_name': 'Example group'}
SOURCE = 'https://example.com/lesson.mp4'
MP4 = b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64


class VideoImportTests(TestCase):
    def setUp(self):
        self.component = {'id': 'COMP1', 'type': 'video', 'title': 'Example lesson', 'module_catalogue_id': 'MOD1',
                          'settings_json': {'videoUrl': SOURCE, 'requiredProgressPercentage': 80, 'lessonContent': 'Keep this'}}
        self.client = Mock()
        self.client.collection.return_value = 'collection'
        self.client.find_import.return_value = None
        self.client.create.return_value = {'guid': VIDEO_ID, 'status': 0}
        self.client.video.return_value = {'guid': VIDEO_ID, 'status': 4}
        download = patch.object(imports, 'download_video', side_effect=lambda _: nullcontext(io.BytesIO(MP4)))
        download.start()
        self.addCleanup(download.stop)

    def asset(self):
        return imports.enqueue('module', 'MOD1', self.component, SCOPE)

    def test_repeated_source_uses_same_durable_import(self):
        self.assertEqual(self.asset().id, self.asset().id)
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_other_group_and_component_do_not_share_import_identity(self):
        one = self.asset()
        two = imports.enqueue('module', 'MOD2', {**self.component, 'id': 'COMP2'}, {**SCOPE, 'group_id': 'G2'})
        self.assertNotEqual(one.id, two.id)

    def test_reselecting_a_completed_source_reuses_its_stored_video(self):
        asset = self.asset()
        asset.status, asset.video_id = 'ready', VIDEO_ID
        asset.save()
        repeated = self.asset()
        self.assertEqual(repeated.id, asset.id)
        self.assertEqual(repeated.video_id, VIDEO_ID)
        self.assertEqual(repeated.status, 'ready')

    def test_inaccessible_source_does_not_create_an_empty_remote_video(self):
        with patch.object(imports, 'BunnyStream', return_value=self.client), \
             patch.object(imports, 'download_video', side_effect=VideoImportError('Source needs permission.')):
            result = imports.process(self.asset().id)
        self.assertEqual(result.status, 'failed')
        self.client.create.assert_not_called()

    def test_empty_or_already_bunny_source_is_not_queued(self):
        for source in ('', playback_url('798153', VIDEO_ID)):
            self.assertIsNone(imports.enqueue('module', 'MOD1', {**self.component, 'settings_json': {'videoUrl': source}}, SCOPE))

    def test_processing_does_not_replace_playable_source(self):
        self.client.video.return_value = {'status': 3}
        with patch.object(imports, 'BunnyStream', return_value=self.client), patch.object(imports, '_matches_current_source') as attach:
            asset = imports.process(self.asset().id)
        self.assertEqual(asset.status, 'processing')
        attach.assert_not_called()

    def test_uploaded_identity_is_reused_after_lost_upload_response(self):
        asset = self.asset()
        asset.video_id = VIDEO_ID
        asset.save()
        with patch.object(imports, 'BunnyStream', return_value=self.client), patch.object(imports, '_matches_current_source', return_value=True):
            result = imports.process(asset.id)
        self.assertEqual(result.status, 'ready')
        self.client.create.assert_not_called()
        self.client.upload.assert_not_called()

    def test_accepted_create_can_be_recovered_by_marker(self):
        self.client.find_import.return_value = {'guid': VIDEO_ID, 'status': 4}
        with patch.object(imports, 'BunnyStream', return_value=self.client), patch.object(imports, '_matches_current_source', return_value=True):
            result = imports.process(self.asset().id)
        self.assertEqual(result.video_id, VIDEO_ID)
        self.client.create.assert_not_called()

    def test_active_lease_prevents_concurrent_upload(self):
        asset = self.asset()
        asset.lease_until = timezone.now() + timedelta(minutes=10)
        asset.save()
        with patch.object(imports, 'BunnyStream') as client:
            imports.process(asset.id)
        client.assert_not_called()

    def test_expired_lease_can_recover_after_worker_exit(self):
        asset = self.asset()
        asset.lease_until = timezone.now() - timedelta(minutes=1)
        asset.video_id = VIDEO_ID
        asset.save()
        with patch.object(imports, 'BunnyStream', return_value=self.client), patch.object(imports, '_matches_current_source', return_value=True):
            self.assertEqual(imports.process(asset.id).status, 'ready')

    def test_provider_error_remains_visible_and_releases_lease(self):
        self.client.collection.side_effect = VideoImportError('Library permission denied.')
        with patch.object(imports, 'BunnyStream', return_value=self.client), patch.object(imports, '_matches_current_source') as attach:
            result = imports.process(self.asset().id)
        self.assertEqual(result.status, 'failed')
        self.assertEqual(result.error, 'Library permission denied.')
        self.assertIsNone(result.lease_until)
        attach.assert_not_called()

    def test_watch_link_never_creates_empty_bunny_video(self):
        self.component['settings_json']['videoUrl'] = 'https://www.youtube.com/watch?v=example'
        with patch.object(imports, 'BunnyStream') as client:
            result = imports.process(self.asset().id)
        self.assertEqual(result.status, 'failed')
        self.assertIn('YouTube link to one video', result.error)
        client.assert_not_called()

    def test_uploaded_mp4_retries_require_the_file_when_not_yet_uploaded(self):
        asset = imports.enqueue('module', 'MOD1', self.component, SCOPE, file_hash='hash')
        result = imports.process(asset.id)
        self.assertEqual(result.status, 'failed')
        self.assertIn('Choose the MP4', result.error)

    def test_superseded_source_does_not_report_ready(self):
        with patch.object(imports, 'BunnyStream', return_value=self.client), patch.object(imports, '_matches_current_source', return_value=False):
            result = imports.process(self.asset().id)
        self.assertEqual(result.status, 'superseded')
        self.assertNotIn('url', imports.public_asset(result))

    def test_completed_copy_preserves_source_and_all_component_settings(self):
        asset = self.asset()
        asset.video_id = VIDEO_ID
        asset.save()
        original = json.loads(json.dumps(self.component))
        views = Mock()
        with patch.object(imports, 'target', return_value=('components', [self.component], SCOPE)), \
             patch.object(imports, '_views', return_value=views), patch.object(imports, 'BunnyStream', return_value=self.client):
            result = imports.process(asset.id)
        self.assertEqual(result.status, 'ready')
        self.assertEqual(self.component, original)
        views.update_rows.assert_not_called()
        self.assertNotIn('url', imports.public_asset(result))
        self.assertEqual(imports.public_asset(result)['bunnyUrl'], playback_url('798153', VIDEO_ID))

    def test_source_changed_during_upload_is_not_overwritten(self):
        asset = self.asset()
        self.component['settings_json']['videoUrl'] = 'https://example.com/new.mp4'
        with patch.object(imports, 'target', return_value=('components', [self.component], SCOPE)):
            self.assertFalse(imports._matches_current_source(asset))
        self.assertEqual(self.component['settings_json']['videoUrl'], 'https://example.com/new.mp4')

    def test_newer_file_choice_does_not_report_previous_copy_as_current(self):
        asset = self.asset()
        imports.enqueue('module', 'MOD1', self.component, SCOPE, file_hash='new-file')
        with patch.object(imports, 'target', return_value=('components', [self.component], SCOPE)):
            self.assertFalse(imports._matches_current_source(asset))

    def test_active_lease_does_not_starve_other_pending_videos(self):
        leased = self.asset()
        leased.lease_until = timezone.now() + timedelta(minutes=10)
        leased.save()
        pending = imports.enqueue('module', 'MOD1', {**self.component, 'id': 'COMP2'}, SCOPE)
        with patch.object(imports, 'process') as process:
            self.assertEqual(imports.run_pending(limit=1), 1)
        process.assert_called_once_with(pending.id)

    def test_ordinary_title_edit_does_not_migrate_old_videos(self):
        request = RequestFactory().patch('/module/', '{}', content_type='application/json')
        def save(*args, **kwargs):
            self.component['title'] = 'New title'
            return JsonResponse({'saved': True})
        with patch.object(imports, 'enabled', return_value=True), patch.object(imports, 'target', return_value=('components', [self.component], SCOPE)), \
             patch('login.sessions.authenticate_request', return_value=SimpleNamespace(role='staff')):
            response = imports.tracked_save(save, 'module')(request, module_catalogue_id='MOD1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(CurriculumVideoImport.objects.count(), 0)

    def test_changed_video_is_queued_but_failed_save_is_not(self):
        request = RequestFactory().patch('/module/', '{}', content_type='application/json')
        def save(*args, **kwargs):
            self.component['settings_json']['videoUrl'] = 'https://example.com/new.mp4'
            return JsonResponse({'saved': True})
        with patch.object(imports, 'enabled', return_value=True), patch.object(imports, 'target', return_value=('components', [self.component], SCOPE)), \
             patch('login.sessions.authenticate_request', return_value=SimpleNamespace(role='staff')):
            imports.tracked_save(save, 'module')(request, module_catalogue_id='MOD1')
            self.component['settings_json']['videoUrl'] = 'https://example.com/third.mp4'
            imports.tracked_save(lambda *a, **k: JsonResponse({'error': 'conflict'}, status=409), 'module')(request, module_catalogue_id='MOD1')
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        self.assertEqual(CurriculumVideoImport.objects.get().source_url, 'https://example.com/new.mp4')

    def test_component_create_uses_saved_scope_without_backfilling_siblings(self):
        request = RequestFactory().post('/components/', '{}', content_type='application/json')
        views = Mock()
        views.authoring_fetch_all.return_value = []
        sibling = {**self.component, 'id': 'OLD'}
        result = JsonResponse({'created': True, 'component': {'id': 'COMP1', 'moduleCatalogueId': 'MOD1'}}, status=201)
        with patch.object(imports, 'enabled', return_value=True), patch.object(imports, '_views', return_value=views), \
             patch.object(imports, 'target', return_value=('components', [self.component, sibling], SCOPE)), \
             patch('login.sessions.authenticate_request', return_value=SimpleNamespace(role='staff')):
            response = imports.tracked_save(lambda *a, **k: result, 'component')(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(list(CurriculumVideoImport.objects.values_list('component_id', flat=True)), ['COMP1'])

    def test_legacy_module_create_keeps_original_response(self):
        request = RequestFactory().post('/modules/', '{}', content_type='application/json')
        result = JsonResponse({'created': True, 'module': {'id': 'LEGACY1'}}, status=201)
        with patch.object(imports, 'enabled', return_value=True), \
             patch.object(imports, 'target', side_effect=VideoImportError('No authoring module.')), \
             patch('login.sessions.authenticate_request', return_value=SimpleNamespace(role='staff')):
            response = imports.tracked_save(lambda *a, **k: result, 'module')(request)
        self.assertIs(response, result)
        self.assertEqual(CurriculumVideoImport.objects.count(), 0)

    def test_module_create_retry_does_not_backfill_existing_videos(self):
        request = RequestFactory().post('/modules/', '{}', content_type='application/json')
        result = JsonResponse({'existing': True, 'module': {'catalogueId': 'MOD1'}})
        with patch.object(imports, 'enabled', return_value=True), patch.object(imports, 'target') as target, \
             patch('login.sessions.authenticate_request', return_value=SimpleNamespace(role='staff')):
            response = imports.tracked_save(lambda *a, **k: result, 'module')(request)
        self.assertIs(response, result)
        target.assert_not_called()


class VideoImportScopeTests(TestCase):
    def test_template_prefix_uses_assigned_module_instead_of_week_title(self):
        views = Mock()
        views.AUTHORING_MODULES_TABLE = 'modules'
        views.WEEK_TEMPLATES_TABLE = 'templates'
        views.WEEK_TEMPLATE_COMPONENTS_TABLE = 'template_components'
        views.authoring_fetch_all.side_effect = [
            [{'id': 'W1', 'module_catalogue_id': 'MOD1', 'title': 'Week One', **SCOPE, 'group_id': ''}],
            [{'id': 'COMP1', 'type': 'video'}],
            [{'module_catalogue_id': 'MOD1', 'title': 'MSP'}],
        ]
        with patch.object(imports, '_views', return_value=views):
            _, _, scope = imports.target('template', 'W1')
        self.assertEqual(scope['module_title'], 'MSP')
        self.assertEqual(scope['template_title'], 'Week One')
        self.assertEqual(scope['module_id'], 'MOD1')
        views.authoring_fetch_all.assert_any_call('modules', 'module_catalogue_id = %s', ['MOD1'], ensure_tables=False)

    def test_module_scope_keeps_its_saved_title_and_programme(self):
        views = Mock()
        views.authoring_fetch_all.side_effect = [
            [{'module_catalogue_id': 'MOD1', 'title': 'MSP', **SCOPE}],
            [{'id': 'COMP1', 'type': 'video'}],
        ]
        with patch.object(imports, '_views', return_value=views):
            _, _, scope = imports.target('module', 'MOD1')
        self.assertEqual(scope['module_title'], 'MSP')
        self.assertEqual(scope['programme_id'], SCOPE['programme_id'])


class VideoImportAccessTests(TestCase):
    def request(self, method='get', **kwargs):
        request = getattr(RequestFactory(), method)('/video/', **kwargs)
        request._dont_enforce_csrf_checks = True
        return request

    def test_anonymous_and_other_roles_cannot_import(self):
        for role in (None, 'learner', 'coach', 'employer', 'tutor'):
            account = SimpleNamespace(role=role) if role else None
            with self.subTest(role=role), patch('login.permissions.authenticate_request', return_value=account), patch.object(imports, 'target') as target:
                response = imports.component_video(self.request(), 'module', 'MOD1', 'COMP1')
            self.assertEqual(response.status_code, 403 if role else 401)
            target.assert_not_called()

    def test_admin_and_staff_can_read_status(self):
        for role in ('admin', 'staff'):
            with self.subTest(role=role), patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role=role)), \
                 patch.object(imports, 'enabled', return_value=True), patch.object(imports, 'target', return_value=('components', [{'id': 'COMP1'}], SCOPE)):
                response = imports.component_video(self.request(), 'module', 'MOD1', 'COMP1')
            self.assertEqual(response.status_code, 200)

    def test_post_requires_csrf(self):
        request = RequestFactory().post('/video/')
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')), patch.object(imports, 'target') as target:
            response = imports.component_video(request, 'module', 'MOD1', 'COMP1')
        self.assertEqual(response.status_code, 403)
        target.assert_not_called()

    def test_client_cannot_override_programme_scope(self):
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
             patch.object(imports, 'enabled', return_value=True), patch.object(imports, 'target', return_value=('components', [{'id': 'COMP1'}], SCOPE)), patch.object(imports, 'enqueue') as enqueue:
            response = imports.component_video(self.request('post', data={'programme_id': 'OTHER'}), 'module', 'MOD1', 'COMP1')
        self.assertEqual(response.status_code, 400)
        enqueue.assert_not_called()

    def test_device_upload_returns_the_saved_lms_source_without_waiting_for_bunny(self):
        component = {'id': 'COMP1', 'settings_json': {}}
        url = '/curriculum_api/curriculum/uploads/videos/module/MOD1/COMP1/hash.mp4'
        asset = imports.enqueue('module', 'MOD1', {**component, 'settings_json': {'videoUrl': url}}, SCOPE)
        saved = {'videoUrl': url, 'sourceType': 'HTML (MP4)', 'provider': 'Upload file', 'embedCode': ''}
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
             patch.object(imports, 'enabled', return_value=True), \
             patch.object(imports, 'target', return_value=('components', [component], SCOPE)), \
             patch.object(imports, 'save_mp4', return_value=(asset, saved)), \
             patch.object(imports, 'BunnyStream') as bunny:
            response = imports.component_video(self.request('post', data={
                'file': SimpleUploadedFile('lesson.mp4', MP4, content_type='video/mp4'),
            }), 'module', 'MOD1', 'COMP1')
        self.assertEqual(response.status_code, 202)
        self.assertEqual(json.loads(response.content)['savedSettings'], saved)
        bunny.assert_not_called()

    def test_invalid_file_does_not_persist_a_source(self):
        for name, content in [('video.html', MP4), ('video.mp4', b'<html>not a video</html>')]:
            with self.subTest(name=name), \
                 patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
                 patch.object(imports, 'enabled', return_value=True), \
                 patch.object(imports, 'target', return_value=('components', [{'id': 'COMP1'}], SCOPE)), \
                 patch.object(imports, 'save_mp4') as save:
                response = imports.component_video(self.request('post', data={
                    'file': SimpleUploadedFile(name, content),
                }), 'module', 'MOD1', 'COMP1')
                self.assertEqual(response.status_code, 400)
                save.assert_not_called()

    def test_local_video_resolver_rejects_arbitrary_files_and_remote_addresses(self):
        prefix = '/curriculum_api/curriculum/uploads/'
        for source in (prefix + '../private.mp4', prefix + 'videos/module/M/C/../../secret.mp4',
                       prefix + 'videos/module/M/C/test.mp4?token=x', prefix + 'slides/document.mp4',
                       'https://example.com' + prefix + 'videos/module/M/C/test.mp4',
                       'file:///private.mp4', prefix + 'videos/module/M/C/%2e%2e.mp4'):
            self.assertIsNone(stored_video_path(source))
        self.assertEqual(stored_video_path(prefix + 'videos/module/M/C/hash.mp4'),
                         'curriculum_component_uploads/videos/module/M/C/hash.mp4')

    def test_saved_mp4_survives_authoring_validation_and_learner_source_mapping(self):
        from .views import validate_component_authoring_payload
        from learner_api.learner_detail import _video_url_from_settings
        url = '/curriculum_api/curriculum/uploads/videos/module/M1/C1/hash.mp4'
        component = {'type': 'video', 'title': 'Lesson', 'settings': {
            'sourceType': 'HTML (MP4)', 'provider': 'Upload file', 'videoUrl': url,
            'requiredProgressPercentage': 80, 'lessonContent': 'Keep this',
        }}
        for status in ('Draft', 'Ready for QA', 'Approved'):
            component['settings']['contentStatus'] = status
            self.assertEqual(validate_component_authoring_payload(component, 'component'), [])
            self.assertEqual(_video_url_from_settings(component['settings']), url)
            self.assertEqual(component['settings']['requiredProgressPercentage'], 80)

    def test_other_video_sources_keep_their_existing_validation(self):
        from .views import validate_component_authoring_payload
        for source_type, url in [('HTML (MP4)', '/private/file.mp4'), ('HTML (MP4)', 'file:///secret.mp4'),
                                 ('External Link', '/curriculum_api/curriculum/uploads/videos/module/M/C/hash.mp4'),
                                 ('YouTube', '/curriculum_api/curriculum/uploads/videos/module/M/C/hash.mp4')]:
            errors = validate_component_authoring_payload({'title': 'Lesson', 'type': 'video', 'settings': {
                'sourceType': source_type, 'videoUrl': url,
            }}, 'component')
            self.assertTrue(any(error['path'] == 'component.settings.videoUrl' for error in errors))
