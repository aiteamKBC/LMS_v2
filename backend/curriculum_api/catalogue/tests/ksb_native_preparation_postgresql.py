"""Native preparation on normalized synthetic KSB storage; disposable DB only."""
import json
import unittest

from django.conf import settings
from django.db import connection, transaction
from curriculum_api.catalogue.infrastructure import free_course_native_schema as schema
from curriculum_api import learning_storage
from curriculum_api.models import ModuleAuthoringKsbMapping
from curriculum_api.catalogue.infrastructure import database_reads
from curriculum_api.catalogue.tests.tests_free_course_native_storage import prepare_native_authoring_fixture


class KsbNativePreparationPostgreSQL(unittest.TestCase):
    def setUp(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.assertEqual(len(settings.DATABASES), 6)
        self.assertTrue(all(db['HOST'] == '127.0.0.1' and db['NAME'] == 'phase1f'
                            for db in settings.DATABASES.values()))
        self.atomic = transaction.atomic()
        self.atomic.__enter__()
        self.addCleanup(self.rollback)
        prepare_native_authoring_fixture()
        with connection.cursor() as cursor:
            for suffix, kind in (('FREE', 'free_course'), ('REGULAR', 'module_authoring')):
                cursor.execute('''INSERT INTO curriculum.modules
                    (module_catalogue_id,title,source_type,is_for_sale,currency)
                    VALUES (%s,%s,%s,false,'GBP')''',
                    ['KSB-' + suffix, 'Synthetic ' + suffix, kind])
                cursor.execute('INSERT INTO curriculum.weeks (id,module_catalogue_id) VALUES (%s,%s)',
                               ['KSB-W-' + suffix, 'KSB-' + suffix])
                cursor.execute('''INSERT INTO curriculum.components (id,week_id,module_catalogue_id,type)
                    VALUES (%s,%s,%s,'reading')''', ['KSB-C-' + suffix, 'KSB-W-' + suffix, 'KSB-' + suffix])
            cursor.execute('''INSERT INTO curriculum.components (id,week_id,module_catalogue_id,type)
                VALUES ('KSB-C-FREE-SECOND','KSB-W-FREE','KSB-FREE','reading')''')
            cursor.execute("INSERT INTO curriculum.standard_ksbs (id,ksb_code,ksb_description) VALUES (991001,' K1 ','Authoritative standard')")
        for identifier, component, status in (
                ('KSB-MAP-A', 'KSB-C-FREE', 'active'),
                ('KSB-MAP-B', 'KSB-C-FREE-SECOND', 'inactive'),
                ('KSB-MAP-REGULAR', 'KSB-C-REGULAR', 'active')):
            ModuleAuthoringKsbMapping.objects.create(
                id=identifier, component_id=component, standard_ksb_id=991001,
                ksb_id='original-reference', classification='main', weight=40,
                source_type='standard', source_id='synthetic', status=status)

    def rollback(self):
        transaction.set_rollback(True)
        self.atomic.__exit__(None, None, None)
        learning_storage.reset()
        database_reads._TABLE_COLUMNS_CACHE.clear()

    def source_rows(self):
        with connection.cursor() as cursor:
            cursor.execute('SELECT to_jsonb(k) FROM curriculum.ksb_mappings k ORDER BY id')
            return cursor.fetchall()

    def copied_mappings(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT ksb_mappings FROM curriculum.free_courses WHERE content_ref='KSB-FREE'")
            value = cursor.fetchone()[0]
            return json.loads(value) if isinstance(value, str) else value

    def test_fixture_does_not_recreate_derived_columns(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='curriculum' AND table_name='ksb_mappings'")
            columns = {row[0] for row in cursor.fetchall()}
        self.assertFalse(columns & {'module_catalogue_id', 'week_id', 'ksb_code', 'ksb_description'})
        self.assertTrue({'component_id', 'standard_ksb_id', 'status'} <= columns)
        schema.prepare(connection)
        with connection.cursor() as cursor:
            cursor.execute('SELECT module_catalogue_id FROM ' + schema._ksb_read_source()
                           + ' WHERE module_catalogue_id=%s ORDER BY id', ['KSB-FREE'])
            self.assertEqual(cursor.fetchall(), [('KSB-FREE',), ('KSB-FREE',)])

    def test_preparation_preserves_mapping_identity_metadata_and_duplicate_codes(self):
        before = self.source_rows()
        schema.prepare(connection)
        rows = self.copied_mappings()
        self.assertEqual([row['id'] for row in rows], ['KSB-MAP-A', 'KSB-MAP-B'])
        self.assertEqual([row['status'] for row in rows], ['active', 'inactive'])
        self.assertEqual([row['component_id'] for row in rows], ['KSB-C-FREE', 'KSB-C-FREE-SECOND'])
        for row in rows:
            self.assertEqual((row['module_catalogue_id'], row['week_id']), ('KSB-FREE', 'KSB-W-FREE'))
            self.assertEqual((row['ksb_code'], row['ksb_description']), (' K1 ', 'Authoritative standard'))
            self.assertEqual((row['standard_ksb_id'], row['ksb_id'], row['weight'], row['classification']),
                             (991001, 'original-reference', 40, 'main'))
        self.assertEqual(self.source_rows(), before)

    def test_repeated_preparation_preserves_rows_and_mapping_order(self):
        before = self.source_rows()
        schema.prepare(connection)
        copied = self.copied_mappings()
        schema.prepare(connection)
        self.assertEqual(self.copied_mappings(), copied)
        self.assertEqual(self.source_rows(), before)

    def test_mixed_view_reads_live_placement_and_standard_values(self):
        schema.prepare(connection)
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.standard_ksbs SET ksb_code='K2',ksb_description='Updated standard' WHERE id=991001")
            cursor.execute("UPDATE curriculum.components SET week_id='KSB-W-REGULAR',module_catalogue_id='KSB-REGULAR' WHERE id='KSB-C-FREE'")
            cursor.execute('''SELECT module_catalogue_id,week_id,ksb_code,ksb_description
                FROM curriculum.learning_ksb_mappings WHERE id='KSB-MAP-A' ''')
            self.assertEqual(cursor.fetchone(), ('KSB-REGULAR', 'KSB-W-REGULAR', 'K2', 'Updated standard'))

    def test_preparation_never_overwrites_independent_native_data(self):
        schema.prepare(connection)
        copied = self.copied_mappings()
        with connection.cursor() as cursor:
            # A synthetic marker tests repeat-preparation protection only;
            # the destructive storage cutover is deliberately not invoked.
            cursor.execute("UPDATE curriculum.free_courses SET storage_version=2 WHERE content_ref='KSB-FREE'")
            cursor.execute("UPDATE curriculum.standard_ksbs SET ksb_code='CHANGED' WHERE id=991001")
        schema.prepare(connection)
        self.assertEqual(self.copied_mappings(), copied)
        with connection.cursor() as cursor:
            cursor.execute('''SELECT id,module_catalogue_id,week_id,ksb_code,ksb_description
                FROM curriculum.free_authoring_ksb_mappings ORDER BY id''')
            self.assertEqual(cursor.fetchall(), [
                ('KSB-MAP-A', 'KSB-FREE', 'KSB-W-FREE', ' K1 ', 'Authoritative standard'),
                ('KSB-MAP-B', 'KSB-FREE', 'KSB-W-FREE', ' K1 ', 'Authoritative standard')])
