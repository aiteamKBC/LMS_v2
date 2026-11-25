"""Count-reader regressions; opt-in verified disposable PostgreSQL only."""
from datetime import datetime, timezone
import unittest

from django.conf import settings
from django.db import connection, transaction
from curriculum_api.catalogue.infrastructure import free_course_native_schema as free_course_native_schema
from curriculum_api import learning_storage
from curriculum_api import views
from curriculum_api.catalogue.infrastructure import content_runtime, database_reads
from curriculum_api.catalogue.infrastructure.storage_context import native_authoring_scope
from curriculum_api.catalogue.tests.tests_free_course_native_storage import prepare_native_authoring_fixture


class ComponentCountsPostgreSQL(unittest.TestCase):
    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.assertEqual(len(settings.DATABASES), 6)
        self.assertTrue(all(db['HOST'] == '127.0.0.1' and db['NAME'] == 'phase1f'
                            for db in settings.DATABASES.values()))
        self.atomic = transaction.atomic()
        self.atomic.__enter__()
        self.addCleanup(self.rollback)
        prepare_native_authoring_fixture()
        free_course_native_schema.prepare(connection)
        learning_storage.reset()
        self.at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.modules (module_catalogue_id,title) VALUES ('COUNT-ORDINARY','Synthetic ordinary')")
            cursor.execute("INSERT INTO curriculum.weeks (id,module_catalogue_id) VALUES ('COUNT-ORD-WEEK','COUNT-ORDINARY')")
        learning_storage.upsert('modules', {
            'module_catalogue_id': 'COUNT-NATIVE', 'source_type': 'free_course', 'title': 'Synthetic native'})
        learning_storage.upsert('weeks', {
            'id': 'COUNT-WEEK', 'module_catalogue_id': 'COUNT-NATIVE', 'title': 'Synthetic week'})

    def rollback(self):
        transaction.set_rollback(True)
        self.atomic.__exit__(None, None, None)
        learning_storage.reset()
        database_reads._TABLE_COLUMNS_CACHE.clear()

    def ordinary(self, identifier, *, status='active', deleted_at=None, kind='reading', module='COUNT-ORDINARY'):
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO curriculum.components (id,week_id,module_catalogue_id,type,status,deleted_at) VALUES (%s,%s,%s,%s,%s,%s)',
                           [identifier, 'COUNT-ORD-WEEK', module, kind, status, deleted_at])

    def native(self, identifier, *, deleted_at=None, kind='reading'):
        learning_storage.upsert('components', {
            'id': identifier, 'module_catalogue_id': 'COUNT-NATIVE', 'week_id': 'COUNT-WEEK',
            'type': kind, 'title': 'Synthetic component', 'deleted_at': deleted_at})

    def counts(self):
        return content_runtime.authoring_component_counts_by_catalogue()

    def test_mixed_counts_preserve_both_content_identities_and_archive_filters(self):
        self.ordinary('COUNT-ACTIVE')
        self.ordinary('COUNT-INACTIVE', status='inactive')
        self.ordinary('COUNT-ARCHIVED', status='archived')
        self.ordinary('COUNT-DELETED', deleted_at=self.at)
        self.native('COUNT-FREE-ACTIVE')
        self.native('COUNT-FREE-DELETED', deleted_at=self.at)
        self.assertEqual(self.counts(), {'COUNT-ORDINARY': 1, 'COUNT-NATIVE': 1})
        with connection.cursor() as cursor:
            cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='curriculum' AND table_name='learning_components'")
            self.assertNotIn('status', {row[0] for row in cursor.fetchall()})

    def test_native_scope_does_not_read_ordinary_components(self):
        self.ordinary('COUNT-ORDINARY-ONLY')
        self.native('COUNT-FREE-ONLY')
        statements = []
        def capture(execute, sql, params, many, context):
            statements.append(str(sql))
            return execute(sql, params, many, context)
        with native_authoring_scope(), connection.execute_wrapper(capture):
            self.assertEqual(self.counts(), {'COUNT-NATIVE': 1})
        aggregates = [sql for sql in statements if 'count(*) as total' in sql]
        self.assertEqual(len(aggregates), 1)
        self.assertIn('free_authoring_components', aggregates[0])
        self.assertNotIn('"curriculum"."components"', aggregates[0])

    def test_retired_types_remain_excluded_in_both_stores(self):
        retired = sorted(views.RETIRED_COMPONENT_TYPES)[0]
        self.ordinary('COUNT-RETIRED', kind=retired)
        self.native('COUNT-FREE-RETIRED', kind=retired)
        self.assertEqual(self.counts(), {})

    def test_multiple_components_are_counted_not_deduplicated_by_module(self):
        for suffix in ('A', 'B'):
            self.ordinary('COUNT-ORD-' + suffix)
            self.native('COUNT-FREE-' + suffix)
        self.assertEqual(self.counts(), {'COUNT-ORDINARY': 2, 'COUNT-NATIVE': 2})

    def test_unconverted_cutover_marker_controls_native_visibility(self):
        self.native('COUNT-VISIBLE')
        self.assertEqual(self.counts(), {'COUNT-NATIVE': 1})
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.free_courses SET storage_version=1 WHERE content_ref='COUNT-NATIVE'")
        self.assertEqual(self.counts(), {})
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.free_courses SET storage_version=2,converted_at=%s WHERE content_ref='COUNT-NATIVE'", [self.at])
        self.assertEqual(self.counts(), {})

    def test_ordinary_null_status_preserves_existing_sql_semantics(self):
        with connection.cursor() as cursor:
            cursor.execute('ALTER TABLE curriculum.components ALTER COLUMN status DROP NOT NULL')
        self.ordinary('COUNT-NULL-STATUS', status=None)
        self.ordinary('COUNT-DRAFT', status='draft')
        self.assertEqual(self.counts(), {'COUNT-ORDINARY': 1})
