"""Real endpoint/constraint regressions in a disposable local PostgreSQL cluster.

Development is SELECT-only through the branch-verified read-only helper.
Only schema metadata and aggregate digests are read; all test rows are synthetic.
No Django application startup hooks, migrations or external services run.
Run: backend/.venv/Scripts/python.exe backend/scripts/test_reading_quiz_pairs_isolated.py
Requires PostgreSQL initdb/pg_ctl on PATH and an unused local port 55489.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import psycopg
from psycopg import sql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_inclusion_canonical_targets import connect_development


def snapshot():
    with connect_development() as conn:
        digest = conn.execute("""SELECT count(*),md5(string_agg(to_jsonb(t)::text,'' ORDER BY id))
            FROM curriculum.source_reading_quiz_pairs t""").fetchone()
        constraints = conn.execute("""SELECT conname,contype,convalidated,pg_get_constraintdef(oid)
            FROM pg_constraint WHERE conrelid='curriculum.source_reading_quiz_pairs'::regclass
            ORDER BY conname""").fetchall()
        columns = conn.execute("""SELECT a.attname,format_type(a.atttypid,a.atttypmod),
            a.attnotnull,a.attidentity,pg_get_expr(d.adbin,d.adrelid)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid='curriculum.source_reading_quiz_pairs'::regclass
            AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum""").fetchall()
        exceptions = conn.execute("""SELECT p.id,p.group_id,p.reading_activity_id,p.quiz_activity_id,
            a.quiz_id,jsonb_array_length(a.quiz_questions)
            FROM curriculum.source_reading_quiz_pairs p
            JOIN curriculum.source_lms_activities a ON a.activity_id=p.reading_activity_id
            WHERE p.id IN (120,122) ORDER BY p.id""").fetchall()
        duplicates = conn.execute("""SELECT count(*) FROM (
            SELECT group_id,reading_activity_id,quiz_activity_id
            FROM curriculum.source_reading_quiz_pairs GROUP BY 1,2,3 HAVING count(*)>1) d""").fetchone()[0]
        assert digest[0] == 88 and duplicates == 0
        assert exceptions == [(120, 66861, 81858, 82805, 82805, 10),
                              (122, 80624, 82328, 82338, 82338, 0)]
        assert {r[0] for r in constraints if r[1] == 'f' and r[2]} == {'fk_rq_group', 'fk_rq_reading_group'}
        return digest, constraints, columns, exceptions


class PairTests(unittest.TestCase):
    def setUp(self):
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM curriculum.source_reading_quiz_pairs')

    def request(self, method='POST', group=1, ids=(10, 20)):
        request = getattr(factory, method.lower())('/pairs', data=json.dumps({
            'group_id': group, 'activity_ids': ids, 'created_by': 'synthetic-auditor'}),
            content_type='application/json')
        with patch.object(views, '_ensure_manual_tables'):
            return views.reading_quiz_pairs(request)

    def rows(self):
        with connection.cursor() as cursor:
            cursor.execute('SELECT group_id,reading_activity_id,quiz_activity_id,created_by,created_at FROM curriculum.source_reading_quiz_pairs ORDER BY id')
            return cursor.fetchall()

    def test_valid_creation_preserves_metadata(self):
        self.assertEqual(self.request().status_code, 200)
        row = self.rows()[0]
        self.assertEqual(row[:4], (1, 10, 20, 'synthetic-auditor'))
        self.assertIsNotNone(row[4])

    def test_duplicate_does_not_overwrite_metadata(self):
        self.request()
        before = self.rows()
        self.assertEqual(self.request().status_code, 409)
        self.assertEqual(self.rows(), before)

    def test_invalid_group(self):
        self.assertEqual(self.request(group=999).status_code, 400)
        self.assertEqual(self.rows(), [])

    def test_reading_in_another_group(self):
        self.assertEqual(self.request(group=2).status_code, 400)
        self.assertEqual(self.rows(), [])

    def test_unrelated_member_rejected(self):
        self.assertEqual(self.request(ids=(10, 99)).status_code, 400)
        self.assertEqual(self.rows(), [])

    def test_embedded_quiz_without_independent_activity(self):
        self.assertEqual(self.request(ids=(10, 101)).status_code, 200)
        self.assertEqual(self.rows()[0][2], 101)

    def test_referenced_quiz_assigned_to_other_group(self):
        self.assertEqual(self.request(ids=(30, 99)).status_code, 200)
        self.assertEqual(self.rows()[0][2], 99)

    def test_removal_is_group_scoped(self):
        self.request()
        self.request(group=2, ids=(99, 98))
        self.assertEqual(self.request(method='DELETE').status_code, 200)
        self.assertEqual([r[:3] for r in self.rows()], [(2, 99, 98)])

    def test_embedded_pair_removal(self):
        self.request(ids=(10, 101))
        self.assertEqual(self.request(method='DELETE', ids=(10, 101)).status_code, 200)
        self.assertEqual(self.rows(), [])

    def test_partial_bundle_is_rolled_back_on_fk_failure(self):
        calls = []
        def concurrent_source_change(value):
            calls.append(value)
            if len(calls) == 2:
                with connection.cursor() as cursor:
                    cursor.execute('INSERT INTO curriculum.source_reading_quiz_pairs(group_id,reading_activity_id,quiz_activity_id) VALUES(999,10,77)')
            return value
        with patch.object(views, '_actor', side_effect=concurrent_source_change):
            response = self.request(ids=(10, 20, 30))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.rows(), [])
        self.assertNotIn('details', json.loads(response.content))

    def test_other_unique_constraint_is_conflict(self):
        def conflict(value):
            with connection.cursor() as cursor:
                cursor.execute('INSERT INTO curriculum.source_reading_quiz_pairs(group_id,reading_activity_id,quiz_activity_id) VALUES(1,30,20)')
            return value
        with patch.object(views, '_actor', side_effect=conflict):
            self.assertEqual(self.request().status_code, 409)
        self.assertEqual(self.rows(), [])

    def test_restrict_prevents_parent_deletion(self):
        self.request()
        from django.db import IntegrityError
        for statement in ('DELETE FROM curriculum.source_lms_groups WHERE group_id=1',
                          'DELETE FROM curriculum.source_lms_group_activities WHERE group_id=1 AND activity_id=10'):
            with self.assertRaises(IntegrityError), connection.cursor() as cursor:
                cursor.execute(statement)
        self.assertEqual(len(self.rows()), 1)

    def test_parent_upsert_preserves_relationship_and_metadata(self):
        self.request()
        before = self.rows()
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO curriculum.source_lms_groups VALUES(1) ON CONFLICT(group_id) DO NOTHING')
            cursor.execute('INSERT INTO curriculum.source_lms_group_activities VALUES(1,10) ON CONFLICT(group_id,activity_id) DO NOTHING')
        self.assertEqual(self.rows(), before)

    def test_invalid_json_shape(self):
        request = factory.post('/pairs', data='[]', content_type='application/json')
        self.assertEqual(views.reading_quiz_pairs(request).status_code, 400)

    def test_concurrent_duplicate_requests(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from django.db import connections
        barrier = Barrier(2)
        def create():
            try:
                barrier.wait(timeout=10)
                request = factory.post('/pairs', data=json.dumps({
                    'group_id': 1, 'activity_ids': [10, 20]}), content_type='application/json')
                return views.reading_quiz_pairs(request).status_code
            finally:
                connections.close_all()
        with patch.object(views, '_ensure_manual_tables'), ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(create) for _ in range(2)]
            self.assertEqual(sorted(f.result(timeout=15) for f in futures), [200, 409])
        self.assertEqual(len(self.rows()), 1)

    def test_backfill_retains_embedded_reading_without_synthetic_activity(self):
        from audit_api.management.commands.bulk_backfill_manual_rows import _prefetch_activities
        content_rows = [{'group_id': 1, 'activity_id': 10, 'activity_type': 'reading+quiz'}]
        pairs = [{'id': 120, 'group_id': 1, 'reading_activity_id': 10, 'quiz_activity_id': 101}]
        with patch.object(views, '_dict_rows', side_effect=[content_rows, pairs]):
            rows = _prefetch_activities(MagicMock(), {'learner_id': 1})
        self.assertEqual([row['source_ref'] for row in rows], ['la:1:10'])

    def test_backfill_preserves_standalone_bundle(self):
        from audit_api.management.commands.bulk_backfill_manual_rows import _prefetch_activities
        content_rows = [{'group_id': 1, 'activity_id': i, 'activity_type': 'reading+quiz'} for i in (10, 20)]
        pairs = [{'id': 1, 'group_id': 1, 'reading_activity_id': 10, 'quiz_activity_id': 20}]
        with patch.object(views, '_dict_rows', side_effect=[content_rows, pairs]):
            rows = _prefetch_activities(MagicMock(), {'learner_id': 1})
        self.assertEqual([row['source_ref'] for row in rows], ['rq:1:10:20'])


if __name__ == '__main__':
    before = snapshot()
    print('Development baseline:', before[0], flush=True)
    initdb, pgctl = shutil.which('initdb'), shutil.which('pg_ctl')
    if not initdb or not pgctl:
        raise RuntimeError('Local PostgreSQL binaries required; no remote test fallback.')
    directory = Path(tempfile.mkdtemp(prefix='kbc_reading_pairs_'))
    data = directory / 'data'
    subprocess.run([initdb, '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    # Windows server children can retain PIPE handles after pg_ctl exits.
    with (directory / 'startup.log').open('wb') as output:
        subprocess.run([pgctl, '-D', str(data), '-l', str(directory / 'postgres.log'), '-o', '-h 127.0.0.1 -p 55489', '-w', 'start'], check=True, stdout=output, stderr=output, timeout=75)
    try:
        with psycopg.connect(host='127.0.0.1', port=55489, user='postgres', dbname='postgres', autocommit=True) as conn:
            actual, branch = conn.execute("SELECT current_setting('data_directory'),current_setting('neon.branch_id',true)").fetchone()
            assert Path(actual).resolve() == data.resolve() and not branch
            conn.execute('CREATE SCHEMA curriculum')
            conn.execute('CREATE TABLE curriculum.source_lms_groups(group_id bigint PRIMARY KEY)')
            conn.execute('CREATE TABLE curriculum.source_lms_activities(activity_id bigint PRIMARY KEY,quiz_id bigint)')
            conn.execute('CREATE TABLE curriculum.source_lms_group_activities(group_id bigint,activity_id bigint,PRIMARY KEY(group_id,activity_id))')
            definitions = []
            for name, kind, required, identity, default in before[2]:
                suffix = ' GENERATED BY DEFAULT AS IDENTITY' if identity == 'd' else (' DEFAULT ' + default if default else '')
                definitions.append(sql.SQL('{} {}{}{}').format(sql.Identifier(name), sql.SQL(kind), sql.SQL(suffix), sql.SQL(' NOT NULL' if required else '')))
            conn.execute(sql.SQL('CREATE TABLE curriculum.source_reading_quiz_pairs ({})').format(sql.SQL(',').join(definitions)))
            for name, kind, _, definition in before[1]:
                if kind != 'n':
                    conn.execute(sql.SQL('ALTER TABLE curriculum.source_reading_quiz_pairs ADD CONSTRAINT {} {}').format(sql.Identifier(name), sql.SQL(definition)))
            conn.execute('INSERT INTO curriculum.source_lms_groups VALUES(1),(2)')
            conn.execute('INSERT INTO curriculum.source_lms_activities VALUES(10,101),(20,NULL),(30,99),(99,99),(98,NULL)')
            conn.execute('INSERT INTO curriculum.source_lms_group_activities VALUES(1,10),(1,20),(1,30),(2,99),(2,98)')
        from django.conf import settings
        settings.configure(SECRET_KEY='isolated-test', INSTALLED_APPS=[], DATABASES={'default': {
            'ENGINE': 'django.db.backends.postgresql', 'HOST': '127.0.0.1', 'PORT': 55489,
            'NAME': 'postgres', 'USER': 'postgres'}})
        # Register only the model definitions needed by an existing Journal test;
        # use the base AppConfig so production ready() hooks are never invoked.
        import login
        import learner_api
        from django.apps import apps, AppConfig
        apps.populate([AppConfig('login', login), AppConfig('learner_api', learner_api)])
        from django.db import connection
        from django.test import RequestFactory
        from audit_api import manual_ledger_views as views
        factory = RequestFactory()
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(PairTests)
        suite.addTests(unittest.defaultTestLoader.loadTestsFromName('audit_api.test_last_audit_ledger_views'))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromName('learner_api.test_journal_sources_no_db'))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromName('old_otjh.test_content'))
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        connection.close()
    finally:
        subprocess.run([pgctl, '-D', str(data), '-m', 'fast', '-w', 'stop'], check=True, capture_output=True)
    after = snapshot()
    assert before == after, 'Development rows or schema changed during verification'
    print('Development final snapshot unchanged:', after[0])
    print('Both FKs validated; records 120/122 and all columns unchanged.')
    print('External source synchronizer is not exercised by this suite.')
    sys.exit(0 if result.wasSuccessful() else 1)
