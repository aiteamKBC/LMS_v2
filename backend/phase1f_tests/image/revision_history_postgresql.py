"""Synthetic PostgreSQL checks, loaded only by the isolated Phase 1F runner."""
from contextlib import contextmanager
import json
import unittest
from unittest.mock import patch

from django.conf import settings
from django.db import connection, transaction
from django.test import RequestFactory
from curriculum_api import quality, versioning
from curriculum_api.reporting.infrastructure import revision_reads, history_queries
from curriculum_api.test_revision_history_boundary_no_db import original_revision_policy
from curriculum_api.test_quality_assets_boundary_no_db import original_quality_assets, FrozenDateTime


@contextmanager
def disposable_history():
    assert connection.vendor == 'postgresql'
    assert len(settings.DATABASES) == 6
    assert all(db['HOST'] == '127.0.0.1' and db['NAME'] == 'phase1f' for db in settings.DATABASES.values())
    with transaction.atomic():
        try:
            versioning.reset_availability()
            yield
        finally:
            transaction.set_rollback(True)
            versioning.reset_availability()


def history_tables():
    # Exact purpose-built synthetic columns; never application provisioning.
    with connection.cursor() as cursor:
        cursor.execute('''CREATE TABLE curriculum.record_revisions (
            id integer primary key, entity_type text, entity_id text, revision_no integer,
            action text, module_catalogue_id text, parent_id text, title text,
            version_label text, content_status text, changed_fields jsonb, snapshot jsonb,
            actor_name text, actor_email text, reason text, created_at timestamp,
            actor_type text, triggered_by_email text, triggered_by_name text, source text, metadata jsonb)''')
        cursor.execute('''CREATE TABLE curriculum.record_versions (
            id integer primary key, entity_type text, entity_id text, version_label text,
            revision_id integer, content_status text, note text, actor_name text,
            actor_email text, created_at timestamp)''')
        for ident, number, title in ((1, 1, 'Before'), (2, 2, 'After')):
            cursor.execute('''INSERT INTO curriculum.record_revisions
                VALUES (%s,'module','SYNTHETIC-M',%s,'updated','SYNTHETIC-M','','Synthetic','','published',
                        '[{"field":"title","from":"Old","to":"New"}]',%s,
                        'Synthetic staff','synthetic@example.test','manual','2026-11-20',
                        'user','','','manual','{}')''',
                [ident, number, json.dumps({'title': title, '_context': {'programme_id': 'SYNTHETIC-P'}})])
        cursor.execute("INSERT INTO curriculum.record_versions VALUES (1,'module','SYNTHETIC-M','v1',2,'published','note','Synthetic staff','synthetic@example.test','2026-11-20')")


class RevisionHistoryPostgreSQL(unittest.TestCase):
    def test_capability_cache_latest_revision_and_count_use_actual_reader(self):
        with disposable_history():
            with original_revision_policy():
                before = versioning.history_available()
            self.assertFalse(before)
            self.assertEqual(versioning.history_available(), before)
            history_tables()
            with original_revision_policy():
                expected_available = versioning.history_available()
                expected_metadata = versioning.metadata_columns_available()
                expected_latest = versioning.latest_revisions('module', [' SYNTHETIC-M ', 'SYNTHETIC-M', ''])
                expected_count = versioning.module_publish_count('SYNTHETIC-M')
            versioning.reset_availability()
            self.assertEqual(versioning.history_available(), expected_available)
            self.assertEqual(versioning.metadata_columns_available(), expected_metadata)
            with patch.object(revision_reads, 'latest_revisions', wraps=revision_reads.latest_revisions) as called:
                actual = versioning.latest_revisions('module', [' SYNTHETIC-M ', 'SYNTHETIC-M', ''])
            called.assert_called_once()
            self.assertEqual(actual, expected_latest)
            self.assertEqual(actual['SYNTHETIC-M']['snapshot']['title'], 'After')
            self.assertEqual(versioning.module_publish_count('SYNTHETIC-M'), expected_count)
            self.assertEqual(expected_count, 1)

    def test_ancestry_joins_names_nulls_and_duplicate_inputs_match(self):
        with disposable_history():
            with connection.cursor() as cursor:
                cursor.execute('CREATE SCHEMA phase1f_revision')
                cursor.execute('CREATE TABLE phase1f_revision.modules (module_catalogue_id text, title text, programme_id text, cohort_id text, group_id text)')
                cursor.execute('CREATE TABLE phase1f_revision.programmes (programme_id text, name text)')
                cursor.execute('CREATE TABLE phase1f_revision.cohorts (cohort_id text, cohort_name text)')
                cursor.execute('CREATE TABLE phase1f_revision.groups (group_id text, group_name text)')
                cursor.execute("INSERT INTO phase1f_revision.modules VALUES ('M','Synthetic module','P','missing','G')")
                cursor.execute("INSERT INTO phase1f_revision.programmes VALUES ('P','Synthetic programme')")
                cursor.execute("INSERT INTO phase1f_revision.groups VALUES ('G','Synthetic group')")
            with patch.object(versioning, 'qualified', side_effect=lambda table: 'phase1f_revision.' + table):
                with original_revision_policy():
                    expected = versioning.resolve_ancestry(['M', ' M ', '', 'missing'])
                with patch.object(revision_reads, 'resolve_ancestry', wraps=revision_reads.resolve_ancestry) as called:
                    actual = versioning.resolve_ancestry(['M', ' M ', '', 'missing'])
                called.assert_called_once()
                self.assertEqual(actual, expected)
                self.assertEqual(actual['M']['programme_name'], 'Synthetic programme')
                self.assertNotIn('cohort_name', actual['M'])

    def test_canonical_feed_real_sql_scope_paging_and_http_bytes_match(self):
        with disposable_history(), patch.object(quality, 'datetime', FrozenDateTime):
            history_tables()
            for scope, identifier in (('module', 'SYNTHETIC-M'), ('programme', 'SYNTHETIC-P'), ('module', 'missing')):
                request = RequestFactory().get('/?workspace=curriculum&scope=' + scope + '&scopeId=' + identifier + '&limit=1&page=2&source=manual&actorType=user')
                with original_quality_assets(), original_revision_policy():
                    expected = quality.curriculum_quality_audit_trail(request)
                with patch.object(history_queries, 'trail_query', wraps=history_queries.trail_query) as called:
                    actual = quality.curriculum_quality_audit_trail(request)
                called.assert_called_once()
                self.assertEqual(actual.status_code, 200)
                self.assertEqual(actual.content, expected.content)
                payload = json.loads(actual.content)
                self.assertEqual(payload['total'], 0 if identifier == 'missing' else 2)
                self.assertFalse(payload['recoveredHistory'])
                self.assertLessEqual(len(payload['events']), 1)
            with connection.cursor() as cursor:
                cursor.execute('SELECT count(*) FROM curriculum.record_revisions')
                self.assertEqual(cursor.fetchone()[0], 2)
