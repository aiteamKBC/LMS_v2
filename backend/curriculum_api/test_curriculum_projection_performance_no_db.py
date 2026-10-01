from contextlib import contextmanager
from unittest.mock import patch

from django.test import SimpleTestCase

from . import views


class CurriculumProjectionPerformanceTests(SimpleTestCase):
    def test_ksb_scope_reads_only_component_columns_used_by_projection(self):
        module = {'module_catalogue_id': 'MOD-1', 'title': 'Module'}

        def child_rows(table, module_ids, **kwargs):
            if table == views.AUTHORING_WEEKS_TABLE:
                return [{'id': 'WEEK-1', 'module_catalogue_id': 'MOD-1'}]
            if table == views.AUTHORING_COMPONENTS_TABLE:
                return [{
                    'id': 'COMP-1', 'week_id': 'WEEK-1',
                    'module_catalogue_id': 'MOD-1', 'type': 'reading',
                    'title': 'Read', 'expected_otjh': 1,
                    'is_programme_deleted': False, 'deleted_at': None,
                    'library_state': '',
                }]
            return []

        with patch.object(views, 'ensure_module_authoring_tables'), \
             patch.object(views, 'authoring_fetch_all', return_value=[module]), \
             patch.object(views, 'resolve_authoring_catalogue_id', return_value='MOD-1'), \
             patch.object(views, 'authoring_child_rows_for_modules', side_effect=child_rows) as children:
            modules, weeks, components, mappings = views.authoring_scope_data('module', 'MOD-1')

        self.assertEqual(modules, [module])
        self.assertEqual(len(weeks), 1)
        self.assertEqual(len(components), 1)
        self.assertEqual(mappings, [])
        component_call = next(
            call for call in children.call_args_list
            if call.args[0] == views.AUTHORING_COMPONENTS_TABLE
        )
        self.assertEqual(component_call.kwargs, {'columns': views.COMPONENT_KSB_SCOPE_COLUMNS})
        self.assertNotIn('settings_json', views.COMPONENT_KSB_SCOPE_COLUMNS)
        self.assertNotIn('ksb_mappings', views.COMPONENT_KSB_SCOPE_COLUMNS)

    def test_programme_card_ksb_totals_uses_filtered_progress_query(self):
        executed = {}

        class Cursor:
            def execute(self, sql, params):
                executed['sql'] = sql
                executed['params'] = params

        class PostgresConnection:
            vendor = 'postgresql'

            @contextmanager
            def cursor(self):
                yield Cursor()

        rows = [
            {
                'learner_id': 1, 'progress_id': 20, 'kind': 'reading',
                'component_ref': 'COMP-1', 'passed': None,
                'ksb_code': ' k1 ', 'weight': 20,
            },
            {
                'learner_id': 1, 'progress_id': 19, 'kind': 'reading',
                'component_ref': 'COMP-1', 'passed': None,
                'ksb_code': 'K1', 'weight': 20,
            },
            {
                'learner_id': 1, 'progress_id': 18, 'kind': 'quiz',
                'component_ref': 'COMP-2', 'passed': False,
                'ksb_code': 'K1', 'weight': 50,
            },
            {
                'learner_id': 2, 'progress_id': 17, 'kind': 'quiz',
                'component_ref': 'COMP-3', 'passed': True,
                'ksb_code': 'K2', 'weight': 15,
            },
        ]

        with patch.object(views, 'connection', PostgresConnection()), \
             patch.object(views, 'learner_schema_table_exists', return_value=True), \
             patch.object(views, 'rows_as_dicts', return_value=rows):
            totals = views.learner_progress_ksb_totals([1, 2], ['k2', 'K1', 'K1'])

        self.assertEqual(totals, {1: {'K1': 20.0}, 2: {'K2': 15.0}})
        sql = ' '.join(executed['sql'].lower().split())
        self.assertIn('join "learner"."learner_progress_ksbs"', sql)
        self.assertNotIn('left join', sql)
        self.assertNotIn('curriculum.components', sql)
        self.assertIn('k.ksb_code = any(%s)', sql)
        self.assertNotIn('upper(btrim(k.ksb_code))', sql)
        self.assertEqual(executed['params'], [[1, 2], ['K1', 'K2']])
