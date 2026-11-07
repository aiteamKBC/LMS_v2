"""DB-free guards for the normalised Curriculum learner read contract."""

import inspect
import re
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from curriculum_api.canonical_read_sql import (component_ksb_codes_sql,
                                                component_ksb_mappings_sql,
                                                current_status_sql)
from curriculum_api.week_visibility import visible_child_sql

from . import (active_users, attendance_lectures, components, dashboard_header, dashboard_metrics, dashboard_training,
               learner_detail, my_learning, overview_week,
               training_plan_dashboard)


class CanonicalKsbReadTests(SimpleTestCase):
    def test_progress_write_guard_uses_status_for_normalised_lineage(self):
        sql = active_users._COMPONENT_LINEAGE_DELETED_SQL
        for alias in ('c', 'w', 'm'):
            self.assertIn(current_status_sql(alias), sql)
            for removed in ('deleted_at', 'deleted_by', 'deleted_via_parent', 'is_programme_deleted'):
                self.assertNotIn(f'{alias}.{removed}', sql)

    def test_progress_snapshot_derives_component_mappings_canonically(self):
        source = inspect.getsource(active_users._component_learning_context)
        self.assertIn("component_ksb_mappings_sql('c')", source)
        for removed in (
            'c.ksb_mappings', 'ksb_code, ksb_description',
            'deleted_at is null', 'is_programme_deleted',
        ):
            self.assertNotIn(removed, source)

    def test_component_completion_reads_ksbs_through_the_standard_fk(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('K1', 25), ('K2', None)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch.object(components, 'connections') as connections:
            connections.__getitem__.return_value = connection
            mappings = components._component_ksb_mappings('COMP-1')

        self.assertEqual(mappings, [
            {'code': 'K1', 'weight': 25},
            {'code': 'K2', 'weight': 0},
        ])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ['COMP-1'])
        self.assertIn('FROM curriculum.ksb_mappings mapping', sql)
        self.assertIn(
            'JOIN curriculum.standard_ksbs standard_ksb '
            'ON standard_ksb.id = mapping.standard_ksb_id',
            sql,
        )
        self.assertIn('mapping.component_id = %s', sql)
        self.assertIn(current_status_sql('mapping'), sql)
        for removed in (
            'components.ksb_mappings', 'mapping.ksb_code',
            'mapping.deleted_at', 'mapping.is_programme_deleted',
            'mapping.module_catalogue_id', 'mapping.week_id',
        ):
            self.assertNotIn(removed, sql)

    def test_component_mapping_json_comes_from_the_standard_fk(self):
        sql = component_ksb_mappings_sql('c')
        self.assertIn('mapping.component_id=c.id', sql)
        self.assertIn(
            'JOIN curriculum.standard_ksbs standard_ksb '
            'ON standard_ksb.id = mapping.standard_ksb_id',
            sql,
        )
        self.assertIn("'code',standard_ksb.ksb_code", sql)
        self.assertIn("'description',standard_ksb.ksb_description", sql)
        self.assertIn("'ksbId',mapping.ksb_id", sql)
        self.assertIn("'sourceType',mapping.source_type", sql)
        self.assertIn("'sourceId',mapping.source_id", sql)
        self.assertIn(current_status_sql('mapping'), sql)
        for removed in ('c.ksb_mappings', 'mapping.ksb_code', 'mapping.ksb_description',
                        'mapping.module_catalogue_id', 'mapping.week_id',
                        'mapping.deleted_at', 'mapping.deleted_via_parent'):
            self.assertNotIn(removed, sql)

    def test_compact_component_codes_use_the_same_canonical_relationship(self):
        sql = component_ksb_codes_sql('c')
        self.assertIn('mapping.component_id=c.id', sql)
        self.assertIn('standard_ksb.id = mapping.standard_ksb_id', sql)
        self.assertIn("'code',standard_ksb.ksb_code", sql)
        self.assertIn(current_status_sql('mapping'), sql)
        self.assertNotIn('description', sql)
        for removed in ('c.ksb_mappings', 'mapping.ksb_code',
                        'mapping.module_catalogue_id', 'mapping.week_id',
                        'mapping.deleted_at', 'mapping.deleted_via_parent'):
            self.assertNotIn(removed, sql)

    def test_priority_readers_do_not_query_removed_child_columns(self):
        source = '\n'.join(inspect.getsource(module) for module in (
            attendance_lectures, dashboard_header, dashboard_metrics, dashboard_training,
            learner_detail, my_learning, overview_week,
            training_plan_dashboard,
        ))
        forbidden = re.compile(
            r'\b(?:w|weeks|components|mapping)\.'
            r'(?:deleted_at|deleted_by|deleted_via_parent|is_programme_deleted|'
            r'library_state|detached_at|origin_module_catalogue_id|origin_module_title|'
            r'origin_week_id|origin_week_label|ksb_code|ksb_description)\b|'
            r'\bc\.ksb_mappings\b'
        )
        self.assertEqual(forbidden.findall(source), [])


class AttendanceLectureCanonicalReadTests(SimpleTestCase):
    def _component_sql(self, *, monthly=False):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('MOD-1',)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch.object(attendance_lectures, 'connections', {'enrolment': connection}), \
                patch.object(attendance_lectures, 'effective_assigned_module_ids', return_value=['MOD-1']), \
                patch.object(attendance_lectures, 'dict_rows', return_value=[]), \
                patch.object(attendance_lectures, '_direct_progress_records', return_value=[]):
            attendance_lectures.read_native_components(
                SimpleNamespace(id=17), {'MOD-1'}, monthly=monthly,
            )

        return cursor.execute.call_args_list[1].args[0]

    def test_attendance_component_query_uses_canonical_fk_and_status_reads(self):
        sql = self._component_sql()
        self.assertIn(component_ksb_mappings_sql('c'), sql)
        self.assertIn(component_ksb_codes_sql('c'), sql)
        self.assertIn(visible_child_sql('c'), sql)
        self.assertIn(visible_child_sql('w'), sql)
        self.assertNotIn("= 'active'", sql)
        for removed in (
            'c.ksb_mappings', 'c.deleted_at', 'c.is_programme_deleted',
            'w.deleted_at', 'w.is_programme_deleted',
            'mapping.ksb_code', 'mapping.deleted_at',
        ):
            self.assertNotIn(removed, sql)

    def test_monthly_attendance_shape_stays_lightweight_and_canonical(self):
        sql = self._component_sql(monthly=True)
        self.assertIn("'[]'::jsonb AS ksb_mappings", sql)
        self.assertIn('NULL::jsonb AS mapped_ksbs', sql)
        self.assertNotIn('FROM curriculum.ksb_mappings', sql)
        self.assertIn(visible_child_sql('c'), sql)
        self.assertIn(visible_child_sql('w'), sql)


class ApiShapeTests(SimpleTestCase):
    def test_derived_mapping_keeps_existing_response_keys(self):
        sql = component_ksb_mappings_sql('component')
        for key in ('code', 'description', 'ksbId', 'classification', 'weight',
                    'weightClass', 'sourceType', 'sourceId'):
            self.assertIn(f"'{key}'", sql)

