"""Only loaded by the established disposable, externally isolated Docker runner."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import unittest
from unittest.mock import patch

from django.conf import settings
from django.db import connection, transaction
from django.test import RequestFactory
from curriculum_api import quality, programme_audit, versioning
from curriculum_api.reporting.tests.test_quality_assets_boundary_no_db import original_quality_assets, FrozenDateTime


@contextmanager
def disposable_audit_schema():
    assert connection.vendor == 'postgresql'
    assert all(db['HOST'] == '127.0.0.1' and db['NAME'] == 'phase1f' for db in settings.DATABASES.values())
    with transaction.atomic():
        try:
            with connection.cursor() as cursor:
                cursor.execute('CREATE SCHEMA phase1f_audit')
            yield
        finally:
            transaction.set_rollback(True)


class QualityAssetsPostgreSQL(unittest.TestCase):
    def test_revision_readers_and_history_http_real_sql_parity(self):
        from curriculum_api.reporting.infrastructure import history_reads
        with disposable_audit_schema(), \
             patch.object(versioning, 'qualified', side_effect=lambda table: 'phase1f_audit.' + table), \
             patch.object(versioning, 'history_available', return_value=True), \
             patch.object(quality, 'datetime', FrozenDateTime):
            with connection.cursor() as cursor:
                cursor.execute('''CREATE TABLE phase1f_audit.record_revisions (
                    id integer primary key, entity_type text, entity_id text, revision_no integer,
                    action text, module_catalogue_id text, parent_id text, title text,
                    version_label text, content_status text, changed_fields jsonb, snapshot jsonb,
                    actor_name text, actor_email text, reason text, created_at timestamp)''')
                cursor.execute('''CREATE TABLE phase1f_audit.record_versions (
                    id integer primary key, entity_type text, entity_id text, version_label text,
                    revision_id integer, content_status text, note text, actor_name text,
                    actor_email text, created_at timestamp)''')
                for ident, number, title in ((1, 1, 'Before'), (2, 2, 'After')):
                    cursor.execute('''INSERT INTO phase1f_audit.record_revisions
                        VALUES (%s,'module','M',%s,'updated','M','','Synthetic','','published',
                                '[]',%s,'Synthetic staff','synthetic@example.test','manual','2026-11-20')''',
                        [ident, number, json.dumps({'title': title, versioning.CONTEXT_KEY: {'programme_id': 'P'}})])
                cursor.execute("INSERT INTO phase1f_audit.record_versions VALUES (1,'module','M','v1',2,'published','note','Synthetic staff','synthetic@example.test','2026-11-20')")
            request = RequestFactory().get('/?snapshot=1')
            with original_quality_assets():
                expected_latest = quality.latest_revision_by_entity([('module', 'M')])
                expected_named = quality.named_version_counts([('module', 'M')])
                expected_history = quality.curriculum_quality_record_history(request, 'module', 'M')
                expected_versions = quality.curriculum_quality_versions(RequestFactory().get('/?module=M'))
            with patch.object(history_reads, 'latest_revision_by_entity', wraps=history_reads.latest_revision_by_entity) as owner:
                actual_latest = quality.latest_revision_by_entity([('module', 'M')])
            owner.assert_called_once()
            self.assertEqual(actual_latest, expected_latest)
            self.assertEqual(actual_latest[('module', 'M')]['revision_no'], 2)
            self.assertEqual(quality.named_version_counts([('module', 'M')]), expected_named)
            actual_history = quality.curriculum_quality_record_history(request, 'module', 'M')
            self.assertEqual(actual_history.content, expected_history.content)
            self.assertEqual(json.loads(actual_history.content)['snapshot']['content']['title'], 'Before')
            self.assertEqual(quality.curriculum_quality_versions(RequestFactory().get('/?module=M')).content, expected_versions.content)
            clause, params = quality._scope_clause('programme', 'P')
            with connection.cursor() as cursor:
                cursor.execute('SELECT count(*) FROM phase1f_audit.record_revisions WHERE ' + clause, params)
                self.assertEqual(cursor.fetchone()[0], 2)
                cursor.execute('SELECT count(*) FROM phase1f_audit.record_versions')
                self.assertEqual(cursor.fetchone()[0], 1)

    def test_asset_material_reads_order_counts_and_http_real_sql_parity(self):
        from curriculum_api.catalogue.infrastructure import audit_asset_reads
        definitions = {'synthetic': {'table': 'material', 'name': 'Synthetic material', 'programme': 'P'}}
        with disposable_audit_schema(), \
             patch.object(programme_audit, 'PROGRAMME_AUDIT_SCHEMA', 'phase1f_audit'), \
             patch.object(programme_audit, 'UI_MATERIAL_TABLES', definitions):
            columns = []
            for column in programme_audit.ASSET_COLUMNS:
                kind = ('jsonb' if column in programme_audit.JSON_COLUMNS else
                        'numeric' if column in {'expected_otjh', 'duration_minutes', 'week_number', 'points'} else 'text')
                columns.append(connection.ops.quote_name(column) + ' ' + kind)
            with connection.cursor() as cursor:
                cursor.execute('CREATE TABLE phase1f_audit.assets (' + ', '.join(columns) + ')')
                cursor.execute('CREATE TABLE phase1f_audit.material (LIKE phase1f_audit.assets)')
                for table in ('assets', 'material'):
                    for ident, kind, minutes, hours in (('B', 'audio', 15, None), ('A', 'reading', 10, 2)):
                        cursor.execute(f'''INSERT INTO phase1f_audit.{table}
                            (id,programme_id,module_catalogue_id,module_title,week_id,week_number,week_title,
                             component_id,component_type,content_kind,title,duration_minutes,expected_otjh,settings)
                            VALUES (%s,'P','M','Synthetic module','W',1,'Week 1',%s,%s,%s,%s,%s,%s,'{{}}')''',
                            [ident, ident, kind, kind, ident, minutes, hours])
            request = RequestFactory().get('/')
            with original_quality_assets():
                expected = programme_audit.fetch_assets('P')
                material = programme_audit.fetch_ui_material('synthetic', include_results=True)
                expected_response = programme_audit.programme_audit_material(request, 'synthetic')
            with patch.object(audit_asset_reads, 'fetch_assets', wraps=audit_asset_reads.fetch_assets) as owner:
                actual = programme_audit.fetch_assets('P')
            owner.assert_called_once()
            self.assertEqual(actual, expected)
            self.assertEqual([row['id'] for row in actual], ['A', 'B'])
            self.assertEqual(programme_audit.fetch_ui_material('synthetic', include_results=True), material)
            self.assertEqual(material['count'], 2)
            self.assertEqual(material['expectedMinutes'], 135)
            self.assertEqual(programme_audit.programme_audit_material(request, 'synthetic').content, expected_response.content)
            self.assertEqual(programme_audit.fetch_assets('missing'), [])
            with connection.cursor() as cursor:
                cursor.execute('SELECT count(*) FROM phase1f_audit.assets')
                self.assertEqual(cursor.fetchone()[0], 2)
