"""Physical upload writes on isolated SQLite tables; storage/Bunny are mocked."""
import io
import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction
from django.test import RequestFactory, TestCase

from . import learning_storage as storage, video_imports as imports, video_uploads as uploads
from .bunny_stream import VideoImportError
from .models import CurriculumVideoImport

MP4 = b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64


class VideoUploadStorageTests(TestCase):
    def sql(self, statement, params=()):
        with connection.cursor() as cursor:
            cursor.execute(statement, params)
            if cursor.description:
                names = [column[0] for column in cursor.description]
                return [dict(zip(names, row)) for row in cursor.fetchall()]

    def setUp(self):
        self.assertEqual(connection.vendor, 'sqlite')
        self.assertEqual(connection.settings_dict['NAME'], ':memory:')
        # Public content references deliberately differ from physical row IDs.
        statements = [
            '''CREATE TABLE free_courses (id text PRIMARY KEY, content_ref text UNIQUE,
                course_name text, converted_at text, deleted_at text)''',
            '''CREATE TABLE free_course_weeks (id text PRIMARY KEY, course_id text)''',
            '''CREATE TABLE free_programme_components (id text PRIMARY KEY, content_ref text UNIQUE,
                free_module_id text, type text, title text, settings_json text, deleted_at text)''',
            '''CREATE TABLE modules (module_catalogue_id text PRIMARY KEY, title text,
                source_type text, programme_id text, programme_name text, cohort_id text, group_id text)''',
            '''CREATE TABLE components (id text PRIMARY KEY, module_catalogue_id text,
                type text, title text, settings_json text, deleted_at text)''',
            '''CREATE TABLE week_templates (id text PRIMARY KEY, title text, module_catalogue_id text,
                programme_id text, programme_name text, cohort_id text, group_id text)''',
            '''CREATE TABLE week_template_components (id text PRIMARY KEY, week_template_id text,
                type text, title text, settings_json text, deleted_at text)''',
            '''CREATE VIEW free_authoring_modules AS SELECT content_ref AS module_catalogue_id,
                course_name AS title, 'free_course' AS source_type, '' AS programme_id,
                '' AS programme_name, '' AS cohort_id, '' AS group_id FROM free_courses
                WHERE converted_at IS NULL AND deleted_at IS NULL''',
            '''CREATE VIEW free_authoring_components AS SELECT c.content_ref AS id,
                f.content_ref AS module_catalogue_id, c.type, c.title, c.settings_json, c.deleted_at
                FROM free_programme_components c JOIN free_course_weeks w ON w.id=c.free_module_id
                JOIN free_courses f ON f.id=w.course_id WHERE f.converted_at IS NULL''',
            '''CREATE VIEW learning_courses AS SELECT * FROM modules UNION ALL SELECT * FROM free_authoring_modules''',
            '''CREATE VIEW learning_components AS SELECT * FROM components UNION ALL SELECT * FROM free_authoring_components''',
        ]
        for statement in statements:
            self.sql(statement)
        for physical, reference in [('COURSE-ROW', 'FREE1'), ('OTHER-ROW', 'OTHER')]:
            self.sql('INSERT INTO free_courses VALUES (%s,%s,%s,NULL,NULL)', [physical, reference, 'Independent study'])
            self.sql('INSERT INTO free_course_weeks VALUES (%s,%s)', ['W-' + reference, physical])
        self.original = {'videoUrl': '', 'requiredProgressPercentage': 80, 'lessonContent': 'Keep this'}
        for physical, reference, week in [('COMP-ROW', 'VIDEO1', 'W-FREE1'), ('SIBLING-ROW', 'VIDEO2', 'W-OTHER')]:
            self.sql('INSERT INTO free_programme_components VALUES (%s,%s,%s,%s,%s,%s,NULL)',
                     [physical, reference, week, 'video', 'Lesson', json.dumps(self.original)])
        self.sql("INSERT INTO modules VALUES ('MOD1','Placed course','module_authoring','P1','Programme','C1','G1')")
        self.sql('INSERT INTO components VALUES (%s,%s,%s,%s,%s,NULL)',
                 ['ORDINARY', 'MOD1', 'video', 'Ordinary video', json.dumps(self.original)])
        self.sql("INSERT INTO week_templates VALUES ('TPL1','Week template','MOD1','P1','Programme','C1','')")
        self.sql('INSERT INTO week_template_components VALUES (%s,%s,%s,%s,%s,NULL)',
                 ['TEMPLATE-VIDEO', 'TPL1', 'video', 'Template video', json.dumps(self.original)])

        def course(reference, *, lock=False):
            rows = self.sql('SELECT * FROM free_courses WHERE content_ref=%s AND converted_at IS NULL', [reference])
            return rows[0] if rows else None

        def fetch(table, where, params, **kwargs):
            self.assertFalse(kwargs['ensure_tables'])
            if table in ('modules', 'components'):
                table = ('free_authoring_' + table) if storage.native_only() else {
                    'modules': 'learning_courses', 'components': 'learning_components'}[table]
            return self.sql(f'SELECT * FROM {table} WHERE {where}', params)

        self.views = SimpleNamespace(
            AUTHORING_MODULES_TABLE='modules', AUTHORING_COMPONENTS_TABLE='components',
            WEEK_TEMPLATES_TABLE='week_templates', WEEK_TEMPLATE_COMPONENTS_TABLE='week_template_components',
            authoring_fetch_all=fetch, authoring_table_name=lambda name: f'"{name}"',
            invalidate_curriculum_cache=Mock(),
        )
        self.enterContext(patch.object(imports, '_views', return_value=self.views))
        self.owner = self.enterContext(patch.object(storage, 'course', side_effect=course))
        self.enterContext(patch.object(uploads.upload_storage, 'exists', return_value=False))
        self.store = self.enterContext(patch.object(uploads.upload_storage, 'store', side_effect=lambda _file, path, _type: path))

    def upload(self, kind='module', target='FREE1', component='VIDEO1'):
        _, rows, scope = imports.target(kind, target)
        row = next(row for row in rows if row['id'] == component)
        return uploads.save_mp4(kind, target, row, scope,
            SimpleUploadedFile('lesson.mp4', MP4, content_type='video/mp4'))

    def saved(self, table='free_programme_components', identifier='COMP-ROW'):
        return json.loads(self.sql(f'SELECT settings_json FROM {table} WHERE id=%s', [identifier])[0]['settings_json'])

    def test_native_upload_saves_only_its_free_component_and_queues_shared_bunny_collection(self):
        queries = []
        def capture(execute, sql, params, many, context):
            queries.append(sql)
            return execute(sql, params, many, context)
        with connection.execute_wrapper(capture):
            asset, saved = self.upload()
        self.assertEqual(self.saved(), {**self.original, **saved})
        self.assertEqual(self.saved(identifier='SIBLING-ROW'), self.original)
        self.assertEqual(self.saved('components', 'ORDINARY'), self.original)
        self.assertFalse(any('"components"' in sql or 'learning_components' in sql or 'learning_courses' in sql for sql in queries))
        self.owner.assert_any_call('FREE1', lock=True)
        self.assertFalse(storage.native_only())
        self.assertEqual(asset.status, 'queued')
        self.assertEqual(asset.source_url, saved['videoUrl'])
        self.assertEqual(asset.scope['collection_name'], 'Free course')
        self.assertEqual(asset.scope['free_course_name'], 'Independent study')
        self.assertEqual(asset.scope['course_type'], 'free_course')
        bunny = Mock()
        bunny.free_course_collection.return_value = 'shared-free-collection'
        bunny.find_import.return_value = None
        bunny.create.return_value = {'guid': 'c1c2c3c4-1234-5678-abcd-123456789abc'}
        bunny.video.return_value = {'status': 4}
        with patch.object(imports, 'BunnyStream', return_value=bunny), \
             patch.object(imports, 'stored_video', side_effect=lambda _: nullcontext(io.BytesIO(MP4))):
            self.assertEqual(imports.process(asset.pk).status, 'ready')
        bunny.free_course_collection.assert_called_once_with()
        bunny.collection.assert_not_called()
        self.assertEqual(self.saved()['videoUrl'], saved['videoUrl'])

    def test_retry_reuses_file_and_import_and_clears_a_failed_queue_status(self):
        first, _ = self.upload()
        first.status, first.error = 'failed', 'Temporary Bunny failure'
        first.save()
        with patch.object(uploads.upload_storage, 'exists', return_value=True):
            second, _ = self.upload()
        self.assertEqual(first.pk, second.pk)
        self.assertEqual((second.status, second.error), ('queued', ''))
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        self.store.assert_called_once()

    def test_upload_endpoint_returns_saved_free_source_then_wakes_worker_after_commit(self):
        request = RequestFactory().post('/video/', {
            'file': SimpleUploadedFile('lesson.mp4', MP4, content_type='video/mp4'),
        })
        request._dont_enforce_csrf_checks = True
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
             patch.object(imports, 'enabled', return_value=True), \
             patch.object(imports, 'wake_worker') as wake, \
             patch.object(imports, 'BunnyStream') as bunny:
            with self.captureOnCommitCallbacks(execute=True):
                response = imports.component_video(request, 'module', 'FREE1', 'VIDEO1')
                wake.assert_not_called()
            wake.assert_called_once_with()
            bunny.assert_not_called()
        self.assertEqual(response.status_code, 202)
        data = json.loads(response.content)
        self.assertEqual(data['savedSettings']['videoUrl'], self.saved()['videoUrl'])
        self.assertEqual(data['import']['status'], 'queued')

    def test_concurrent_source_change_is_refused_without_overwriting_it(self):
        replacement = {**self.original, 'videoUrl': 'https://example.com/new.mp4'}
        def replace(_file, path, _type):
            self.sql('UPDATE free_programme_components SET settings_json=%s WHERE id=%s', [json.dumps(replacement), 'COMP-ROW'])
            return path
        self.store.side_effect = replace
        with self.assertRaisesRegex(VideoImportError, 'source changed'):
            self.upload()
        self.assertEqual(self.saved(), replacement)
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_component_moved_to_another_course_is_refused(self):
        def move(_file, path, _type):
            self.sql("UPDATE free_programme_components SET free_module_id='W-OTHER' WHERE id='COMP-ROW'")
            return path
        self.store.side_effect = move
        with self.assertRaisesRegex(VideoImportError, 'scope changed'):
            self.upload()
        self.assertEqual(self.saved(), self.original)
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_deleted_component_is_refused(self):
        def delete(_file, path, _type):
            self.sql("UPDATE free_programme_components SET deleted_at='2026-01-01' WHERE id='COMP-ROW'")
            return path
        self.store.side_effect = delete
        with self.assertRaisesRegex(VideoImportError, 'scope changed'):
            self.upload()
        self.assertEqual(self.saved(), self.original)
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_conversion_during_upload_keeps_the_converted_source_unchanged(self):
        def convert(_file, path, _type):
            self.sql("UPDATE free_courses SET converted_at='2026-01-01' WHERE content_ref='FREE1'")
            self.sql("INSERT INTO modules VALUES ('FREE1','Converted','module_authoring','P1','Programme','C1','G1')")
            self.sql('INSERT INTO components VALUES (%s,%s,%s,%s,%s,NULL)',
                     ['VIDEO1', 'FREE1', 'video', 'Converted video', json.dumps(self.original)])
            return path
        self.store.side_effect = convert
        with self.assertRaisesRegex(VideoImportError, 'scope changed'):
            self.upload()
        self.assertEqual(self.saved(), self.original)
        self.assertEqual(self.saved('components', 'VIDEO1'), self.original)
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_regular_module_placement_change_still_refuses_upload(self):
        def move(_file, path, _type):
            self.sql("UPDATE modules SET group_id='OTHER' WHERE module_catalogue_id='MOD1'")
            return path
        self.store.side_effect = move
        with self.assertRaisesRegex(VideoImportError, 'scope changed'):
            self.upload('module', 'MOD1', 'ORDINARY')
        self.assertEqual(self.saved('components', 'ORDINARY'), self.original)
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_unrelated_settings_edit_survives_upload(self):
        replacement = {**self.original, 'lessonContent': 'Edited while uploading'}
        def edit(_file, path, _type):
            self.sql('UPDATE free_programme_components SET settings_json=%s WHERE id=%s', [json.dumps(replacement), 'COMP-ROW'])
            return path
        self.store.side_effect = edit
        _, saved = self.upload()
        self.assertEqual(self.saved(), {**replacement, **saved})

    def test_queue_failure_rolls_back_source_and_does_not_invalidate_cache(self):
        with patch.object(imports, 'enqueue', side_effect=RuntimeError('Queue unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'Queue unavailable'), transaction.atomic():
                self.upload()
        self.assertEqual(self.saved(), self.original)
        self.views.invalidate_curriculum_cache.assert_not_called()
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_regular_module_and_template_uploads_keep_their_own_tables_and_programme(self):
        for kind, target, component, table in [
            ('module', 'MOD1', 'ORDINARY', 'components'),
            ('template', 'TPL1', 'TEMPLATE-VIDEO', 'week_template_components'),
        ]:
            with self.subTest(kind=kind):
                asset, saved = self.upload(kind, target, component)
                self.assertEqual(self.saved(table, component), {**self.original, **saved})
                self.assertEqual(asset.scope['programme_id'], 'P1')
                self.assertNotIn('free_course_module_id', asset.scope)
        self.assertEqual(self.saved(), self.original)
