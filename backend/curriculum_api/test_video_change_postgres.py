"""Actual database triggers/transactions; run with run_video_postgres_tests."""
import importlib
import io
import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from django.db import connection, connections, transaction

from . import video_imports as imports
from .models import CurriculumVideoChange, CurriculumVideoImport
from .video_changes import capture_pending


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


class VideoChangePostgresTests(unittest.TestCase):
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
                                GROUPS_TABLE='groups', authoring_fetch_all=fetch)
        for patcher in (patch.object(imports, 'enabled', return_value=True), patch.object(imports, '_views', return_value=views)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def insert(self, component='NEW', *, kind='video', source=SOURCE):
        sql('''INSERT INTO curriculum.components (id,module_catalogue_id,type,title,settings_json)
            VALUES (%s,'MOD1',%s,'Synthetic lesson',%s::jsonb)''',
            [component, kind, json.dumps({'videoUrl': source, 'requiredProgressPercentage': 80})])

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
