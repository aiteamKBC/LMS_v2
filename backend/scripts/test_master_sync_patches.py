"""Execute patched sibling functions on synthetic, verified disposable PostgreSQL."""
import ast
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import psycopg
import test_source_activity_ksbs_postgres as isolated

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'specs/lms-master-completion/patch_sources'


def function(path, name, namespace):
    tree = ast.parse(path.read_text(encoding='utf-8'))
    node = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == name)
    node.decorator_list = []
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(path), 'exec'), namespace)
    return namespace[name]


def run(config):
    spec = importlib.util.spec_from_file_location('patched_refresh', SOURCES / 'source_catalogue_refresh.py')
    refresh = importlib.util.module_from_spec(spec); spec.loader.exec_module(refresh)
    from django.core.management.base import CommandError
    from django.conf import settings
    settings.configure(SECRET_KEY='synthetic', DATABASES={'default': {
        'ENGINE': 'django.db.backends.postgresql', 'HOST': config['host'], 'PORT': config['port'],
        'USER': config['user'], 'NAME': config['dbname']}}, INSTALLED_APPS=[])
    import django
    django.setup()
    from django.db import connection, connections, transaction
    manifest = {'version': 1, 'evidence': 'synthetic fixture', 'reviewed_by': 'test', 'group_ids': [], 'activity_ids': []}

    class SyncTests(unittest.TestCase):
        @classmethod
        def setUpClass(cls):
            with connection.cursor() as c:
                c.execute('''CREATE SCHEMA curriculum; CREATE SCHEMA "Last_audit";
                    CREATE TABLE "Last_audit".groups(group_id bigint PRIMARY KEY,title text);
                    CREATE TABLE "Last_audit".activities(activity_id bigint PRIMARY KEY,title text);
                    CREATE TABLE "Last_audit".group_activities(group_id bigint,activity_id bigint,PRIMARY KEY(group_id,activity_id));
                    CREATE TABLE "Last_audit".raw_pages(page integer PRIMARY KEY,payload jsonb);
                    CREATE TABLE curriculum.source_lms_groups(LIKE "Last_audit".groups INCLUDING ALL);
                    CREATE TABLE curriculum.source_lms_activities(LIKE "Last_audit".activities INCLUDING ALL);
                    CREATE TABLE curriculum.source_lms_group_activities(group_id bigint REFERENCES curriculum.source_lms_groups,
                        activity_id bigint REFERENCES curriculum.source_lms_activities,PRIMARY KEY(group_id,activity_id));
                    CREATE TABLE curriculum.source_lms_raw_pages(LIKE "Last_audit".raw_pages INCLUDING ALL)''')
                c.execute((SOURCES / 'source_sync_baselines.sql').read_text())

        def setUp(self):
            with connection.cursor() as c:
                c.execute('''TRUNCATE "Last_audit".groups,"Last_audit".activities,"Last_audit".group_activities,"Last_audit".raw_pages,
                    curriculum.source_lms_groups,curriculum.source_lms_activities,curriculum.source_lms_group_activities,
                    curriculum.source_lms_raw_pages,curriculum.source_sync_baselines;
                    INSERT INTO "Last_audit".groups VALUES(1,'Group'); INSERT INTO "Last_audit".activities VALUES(2,'Activity');
                    INSERT INTO "Last_audit".group_activities VALUES(1,2)''')

        def query(self, sql, params=()):
            with connection.cursor() as c:
                c.execute(sql, params)
                return c.fetchall() if c.description else []

        def sync(self, exclusions=None):
            with transaction.atomic(), connection.cursor() as c:
                return refresh.refresh(c, exclusions or manifest)

        def test_fresh_bootstrap_has_parents_before_links(self):
            self.sync()
            self.assertEqual(self.query('SELECT * FROM curriculum.source_lms_group_activities'), [(1, 2)])

        def test_actual_historical_method_insertion_order(self):
            path = SOURCES / 'migrate_activity_runtime_to_ssot.py'
            tree = ast.parse(path.read_text())
            tables = next(ast.literal_eval(node.value) for node in tree.body
                          if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'OPERATIONAL_TABLES' for t in node.targets))
            selected = {key: value for key, value in tables.items() if key in {
                'source_lms_groups', 'source_lms_activities', 'source_lms_group_activities'}}
            method = function(path, '_copy_operational_tables', {'OPERATIONAL_TABLES': selected, 'CommandError': CommandError})
            with transaction.atomic(), connection.cursor() as c:
                result = method(c)
            self.assertEqual(result['operational_source_lms_group_activities'], 1)

        def test_incremental_refresh_and_duplicate_retry(self):
            self.sync()
            self.query("UPDATE \"Last_audit\".activities SET title='Changed'")
            self.assertEqual(self.sync()['source_lms_activities']['updated'], 1)
            self.assertEqual(self.sync()['source_lms_activities']['updated'], 0)
            self.assertEqual(self.query('SELECT title FROM curriculum.source_lms_activities'), [('Changed',)])

        def test_missing_source_records_are_retained(self):
            self.sync(); self.query('DELETE FROM "Last_audit".activities')
            self.sync()
            self.assertEqual(len(self.query('SELECT * FROM curriculum.source_lms_activities')), 1)

        def test_local_edits_preserved_and_conflicting_source_aborts(self):
            self.sync(); self.query("UPDATE curriculum.source_lms_activities SET title='Local'")
            self.sync()
            self.query("UPDATE \"Last_audit\".activities SET title='Remote'")
            self.query("UPDATE \"Last_audit\".groups SET title='Also changed'")
            with self.assertRaises(CommandError): self.sync()
            self.assertEqual(self.query('SELECT title FROM curriculum.source_lms_groups'), [('Group',)])
            self.assertEqual(self.query('SELECT title FROM curriculum.source_lms_activities'), [('Local',)])

        def test_existing_divergent_rows_need_reconciliation(self):
            self.query("INSERT INTO curriculum.source_lms_groups VALUES(1,'Local')")
            with self.assertRaises(CommandError): self.sync()

        def test_deleted_test_exclusion_prevents_parent_and_link_import(self):
            self.sync({**manifest, 'activity_ids': [2]})
            self.assertEqual(self.query('SELECT * FROM curriculum.source_lms_activities'), [])
            self.assertEqual(self.query('SELECT * FROM curriculum.source_lms_group_activities'), [])

        def test_hard_deleted_applied_record_is_not_recreated(self):
            self.sync()
            self.query('DELETE FROM curriculum.source_lms_group_activities; DELETE FROM curriculum.source_lms_activities')
            with self.assertRaises(CommandError): self.sync()
            self.assertEqual(self.query('SELECT * FROM curriculum.source_lms_activities'), [])

        def test_page_raw_and_normalized_writes_rollback_and_retry_together(self):
            path = SOURCES / 'sync_last_audit.py'
            def raw(cursor, page, per_page, payload):
                cursor.execute('INSERT INTO "Last_audit".raw_pages VALUES(%s,%s::jsonb) ON CONFLICT(page) DO UPDATE SET payload=excluded.payload', [page, json.dumps(payload)])
            should_fail = [True]
            def upsert(payload):
                self.query("UPDATE \"Last_audit\".groups SET title='Page updated'")
                if should_fail[0]: raise RuntimeError('synthetic page failure')
                return {'groups': 1}
            method = function(path, '_ingest_file', {'json': json, 'connection': connection, 'transaction': transaction,
                'PER_PAGE': 25, '_store_raw_page': raw, 'upsert_payload': upsert, 'upsert_activity_definitions': upsert})
            command = SimpleNamespace(stdout=SimpleNamespace(write=lambda _: None), style=SimpleNamespace(SUCCESS=lambda s: s), _fmt_counts=lambda _: '')
            with tempfile.TemporaryDirectory(prefix='synthetic_page_') as directory:
                page = Path(directory) / 'page.json'; page.write_text(json.dumps({'pagination': {'page': 1, 'per_page': 25}}))
                with self.assertRaises(RuntimeError): method(command, page)
                self.assertEqual(self.query('SELECT * FROM "Last_audit".raw_pages'), [])
                self.assertEqual(self.query('SELECT title FROM "Last_audit".groups'), [('Group',)])
                should_fail[0] = False
                method(command, page); method(command, page)
                self.assertEqual(len(self.query('SELECT * FROM "Last_audit".raw_pages')), 1)

        def test_manifest_requires_matching_digest_and_evidence(self):
            with tempfile.TemporaryDirectory(prefix='synthetic_manifest_') as directory:
                path = Path(directory) / 'manifest.json'; path.write_text(json.dumps(manifest))
                with self.assertRaises(CommandError): refresh.read_manifest(path, 'wrong')
                import hashlib
                self.assertEqual(refresh.read_manifest(path, hashlib.sha256(path.read_bytes()).hexdigest()), manifest)

        def test_material_worker_excludes_404_completed_counts_and_applies_sql_limit(self):
            path = SOURCES / 'sync_lms_material_backups.py'
            namespace = {'resolve': lambda _: 'default', 'CONNECTION_ALIAS': 'default', 'connections': connections,
                         'CommandError': CommandError, 'SNAPSHOTS': 'curriculum.source_materials'}
            namespace['_validated_page_count_shard'] = function(path, '_validated_page_count_shard', namespace)
            handle = function(path, 'handle', namespace)
            self.query('''CREATE TABLE curriculum.source_materials(
                material_id bigint PRIMARY KEY,title text,source_metadata jsonb DEFAULT '{}',content_type text DEFAULT 'reading+quiz',
                video_iframe_url text,reading_iframe_url text DEFAULT 'synthetic',audio_iframe_url text,source_url text,
                payload jsonb DEFAULT '{}',backup_status text DEFAULT 'available',page_count_status text DEFAULT 'pending',
                page_count integer,page_count_error text,page_count_checked_at timestamptz,last_checked_at timestamptz,
                source_system text DEFAULT 'old_lms',deleted_at timestamptz);
                INSERT INTO curriculum.source_materials(material_id,page_count_status,page_count_error,page_count_checked_at)
                    VALUES(2,'error','reading source returned HTTP 404',now()-interval '2 days');
                INSERT INTO curriculum.source_materials(material_id,page_count) VALUES(4,10);
                INSERT INTO curriculum.source_materials(material_id) VALUES(6),(8)''')
            self.addCleanup(lambda: self.query('DROP TABLE curriculum.source_materials'))
            output = []
            command = SimpleNamespace(stdout=SimpleNamespace(write=output.append))
            opts = dict(metadata_only=False,page_counts_only=True,audit_cohort_only=False,shard_count=2,shard_index=0,
                        limit=1,activity_id=[],force=False,apply=False)
            handle(command, **opts)
            self.assertIn('candidates=1', output[0])
            output.clear(); handle(command, **{**opts, 'limit': 0})
            self.assertIn('candidates=2', output[0])
            self.assertEqual(self.query('SELECT page_count_error FROM curriculum.source_materials WHERE material_id=2'),
                             [('reading source returned HTTP 404',)])

        def test_local_backup_worker_selects_only_unbacked_pending_or_error(self):
            path = ROOT / 'backend/scripts/backup_source_materials.py'
            tree = ast.parse(path.read_text())
            statement = next(node.value for node in ast.walk(tree) if isinstance(node, ast.Constant)
                             and isinstance(node.value, str) and 'SELECT m.id,m.source_url' in node.value)
            self.query('''CREATE TABLE curriculum.source_materials(id bigint PRIMARY KEY,source_url text,reading_iframe_url text,
                video_iframe_url text,audio_iframe_url text,content_type text,updated_at timestamptz,deleted_at timestamptz,
                blob_name text,backup_status text);
                INSERT INTO curriculum.source_materials(id,backup_status,blob_name) VALUES
                  (1,'pending',NULL),(2,'error',NULL),(3,'not_applicable',NULL),(4,'available','blob'),(5,'pending','blob')''')
            self.addCleanup(lambda: self.query('DROP TABLE curriculum.source_materials'))
            self.assertEqual([r[0] for r in self.query(statement, [0, None, None, False, None, 20])], [1, 2])

    try:
        with patch('requests.sessions.Session.request', side_effect=AssertionError('Live HTTP forbidden')):
            result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SyncTests))
        return result.wasSuccessful()
    finally:
        connections.close_all()


if __name__ == '__main__':
    isolated.run = run
    raise SystemExit(isolated.main())
