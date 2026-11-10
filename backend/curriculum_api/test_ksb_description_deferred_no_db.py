"""Curriculum mapping reads leave the standard KSB text out of their SQL.

The description is the standard KSB's, repeated on every mapping row (2.5 MB
of a programme's 6 MB mapping read for 235 distinct rows). Curriculum reads
defer it and project_rows() fills it from a cached standard_ksbs lookup;
hand-written SQL through the relation still gets the column. Nothing here
opens a connection.
"""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import schema_compat as sc
from curriculum_api import views
from curriculum_api.test_schema_compat_no_db import NORMALISED_KSB, PostgresVendor


class FakeCursor:
    def __init__(self, rows_by_table):
        self.rows_by_table, self.queries, self._rows = rows_by_table, [], []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.queries.append(sql)
        self._rows = next((rows for table, rows in self.rows_by_table.items() if table in sql), [])

    def fetchall(self):
        return self._rows


def fake_connection(rows_by_table):
    cursor = FakeCursor(rows_by_table)
    connection = mock.MagicMock(vendor='postgresql')
    connection.cursor.return_value = cursor
    return connection, cursor


class DeferredRelationTests(SimpleTestCase):
    def test_deferring_drops_only_the_description_from_the_relation(self):
        with PostgresVendor():
            relation = sc.read_relation('ksb_mappings', NORMALISED_KSB, defer={'ksb_description'})
        self.assertNotIn('ksb_description', relation)
        self.assertIn('as "ksb_code"', relation)               # still filterable in SQL
        self.assertIn('as "module_catalogue_id"', relation)

    def test_hand_written_sql_still_reads_the_description(self):
        with PostgresVendor():
            self.assertIn('as "ksb_description"', sc.relation_sql('ksb_mappings'))

    def test_curriculum_select_defers_it_and_keeps_the_key_it_is_looked_up_by(self):
        with PostgresVendor(), \
             mock.patch.object(views, 'column_names', return_value=NORMALISED_KSB), \
             mock.patch.object(views.archive_state, 'uses_status', return_value=True):
            narrow = views.authoring_select_sql('ksb_mappings', 'component_id = %s', columns=['id', 'ksb_description'],
                                                ensure_tables=False)
            everything = views.authoring_select_sql('ksb_mappings', ensure_tables=False)
        self.assertNotIn('ksb_description', narrow)
        self.assertIn('"standard_ksb_id"', narrow)
        self.assertNotIn('ksb_description', everything)


class ProjectionTests(SimpleTestCase):
    def setUp(self):
        sc.reset_standard_ksb_texts()
        self.addCleanup(sc.reset_standard_ksb_texts)

    def test_only_the_description_is_derived_and_components_are_not_reread(self):
        rows = [{'id': 'M1', 'component_id': 'C1', 'standard_ksb_id': 7, 'module_catalogue_id': 'MOD', 'week_id': 'W',
                 'ksb_code': 'K1', 'status': 'active'}]
        connection, cursor = fake_connection({'standard_ksbs': [(7, 'K1', 'Knows things')]})
        with mock.patch.object(sc, 'connection', connection):
            sc.project_rows('ksb_mappings', rows, NORMALISED_KSB)
        self.assertEqual(rows[0]['ksb_description'], 'Knows things')
        self.assertFalse(any('components' in sql for sql in cursor.queries))

    def test_standard_texts_are_read_once_then_served_from_memory(self):
        connection, cursor = fake_connection({'standard_ksbs': [(7, 'K1', 'Knows things')]})
        with mock.patch.object(sc, 'connection', connection):
            self.assertEqual(sc.standard_ksb_texts([7]), {7: ('K1', 'Knows things')})
            self.assertEqual(sc.standard_ksb_texts([7, None]), {7: ('K1', 'Knows things')})
        self.assertEqual(len(cursor.queries), 1)

    def test_standard_texts_are_reread_after_the_ttl(self):
        connection, cursor = fake_connection({'standard_ksbs': [(7, 'K1', 'Knows things')]})
        with mock.patch.object(sc, 'connection', connection), mock.patch.object(sc.time, 'monotonic') as clock:
            clock.return_value = 1000.0
            sc.standard_ksb_texts([7])
            clock.return_value = 1000.0 + sc.STANDARD_TEXTS_TTL_SECONDS + 1
            sc.standard_ksb_texts([7])
        self.assertEqual(len(cursor.queries), 2)
