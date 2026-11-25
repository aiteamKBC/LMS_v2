"""Actual row-writer SQL plus orchestration transactions on disposable fixtures."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch
import unittest

from django.db import connection, transaction
from curriculum_api import views, learning_storage
from curriculum_api.catalogue.infrastructure import authoring_writes
from curriculum_api.catalogue.tests.test_authoring_storage_boundary_no_db import storage_scope, free_ports
from curriculum_api.catalogue.tests.test_module_commands_boundary_no_db import recording

TABLE = 'phase1f_authoring_storage.rows'


def query(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        if cursor.description:
            names = [c[0] for c in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]
    return []


class AuthoringStoragePostgreSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['HOST'] == '127.0.0.1'
        assert connection.settings_dict['NAME'] == 'phase1f'
        query('CREATE SCHEMA phase1f_authoring_storage')
        query(f'CREATE TABLE {TABLE} (id text primary key, title text, module_catalogue_id text, created_at timestamp, updated_at timestamp)')
        query('CREATE TABLE phase1f_authoring_storage.journal (position integer GENERATED ALWAYS AS IDENTITY, kind text, payload jsonb)')

    def ports(self, events):
        return {'column_names': Mock(return_value=['id', 'title', 'module_catalogue_id', 'created_at', 'updated_at']),
                'curriculum_names': SimpleNamespace(store_staff=lambda table, payload, writable: (payload, set())),
                'write_shape': SimpleNamespace(normalise=lambda table, payload, writable: (payload, set())),
                'authoring_table_name': Mock(return_value=TABLE),
                'authoring_fetch_all': Mock(side_effect=lambda table, where, params: query(f'SELECT * FROM {TABLE} WHERE {where}', params)),
                'written_rows': Mock(side_effect=lambda table, rows: rows),
                'note_previous_content_modules': recording(events, 'previous'),
                'note_live_rows': recording(events, 'live'),
                'versioning': SimpleNamespace(record_rows=recording(events, 'history'))}

    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def upsert(self, original, *, rollback=False):
        query(f'TRUNCATE {TABLE}')
        events = []
        with storage_scope(original, events, self.ports(events), atomic=False), composition_fixture(learning_storage, 'upsert', return_value=None):
            with transaction.atomic():
                first = views.authoring_upsert('weeks', ['id'], {'id': 'A', 'title': 'Keep', 'module_catalogue_id': 'M', 'created_at': datetime(2000, 1, 1)})
                second = views.authoring_upsert('weeks', ['id'], {'id': 'A', 'title': None, 'module_catalogue_id': None, 'created_at': datetime(2020, 1, 1)}, allow_null_columns=['module_catalogue_id'])
                if rollback:
                    transaction.set_rollback(True)
        return first, second, query(f'SELECT * FROM {TABLE}'), events

    def test_actual_upsert_preserves_creation_and_unsent_values_allows_explicit_null(self):
        with patch.object(authoring_writes, 'authoring_upsert', wraps=authoring_writes.authoring_upsert) as invoked:
            actual = self.upsert(False)
        self.assertEqual(invoked.call_count, 2)
        self.assertEqual(actual, self.upsert(True))
        row = actual[2][0]
        self.assertEqual((row['title'], row['created_at']), ('Keep', datetime(2000, 1, 1)))
        self.assertIsNone(row['module_catalogue_id'])

    def test_upsert_keeps_callers_rollback(self):
        self.assertEqual(self.compare(lambda old: self.upsert(old, rollback=True))[2], [])

    def test_bulk_multiple_batches_keep_creation_time_and_actual_stored_history(self):
        def scenario(original):
            query(f'TRUNCATE {TABLE}')
            query(f"INSERT INTO {TABLE} (id,title,created_at) VALUES ('A','Before','2000-01-01')")
            events = []
            with storage_scope(original, events, self.ports(events), atomic=False), composition_fixture(learning_storage, 'upsert', return_value=None):
                views.authoring_bulk_upsert('weeks', ['id'], [{'id': ident, 'title': 'After ' + ident} for ident in ('A', 'B', 'C')], batch_size=2)
            return query(f'SELECT * FROM {TABLE} ORDER BY id'), events
        rows, events = self.compare(scenario)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]['created_at'], datetime(2000, 1, 1))
        history = [e for e in events if e[0] == 'history']
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0][1][1], rows)

    def test_update_sql_is_scoped_and_no_writable_fields_returns_existing_rows(self):
        def scenario(original, empty):
            query(f'TRUNCATE {TABLE}')
            query(f"INSERT INTO {TABLE} (id,title) VALUES ('A','Before'),('B','Other')")
            events = []
            with storage_scope(original, events, self.ports(events), atomic=False), composition_fixture(learning_storage, 'update', return_value=[]):
                result = views.update_authoring_rows('weeks', 'id = %s', ['A'], {'unknown': 'ignored'} if empty else {'title': None})
            return result, query(f'SELECT * FROM {TABLE} ORDER BY id'), events
        for empty in (False, True):
            result, rows, events = self.compare(lambda old: scenario(old, empty))
            self.assertEqual(result[0]['id'], 'A')
            self.assertEqual(rows[1]['title'], 'Other')
            self.assertEqual(rows[0]['title'], 'Before' if empty else None)

    def free_save(self, original, *, fail=False, outer_rollback=False):
        query('TRUNCATE phase1f_authoring_storage.journal RESTART IDENTITY')
        events = []
        values = free_ports(events)
        def write(kind, payload):
            self.assertTrue(connection.in_atomic_block)
            query('INSERT INTO phase1f_authoring_storage.journal(kind,payload) VALUES (%s,%s::jsonb)', [kind, json.dumps(payload, default=str)])
            if fail and kind == views.FREE_PROGRAMME_COMPONENTS_TABLE:
                raise ValueError('component persistence refused')
            return payload
        values.update(authoring_upsert=Mock(side_effect=lambda table, keys, payload: write(table, payload)),
                      free_programme_upsert=Mock(side_effect=lambda table, keys, payload: write(table, payload)))
        payload = {'modules': [{'courseId': 'C', 'courseName': 'Synthetic', 'weekTitle': 'Week',
                               'components': [{'id': 'X', 'title': 'Reading', 'type': 'reading', 'expectedOtjh': 2}]}]}
        with storage_scope(original, events, values, atomic=False):
            try:
                with transaction.atomic():
                    result = views.save_free_programme_modules('P', payload)
                    if outer_rollback:
                        transaction.set_rollback(True)
            except ValueError as exc:
                result = str(exc)
        return result, query('SELECT kind,payload FROM phase1f_authoring_storage.journal ORDER BY position')

    def test_free_programme_transaction_commits_same_ordered_rows(self):
        result, rows = self.compare(self.free_save)
        self.assertEqual([r['kind'] for r in rows], [views.AUTHORING_WEEKS_TABLE, views.FREE_PROGRAMME_MODULES_TABLE, views.FREE_PROGRAMME_COMPONENTS_TABLE, views.FREE_COURSES_TABLE])

    def test_free_programme_partial_failure_rolls_back_prior_rows(self):
        result, rows = self.compare(lambda old: self.free_save(old, fail=True))
        self.assertEqual(result, 'component persistence refused')
        self.assertEqual(rows, [])

    def test_free_programme_respects_outer_transaction(self):
        self.assertEqual(self.compare(lambda old: self.free_save(old, outer_rollback=True))[1], [])
