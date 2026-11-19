"""Actual database triggers/transactions; run with run_video_postgres_tests."""
import importlib
import io
import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from types import SimpleNamespace
from tempfile import TemporaryDirectory
from threading import Event
import unittest
from unittest.mock import Mock, patch

from django.db import connection, connections, transaction
from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import JsonResponse
from django.test import RequestFactory, override_settings

from . import video_imports as imports
from .models import CurriculumVideoChange, CurriculumVideoImport
from .video_changes import capture_pending
from . import video_uploads
from .bunny_stream import VideoImportError


SOURCE = 'https://example.com/lesson.mp4'


def sql(statement, params=()):
    with connection.cursor() as cursor:
        cursor.execute(statement, params)
        return cursor.fetchall() if cursor.description else None


def fetch(table, where, params, **kwargs):
    assert kwargs['ensure_tables'] is False
    assert table in ('components', 'modules', 'groups', 'week_templates', 'week_template_components')
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT * FROM curriculum.{table} WHERE {where}', params)
        names = [c[0] for c in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]


class VideoPostgresFixture:
    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql')
        CurriculumVideoChange.objects.all().delete()
        CurriculumVideoImport.objects.all().delete()
        sql("DELETE FROM curriculum.components WHERE id <> 'PRE-EXISTING'")
        for table in ('week_template_components', 'week_templates', 'modules', 'groups'):
            sql(f'DELETE FROM curriculum.{table}')
        sql('''INSERT INTO curriculum.modules
            (module_catalogue_id,title,programme_id,programme_name,cohort_id,cohort_name,group_id,group_name)
            VALUES ('MOD1','MSP','PROG-PCP-L6','Project Controls Professional Level 6','C1','Synthetic cohort','G1','Synthetic group')''')
        views = SimpleNamespace(AUTHORING_MODULES_TABLE='modules', AUTHORING_COMPONENTS_TABLE='components',
                                WEEK_TEMPLATES_TABLE='week_templates', WEEK_TEMPLATE_COMPONENTS_TABLE='week_template_components',
                                GROUPS_TABLE='groups', authoring_fetch_all=fetch,
                                authoring_table_name=lambda name: f'curriculum.{name}',
                                invalidate_curriculum_cache=Mock())
        for patcher in (patch.object(imports, 'enabled', return_value=True), patch.object(imports, '_views', return_value=views)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def insert(self, component='NEW', *, kind='video', source=SOURCE):
        sql('''INSERT INTO curriculum.components (id,module_catalogue_id,type,title,settings_json)
            VALUES (%s,'MOD1',%s,'Synthetic lesson',%s::jsonb)''',
            [component, kind, json.dumps({'videoUrl': source, 'requiredProgressPercentage': 80})])


class VideoChangePostgresTests(VideoPostgresFixture, unittest.TestCase):
    def test_free_course_sql_write_uses_course_collection_without_placement(self):
        sql("""UPDATE curriculum.modules SET source_type='free_course', title='Independent study',
            programme_id='', programme_name='', cohort_id='', cohort_name='', group_id='', group_name=''
            WHERE module_catalogue_id='MOD1'""")
        self.insert()
        client = Mock()
        client.free_course_collection.return_value = 'shared-free-collection'
        client.find_import.return_value = None
        client.create.return_value = {'guid': '12345678-1234-1234-1234-123456789abc'}
        client.video.return_value = {'status': 4}
        with patch.object(imports, 'BunnyStream', return_value=client), patch.object(imports, 'download_video',
                side_effect=lambda _: nullcontext(io.BytesIO(b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64))):
            self.assertEqual(imports.run_pending(), 1)
        asset = CurriculumVideoImport.objects.get()
        self.assertEqual(asset.status, 'ready')
        self.assertEqual(asset.scope['free_course_name'], 'Independent study')
        client.free_course_collection.assert_called_once_with()
        self.assertEqual(asset.scope['course_type'], 'free_course')
        self.assertEqual(asset.collection_id, 'shared-free-collection')
        client.collection.assert_not_called()
        client.upload.assert_called_once()
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], SOURCE)

    def test_concurrent_imports_from_different_courses_share_one_collection(self):
        assets = [imports.enqueue('module', course, {'id': component, 'settings_json': {'videoUrl': SOURCE}},
                  {'free_course_module_id': course, 'free_course_name': name,
                   'course_type': 'free_course', 'collection_name': 'Free course'})
                  for course, name, component in [('MOD1', 'Independent study', 'ONE'), ('MOD2', 'Other course', 'TWO')]]
        creating, release, second_select = Event(), Event(), Event()
        client = Mock()
        def create():
            creating.set()
            if not release.wait(5):
                raise AssertionError('Collection create was not released')
            return 'one-collection'
        client.free_course_collection.side_effect = create
        def worker(asset, second=False):
            def executing(execute, query, params, many, context):
                if second and 'FOR UPDATE' in query:
                    second_select.set()
                return execute(query, params, many, context)
            try:
                with connection.execute_wrapper(executing):
                    return imports._import_collection(asset, client)
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(worker, assets[0])
            try:
                self.assertTrue(creating.wait(5))
                second = pool.submit(worker, assets[1], True)
                self.assertTrue(second_select.wait(5))
                self.assertFalse(second.done())
            finally:
                release.set()
            self.assertEqual(first.result(timeout=10), 'one-collection')
            self.assertEqual(second.result(timeout=10), 'one-collection')
        client.free_course_collection.assert_called_once_with()

    def test_new_sql_video_reaches_bunny_without_an_api_request(self):
        self.insert()
        client = Mock()
        client.collection.return_value = 'existing-PCP-collection'
        client.find_import.return_value = None
        client.create.return_value = {'guid': '12345678-1234-1234-1234-123456789abc'}
        client.video.return_value = {'status': 4}
        with patch.object(imports, 'BunnyStream', return_value=client), patch.object(imports, 'download_video',
                side_effect=lambda _: nullcontext(io.BytesIO(b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64))):
            self.assertEqual(imports.run_pending(), 1)
        asset = CurriculumVideoImport.objects.get()
        self.assertEqual(asset.status, 'ready')
        self.assertEqual((asset.scope['programme_id'], asset.scope['cohort_id'], asset.scope['group_id']), ('PROG-PCP-L6','C1','G1'))
        client.upload.assert_called_once()
        client.create.assert_called_once()
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], SOURCE)
        self.assertEqual(imports.run_pending(), 0)

    def test_unchanged_historical_video_is_not_backfilled(self):
        self.assertEqual(sql("SELECT count(*) FROM curriculum.components WHERE id='PRE-EXISTING'")[0][0], 1)
        sql("UPDATE curriculum.components SET title='Title only' WHERE id='PRE-EXISTING'")
        self.assertEqual(capture_pending(), 0)
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_source_change_detected_even_without_updated_at(self):
        sql("UPDATE curriculum.components SET settings_json=%s::jsonb WHERE id='PRE-EXISTING'", [json.dumps({'videoUrl': SOURCE})])
        self.assertEqual(capture_pending(), 1)
        self.assertEqual(CurriculumVideoImport.objects.get().source_url, SOURCE)
        sql("UPDATE curriculum.components SET settings_json=%s::jsonb WHERE id='PRE-EXISTING'", [json.dumps({'videoUrl': 'https://example.com/old.mp4'})])
        capture_pending()

    def test_nonvideo_empty_source_and_unrelated_settings_do_not_queue(self):
        self.insert('READING', kind='reading')
        self.insert('EMPTY', source='')
        sql("UPDATE curriculum.components SET settings_json=settings_json || '{\"requiredProgressPercentage\":90}'::jsonb WHERE id='PRE-EXISTING'")
        self.assertFalse(CurriculumVideoChange.objects.exists())

    def test_video_type_conversion_and_late_parent_assignment_are_detected(self):
        self.insert(kind='reading')
        sql("UPDATE curriculum.components SET type='video' WHERE id='NEW'")
        self.assertEqual(capture_pending(), 1)
        sql("INSERT INTO curriculum.components(id,type,settings_json) VALUES ('LATE','video',%s::jsonb)", [json.dumps({'videoUrl': SOURCE})])
        self.assertFalse(CurriculumVideoChange.objects.exists())
        sql("UPDATE curriculum.components SET module_catalogue_id='MOD1' WHERE id='LATE'")
        self.assertEqual(capture_pending(), 1)
        self.assertEqual(CurriculumVideoImport.objects.count(), 2)

    def test_transaction_rollback_does_not_leave_an_event(self):
        with self.assertRaisesRegex(RuntimeError, 'rollback'):
            with transaction.atomic():
                self.insert()
                self.assertEqual(CurriculumVideoChange.objects.count(), 1)
                raise RuntimeError('rollback')
        self.assertFalse(CurriculumVideoChange.objects.exists())
        self.assertEqual(sql("SELECT count(*) FROM curriculum.components WHERE id='NEW'")[0][0], 0)

    def test_events_are_invisible_until_commit(self):
        def count_elsewhere():
            try:
                return CurriculumVideoChange.objects.count()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                self.insert()
                self.assertEqual(pool.submit(count_elsewhere).result(timeout=10), 0)
            self.assertEqual(pool.submit(count_elsewhere).result(timeout=10), 1)

    def test_week_template_sql_write_uses_its_programme_and_module(self):
        sql("INSERT INTO curriculum.groups VALUES ('G1','C1','Synthetic cohort')")
        sql('''INSERT INTO curriculum.week_templates(id,title,module_catalogue_id,programme_id,programme_name,group_id)
            VALUES ('W1','Week One','MOD1','PROG-PCP-L6','Project Controls Professional Level 6','G1')''')
        sql('''INSERT INTO curriculum.week_template_components(id,week_template_id,type,title,settings_json)
            VALUES ('T1','W1','video','Template lesson',%s::jsonb)''', [json.dumps({'embedCode': f'<iframe src="{SOURCE}"></iframe>'})])
        capture_pending()
        asset = CurriculumVideoImport.objects.get()
        self.assertEqual((asset.target_kind, asset.target_id, asset.scope['module_title']), ('template','W1','MSP'))
        self.assertEqual((asset.scope['cohort_id'], asset.scope['group_id']), ('C1','G1'))

    def test_worker_can_skip_event_locked_by_another_worker(self):
        self.insert('ONE')
        self.insert('TWO')
        first = CurriculumVideoChange.objects.order_by('id').first()
        def worker():
            try:
                return capture_pending(1)
            finally:
                connections.close_all()
        with transaction.atomic(), ThreadPoolExecutor(max_workers=1) as pool:
            CurriculumVideoChange.objects.select_for_update().get(pk=first.pk)
            self.assertEqual(pool.submit(worker).result(timeout=10), 1)
        self.assertEqual(CurriculumVideoImport.objects.get().component_id, 'TWO')
        capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.count(), 2)

    def test_database_writer_needs_no_new_privileges_or_network_access(self):
        sql('CREATE ROLE bunny_fixture_writer NOLOGIN')
        try:
            sql('GRANT USAGE ON SCHEMA curriculum TO bunny_fixture_writer')
            sql('GRANT INSERT ON curriculum.components TO bunny_fixture_writer')
            with transaction.atomic():
                sql('SET LOCAL ROLE bunny_fixture_writer')
                self.insert()
            self.assertEqual(CurriculumVideoChange.objects.count(), 1)
        finally:
            sql('REVOKE ALL ON curriculum.components FROM bunny_fixture_writer')
            sql('REVOKE ALL ON SCHEMA curriculum FROM bunny_fixture_writer')
            sql('DROP ROLE bunny_fixture_writer')

    def test_reinstall_does_not_seed_existing_videos(self):
        migration = importlib.import_module('curriculum_api.migrations.0078_curriculum_video_changes')
        with connection.schema_editor() as editor:
            migration.uninstall(None, editor)
            migration.install(None, editor)
        self.assertFalse(CurriculumVideoChange.objects.exists())
        self.insert()
        self.assertEqual(CurriculumVideoChange.objects.count(), 1)


