"""Hierarchy parity on disposable PostgreSQL only; no live/provider dependencies.

Row-adapter tests execute the existing authoring SQL against synthetic tables.
Tree tests exercise the actual HTTP/use-case/atomic boundary, with explicit
fixture storage ports, including failure after persisted intermediate writes.
"""
def composition_fixture(*args, **kwargs):
    from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture as inject
    return inject(*args, **kwargs)

import json
from contextlib import ExitStack
import unittest
from unittest.mock import Mock, patch

from django.db import connection, transaction, IntegrityError
from django.test import RequestFactory
from curriculum_api import views, learning_storage
from curriculum_api.catalogue.application import programme_tree
from curriculum_api.catalogue.infrastructure import hierarchy_writes
from curriculum_api.test_hierarchy_commands_boundary_no_db import original_hierarchy, FrozenClock


class HierarchyCommandsPostgreSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['HOST'] == '127.0.0.1'
        assert connection.settings_dict['NAME'] == 'phase1f'
        with connection.cursor() as cursor:
            cursor.execute('CREATE SCHEMA phase1f_hierarchy')
            cursor.execute('CREATE TABLE phase1f_hierarchy.cohorts (cohort_id text PRIMARY KEY, cohort_name text, epa_months integer, color text, created_at timestamp, updated_at timestamp)')
            cursor.execute('CREATE TABLE phase1f_hierarchy.groups (group_id text PRIMARY KEY, group_name text, cohort_id text REFERENCES phase1f_hierarchy.cohorts(cohort_id), color text, created_at timestamp, updated_at timestamp)')
            cursor.execute('CREATE TABLE phase1f_hierarchy.tree_writes (position integer GENERATED ALWAYS AS IDENTITY, kind text, identifier text)')

    def state(self, table):
        self.assertIn(table, ('cohorts', 'groups', 'tree_writes'))
        with connection.cursor() as cursor:
            cursor.execute('SELECT * FROM phase1f_hierarchy.' + table + (' ORDER BY position' if table == 'tree_writes' else ' ORDER BY 1'))
            return cursor.fetchall()

    def row_scenario(self, original, kind, clear=False, fail=False):
        with connection.cursor() as cursor:
            cursor.execute('TRUNCATE phase1f_hierarchy.groups, phase1f_hierarchy.cohorts')
            cursor.execute("INSERT INTO phase1f_hierarchy.cohorts(cohort_id, cohort_name, epa_months, color) VALUES ('C', 'Before', 3, 'red')")
        with ExitStack() as stack:
            def columns(table):
                return {'created_at', 'updated_at', 'color'} | ({'cohort_id', 'cohort_name', 'epa_months'} if table == views.COHORT_AUTHORING_DETAILS_TABLE else {'group_id', 'group_name', 'cohort_id'})
            def table_name(table):
                assert table in {views.COHORT_AUTHORING_DETAILS_TABLE, views.GROUPS_TABLE}
                return 'phase1f_hierarchy.' + ('cohorts' if table == views.COHORT_AUTHORING_DETAILS_TABLE else 'groups')
            patches = (
                composition_fixture(views, 'ensure_module_authoring_tables'),
                composition_fixture(views, 'column_names', side_effect=columns),
                composition_fixture(views, 'authoring_table_name', side_effect=table_name),
                composition_fixture(views, 'datetime', FrozenClock),
                composition_fixture(views, 'native_only', return_value=False),
                patch.object(views.curriculum_names, 'store_staff', side_effect=lambda t, p, c: (p, set())),
                patch.object(views.write_shape, 'normalise', side_effect=lambda t, p, c: (p, set())),
                composition_fixture(views, 'written_rows', side_effect=lambda t, rows: rows),
                composition_fixture(learning_storage, 'upsert', return_value=None),
                composition_fixture(learning_storage, 'update', return_value=[]),
                composition_fixture(views, 'note_previous_content_modules'),
                composition_fixture(views, 'note_live_rows'),
                composition_fixture(views, 'log_curriculum_storage'),
                patch.object(views.versioning, 'record_rows'),
                patch.object(views.calendar_holidays, 'store_cohort_choices'),
                patch.object(views.group_coaches, 'store'),
                composition_fixture(views, 'logger'),
                composition_fixture(views, 'cohort_authoring_payload', side_effect=lambda *a: {'cohort_id': 'C', 'cohort_name': 'After', 'epa_months': None}),
                composition_fixture(views, 'group_authoring_payload', side_effect=lambda *a: {'group_id': 'G', 'group_name': 'After', 'cohort_id': 'MISSING' if fail else 'C'}),
            )
            for patcher in patches:
                stack.enter_context(patcher)
            if original:
                stack.enter_context(original_hierarchy())
            error = None
            try:
                with transaction.atomic():
                    if clear:
                        result = views.update_cohort_fields(' C ', {'epa_months': None, 'color': None}, allow_null_columns=('epa_months',))
                    else:
                        result = getattr(views, 'persist_' + kind + '_authoring_detail')({}, raise_on_error=True)
            except IntegrityError:
                result, error = None, 'IntegrityError'
            return result, error, self.state('cohorts'), self.state('groups')

    def test_actual_cohort_upsert_and_nullable_update_sql(self):
        for clear in (False, True):
            with self.subTest(clear=clear):
                symbol = 'update_cohort_fields' if clear else 'persist_cohort_authoring_detail'
                with patch.object(hierarchy_writes, symbol, wraps=getattr(hierarchy_writes, symbol)) as invoked:
                    actual = self.row_scenario(False, 'cohort', clear=clear)
                invoked.assert_called_once()
                self.assertEqual(actual, self.row_scenario(True, 'cohort', clear=clear))
                self.assertIsNone(actual[2][0][2])
                self.assertEqual(actual[2][0][3], 'red')

    def test_actual_group_upsert_and_foreign_key_failure(self):
        for fail in (False, True):
            with self.subTest(fail=fail):
                actual = self.row_scenario(False, 'group', fail=fail)
                self.assertEqual(actual, self.row_scenario(True, 'group', fail=fail))
                self.assertEqual(len(actual[3]), 0 if fail else 1)
                self.assertEqual(actual[1], 'IntegrityError' if fail else None)

    def tree_scenario(self, original, fail=False, outer_rollback=False):
        with connection.cursor() as cursor:
            cursor.execute('TRUNCATE phase1f_hierarchy.tree_writes RESTART IDENTITY')
        def write(kind, identifier, result):
            def operation(*args, **kwargs):
                self.assertTrue(connection.in_atomic_block)
                with connection.cursor() as cursor:
                    cursor.execute('INSERT INTO phase1f_hierarchy.tree_writes(kind, identifier) VALUES (%s,%s)', [kind, identifier])
                if kind == 'group' and fail:
                    raise ValueError('synthetic failure after group INSERT')
                return result
            return Mock(side_effect=operation)
        with ExitStack() as stack:
            values = {
                'upsert_programme_for_tree': write('programme', 'P', {'id': 'P', 'name': 'Synthetic'}),
                'save_tree_cohort': write('cohort', 'C', {'id': 'C'}),
                'save_tree_group': write('group', 'G', {'id': 'G'}),
                'save_tree_group_modules': write('module', 'M', ([{'id': 'M'}], [])),
                'fetch_cohort_row': Mock(return_value={'cohort_id': 'C'}),
                'repair_curriculum_parent_links': Mock(),
                'invalidate_curriculum_cache': Mock(),
            }
            for name, value in values.items():
                stack.enter_context(composition_fixture(views, name, value))
            if original:
                stack.enter_context(original_hierarchy())
            request = RequestFactory().post('/synthetic/', json.dumps({'cohorts': [{'groups': [{'modules': [{}]}]}]}), content_type='application/json')
            with transaction.atomic():
                response = views.curriculum_programme_tree_save(request)
                inside = self.state('tree_writes')
                if outer_rollback:
                    transaction.set_rollback(True)
            return response.status_code, json.loads(response.content), inside, self.state('tree_writes')

    def test_tree_http_result_and_committed_write_order(self):
        with patch.object(programme_tree, 'save_programme_tree', wraps=programme_tree.save_programme_tree) as invoked:
            actual = self.tree_scenario(False)
        invoked.assert_called_once()
        self.assertEqual(actual, self.tree_scenario(True))
        self.assertEqual(actual[0], 200)
        self.assertEqual([r[1] for r in actual[3]], ['programme', 'cohort', 'group', 'module'])

    def test_tree_error_rolls_back_all_intermediate_writes(self):
        actual = self.tree_scenario(False, fail=True)
        self.assertEqual(actual, self.tree_scenario(True, fail=True))
        self.assertEqual((actual[0], actual[2], actual[3]), (400, [], []))

    def test_outer_rollback_retains_nested_transaction_contract(self):
        actual = self.tree_scenario(False, outer_rollback=True)
        self.assertEqual(actual, self.tree_scenario(True, outer_rollback=True))
        self.assertEqual(len(actual[2]), 4)
        self.assertEqual(actual[3], [])
