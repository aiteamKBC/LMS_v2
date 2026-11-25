"""Shared row persistence on disposable PostgreSQL; no existing application data."""
from contextlib import contextmanager
from unittest.mock import Mock, patch
import unittest

from django.db import connection, transaction, IntegrityError
from curriculum_api import views
from curriculum_api.catalogue.infrastructure import row_persistence
from curriculum_api.catalogue.application import programme_configuration
from curriculum_api.catalogue.tests.test_row_persistence_boundary_no_db import persistence_scope, write_ports
from curriculum_api.catalogue.tests.test_module_commands_boundary_no_db import recording

SCHEMA = 'phase1f_row_persistence'


def query(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        if cursor.description:
            names = [c[0] for c in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]
    return []


class RowPersistencePostgreSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['HOST'] == '127.0.0.1'
        assert connection.settings_dict['NAME'] == 'phase1f'
        query(f'CREATE SCHEMA {SCHEMA}')
        query(f'CREATE TABLE {SCHEMA}.rows (id text primary key, title text, module_catalogue_id text)')
        query(f'CREATE TABLE {SCHEMA}.programmes (programme_id text primary key, name text, status text, updated_at timestamp, created_at timestamp)')
        query(f'CREATE TABLE {SCHEMA}.modules (module_catalogue_id text primary key, title text, cohort_id text, group_id text)')

    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    @contextmanager
    def ports(self, old, events, *, columns=None, **extra):
        ports = write_ports(events, **({'columns': columns} if columns else {}))
        ports.update(table_name=lambda table: f'{SCHEMA}.{table}', execute_returning=query)
        ports.update(extra)
        with persistence_scope(old, **ports):
            yield

    def test_actual_insert_and_partial_update_preserve_other_rows_and_history_order(self):
        def scenario(old):
            query(f'TRUNCATE {SCHEMA}.rows')
            events = []
            with self.ports(old, events):
                first = views.insert_row('rows', {'id': 'A', 'title': 'Keep', 'module_catalogue_id': 'M'})
                views.insert_row('rows', {'id': 'B', 'title': 'Other'})
                changed = views.update_rows('rows', 'id = %s', ['A'], {'title': None, 'module_catalogue_id': None, 'unknown': 1}, ['module_catalogue_id'])
            return first, changed, query(f'SELECT * FROM {SCHEMA}.rows ORDER BY id'), events
        with patch.object(row_persistence, 'insert_row', wraps=row_persistence.insert_row) as insert, \
                patch.object(row_persistence, 'update_rows', wraps=row_persistence.update_rows) as update:
            actual = scenario(False)
        self.assertEqual((insert.call_count, update.call_count), (2, 1))
        self.assertEqual(actual, scenario(True))
        self.assertEqual(actual[2][0], {'id': 'A', 'title': 'Keep', 'module_catalogue_id': None})
        self.assertEqual(actual[2][1]['title'], 'Other')
        self.assertEqual([e[0] for e in actual[3]], ['history', 'live', 'history', 'live', 'previous', 'history', 'live'])

    def test_caller_transaction_rolls_back_insert_and_update(self):
        def scenario(old):
            query(f'TRUNCATE {SCHEMA}.rows')
            with self.ports(old, []), transaction.atomic():
                views.insert_row('rows', {'id': 'A', 'title': 'Before'})
                views.update_rows('rows', 'id = %s', ['A'], {'title': 'After'})
                transaction.set_rollback(True)
            return query(f'SELECT * FROM {SCHEMA}.rows')
        self.assertEqual(self.compare(scenario), [])

    def test_database_error_propagates_without_reporting_successful_write(self):
        def scenario(old):
            query(f'TRUNCATE {SCHEMA}.rows')
            query(f"INSERT INTO {SCHEMA}.rows(id,title) VALUES ('A','Original')")
            events = []
            with self.ports(old, events), self.assertRaises(IntegrityError):
                with transaction.atomic():
                    views.insert_row('rows', {'id': 'A', 'title': 'Duplicate'})
            return query(f'SELECT * FROM {SCHEMA}.rows'), events
        rows, events = self.compare(scenario)
        self.assertEqual(rows[0]['title'], 'Original')
        self.assertEqual(events, [])

    def test_programme_create_rename_and_repeated_save_preserve_identity_and_avoid_extra_writes(self):
        def scenario(old):
            query(f'TRUNCATE {SCHEMA}.programmes')
            events = []
            columns = ['programme_id', 'name', 'status', 'updated_at', 'created_at']
            with self.ports(old, events, columns=columns,
                    ensure_program_config_archive_columns=Mock(),
                    get_program_config_rows=lambda: query(f'SELECT * FROM {SCHEMA}.programmes ORDER BY programme_id'),
                    programme_config_key_column=lambda: 'programme_id',
                    unique_program_id=lambda requested, rows: requested or 'PROG-SYNTHETIC',
                    invalidate_curriculum_cache=recording(events, 'invalidate')):
                created = views.ensure_programme_config_for_authoring('First', 'PROG-SYNTHETIC')
                renamed = views.ensure_programme_config_for_authoring('Renamed', 'PROG-SYNTHETIC')
                before = len(events)
                repeated = views.ensure_programme_config_for_authoring('Renamed', 'PROG-SYNTHETIC')
                self.assertEqual(before, len(events))
            return created, renamed, repeated, query(f'SELECT * FROM {SCHEMA}.programmes'), events
        with patch.object(programme_configuration, 'ensure_programme_config_for_authoring', wraps=programme_configuration.ensure_programme_config_for_authoring) as invoked:
            actual = scenario(False)
        self.assertEqual(invoked.call_count, 3)
        self.assertEqual(actual, scenario(True))
        self.assertEqual([r['programme_id'] for r in actual[3]], ['PROG-SYNTHETIC'])
        self.assertEqual(actual[3][0]['name'], 'Renamed')

    def test_unassign_keeps_content_and_other_groups_and_respects_rollback(self):
        def scenario(old, rollback):
            query(f'TRUNCATE {SCHEMA}.modules')
            query(f"INSERT INTO {SCHEMA}.modules VALUES ('KEEP','Keep content','C','G'),('REMOVE','Retain content','C','G'),('OTHER','Other content','D','H')")
            def read(table, where, params):
                return query(f'SELECT * FROM {SCHEMA}.modules WHERE {where} ORDER BY module_catalogue_id', params)
            def update(table, where, params, payload):
                assignments = ', '.join(f'{views.quote_ident(k)} = %s' for k in payload)
                return query(f'UPDATE {SCHEMA}.modules SET {assignments} WHERE {where} RETURNING *', [*payload.values(), *params])
            with persistence_scope(old, authoring_fetch_all=read, update_authoring_rows=update), transaction.atomic():
                removed = views.unassign_authoring_modules_from_group(' G ', ['KEEP'])
                if rollback:
                    transaction.set_rollback(True)
            return removed, query(f'SELECT * FROM {SCHEMA}.modules ORDER BY module_catalogue_id')
        for rollback in (False, True):
            removed, rows = self.compare(lambda old: scenario(old, rollback))
            self.assertEqual(removed, ['REMOVE'])
            self.assertEqual(rows[2]['title'], 'Retain content')
            self.assertEqual(rows[2]['group_id'], 'G' if rollback else None)
            self.assertEqual([(r['module_catalogue_id'], r['group_id']) for r in rows[:2]], [('KEEP', 'G'), ('OTHER', 'H')])