class VideoSavePostgresTests(VideoPostgresFixture, unittest.TestCase):
    def request(self):
        return RequestFactory().patch('/', json.dumps({
            'importVideoComponentIds': ['NEW', 'OTHER-MODULE'],
        }), content_type='application/json')

    def test_save_queues_selected_video_after_commit_and_reuses_trigger_import(self):
        self.insert()
        capture_pending()
        asset = CurriculumVideoImport.objects.get()
        asset.status, asset.error = 'failed', 'Temporary failure'
        asset.save(update_fields=['status', 'error'])
        with patch('login.sessions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
                patch.object(imports, 'wake_worker') as wake:
            with transaction.atomic():
                response = imports.tracked_save(lambda *_args, **_kwargs: JsonResponse({'saved': True}), 'module')(
                    self.request(), module_catalogue_id='MOD1')
                self.assertEqual(response.status_code, 200)
                wake.assert_not_called()
            wake.assert_called_once_with()
        asset.refresh_from_db()
        self.assertEqual((asset.status, asset.error), ('queued', ''))
        self.assertEqual(list(CurriculumVideoImport.objects.values_list('component_id', flat=True)), ['NEW'])
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], SOURCE)
        self.assertFalse(CurriculumVideoChange.objects.exists())

    def test_queue_failure_rolls_back_saved_source_and_trigger_event(self):
        self.insert()
        CurriculumVideoChange.objects.all().delete()

        def save_view(*_args, **_kwargs):
            sql("UPDATE curriculum.components SET settings_json=jsonb_set(settings_json, '{videoUrl}', %s::jsonb) WHERE id='NEW'",
                [json.dumps('https://example.com/replacement.mp4')])
            return JsonResponse({'saved': True})

        with patch('login.sessions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
                patch.object(imports, 'enqueue_saved_video', side_effect=RuntimeError('Queue unavailable')), \
                patch.object(imports, 'wake_worker') as wake:
            with self.assertRaisesRegex(RuntimeError, 'Queue unavailable'):
                imports.tracked_save(save_view, 'module')(self.request(), module_catalogue_id='MOD1')
            wake.assert_not_called()
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], SOURCE)
        self.assertFalse(CurriculumVideoChange.objects.exists())
        self.assertFalse(CurriculumVideoImport.objects.exists())


class VideoUploadPostgresTests(VideoPostgresFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        for patcher in (override_settings(MEDIA_ROOT=self.directory.name),
                        patch.object(video_uploads.upload_storage, 'azure_enabled', return_value=False)):
            patcher.enable() if hasattr(patcher, 'enable') else patcher.start()
            self.addCleanup(patcher.disable if hasattr(patcher, 'disable') else patcher.stop)

    def upload(self, kind='module', target='MOD1', component='NEW'):
        _, rows, scope = imports.target(kind, target)
        row = next(row for row in rows if row['id'] == component)
        return video_uploads.save_mp4(kind, target, row, scope, SimpleUploadedFile(
            'lesson.mp4', b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64, content_type='video/mp4'))

    def test_upload_is_playable_and_preserves_settings_before_bunny_runs(self):
        self.insert(source='')
        self.insert('OTHER')
        sql("UPDATE curriculum.components SET settings_json=settings_json || '{\"lessonContent\":\"Keep me\",\"embedCode\":\"\"}'::jsonb WHERE id='NEW'")
        asset, updates = self.upload()
        saved = imports._settings({'settings_json': sql("SELECT settings_json FROM curriculum.components WHERE id='NEW'")[0][0]})
        self.assertEqual(saved['videoUrl'], updates['videoUrl'])
        self.assertEqual((saved['sourceType'], saved['provider']), ('HTML (MP4)', 'Upload file'))
        self.assertEqual((saved['lessonContent'], saved['requiredProgressPercentage']), ('Keep me', 80))
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='OTHER'")[0][0], SOURCE)
        with video_uploads.stored_video(saved['videoUrl']) as handle:
            self.assertEqual(handle.read(12), b'\x00\x00\x00\x20ftypisom')
        # Use the real existing HTTP range serving code with the stored file.
        from .views import curriculum_uploaded_file
        response = curriculum_uploaded_file(RequestFactory().get('/', HTTP_RANGE='bytes=0-11'),
            saved['videoUrl'].removeprefix(video_uploads.upload_storage.UPLOAD_URL_PREFIX))
        self.assertEqual((response.status_code, response['Content-Type']), (206, 'video/mp4'))
        self.assertEqual(b''.join(response.streaming_content), b'\x00\x00\x00\x20ftypisom')
        capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.filter(component_id='NEW').count(), 1)
        client = Mock()
        client.collection.return_value = 'collection'
        client.find_import.return_value = None
        client.create.return_value = {'guid': '12345678-1234-1234-1234-123456789abc'}
        client.video.return_value = {'status': 4}
        with patch.object(imports, 'BunnyStream', return_value=client), patch.object(imports, 'download_video') as remote:
            result = imports.process(asset.id)
        self.assertEqual(result.status, 'ready')
        client.upload.assert_called_once()
        remote.assert_not_called()
        repeated, repeated_updates = self.upload()
        self.assertEqual((repeated.id, repeated_updates['videoUrl']), (asset.id, saved['videoUrl']))
        self.assertEqual(repeated.status, 'ready')

    def test_bunny_failure_does_not_remove_playback_and_retries_read_the_saved_file(self):
        self.insert(source='')
        asset, updates = self.upload()
        client = Mock()
        client.collection.side_effect = VideoImportError('Storage unavailable.')
        with patch.object(imports, 'BunnyStream', return_value=client):
            result = imports.process(asset.id)
        self.assertEqual(result.status, 'failed')
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], updates['videoUrl'])
        with video_uploads.stored_video(updates['videoUrl']) as handle:
            self.assertGreater(len(handle.read()), 0)
        client.collection.side_effect = None
        client.collection.return_value = 'collection'
        client.find_import.return_value = None
        client.create.return_value = {'guid': '12345678-1234-1234-1234-123456789abc'}
        client.video.return_value = {'status': 4}
        with patch.object(imports, 'BunnyStream', return_value=client):
            self.assertEqual(imports.process(asset.id).status, 'ready')

    def test_template_upload_saves_the_template_source_only(self):
        self.insert()
        sql("INSERT INTO curriculum.week_templates(id,title,module_catalogue_id,programme_id) VALUES ('W1','Week','MOD1','PROG-PCP-L6')")
        sql("INSERT INTO curriculum.week_template_components(id,week_template_id,type,settings_json) VALUES ('T1','W1','video','{\"requiredProgressPercentage\":90}')")
        asset, updates = self.upload('template', 'W1', 'T1')
        saved = imports._settings({'settings_json': sql("SELECT settings_json FROM curriculum.week_template_components WHERE id='T1'")[0][0]})
        self.assertEqual(saved['videoUrl'], updates['videoUrl'])
        self.assertEqual(saved['requiredProgressPercentage'], 90)
        self.assertEqual(asset.target_kind, 'template')
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], SOURCE)

    def test_source_changed_during_file_storage_is_not_overwritten(self):
        self.insert()
        changed = 'https://example.com/new.mp4'
        def store(_file, path, _type):
            sql("UPDATE curriculum.components SET settings_json=jsonb_set(settings_json,'{videoUrl}',%s::jsonb) WHERE id='NEW'", [json.dumps(changed)])
            return path
        with patch.object(video_uploads.upload_storage, 'store', side_effect=store), \
             self.assertRaisesRegex(VideoImportError, 'source changed'):
            self.upload()
        self.assertFalse(CurriculumVideoImport.objects.exists())
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], changed)

    def test_storage_failure_leaves_the_previous_video_and_queue_unchanged(self):
        self.insert()
        with patch.object(video_uploads.upload_storage, 'store', side_effect=RuntimeError('private transport failure')), \
             self.assertRaisesRegex(VideoImportError, 'could not be saved'):
            self.upload()
        self.assertFalse(CurriculumVideoImport.objects.exists())
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], SOURCE)

    def test_unrelated_edit_during_upload_is_preserved(self):
        self.insert()
        store = video_uploads.upload_storage.store
        def edit_and_store(file, path, content_type):
            sql("UPDATE curriculum.components SET settings_json=jsonb_set(settings_json,'{lessonContent}','\"New content\"') WHERE id='NEW'")
            return store(file, path, content_type)
        with patch.object(video_uploads.upload_storage, 'store', side_effect=edit_and_store):
            self.upload()
        self.assertEqual(sql("SELECT settings_json->>'lessonContent' FROM curriculum.components WHERE id='NEW'")[0][0], 'New content')

    def test_scope_change_during_upload_refuses_to_attach_the_file(self):
        self.insert()
        def change_scope(_file, path, _content_type):
            sql("UPDATE curriculum.modules SET group_id='OTHER' WHERE module_catalogue_id='MOD1'")
            return path
        with patch.object(video_uploads.upload_storage, 'store', side_effect=change_scope), \
             self.assertRaisesRegex(VideoImportError, 'scope changed'):
            self.upload()
        self.assertFalse(CurriculumVideoImport.objects.exists())
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], SOURCE)

    def test_queue_failure_rolls_back_the_component_source(self):
        self.insert()
        with patch.object(imports, 'enqueue', side_effect=RuntimeError('queue failed')), self.assertRaises(RuntimeError):
            self.upload()
        self.assertEqual(sql("SELECT settings_json->>'videoUrl' FROM curriculum.components WHERE id='NEW'")[0][0], SOURCE)
