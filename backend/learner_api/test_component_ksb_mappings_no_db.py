"""Curriculum mappings exposed to learners; synthetic rows, no database access."""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import learner_detail
from .tests_weekly_learning import FakeCursor


class ComponentKsbMappingReadTests(SimpleTestCase):
    def test_cached_regular_hours_keep_independent_course_hours_and_null_values(self):
        connection = MagicMock(vendor='postgresql')
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('FREE', 1.5)]
        with patch.object(learner_detail, 'connections', {'enrolment': connection}), \
                patch.object(learner_detail, '_cached_expected_otjh', return_value={'REGULAR': 2, 'UNSET': None}), \
                patch('curriculum_api.learning_storage.enabled', return_value=True):
            result = learner_detail._otjh_by_component_id(
                [{'componentId': cid} for cid in ('FREE', 'REGULAR', 'UNSET')])
        self.assertEqual(result, {'FREE': 1.5, 'REGULAR': 2.0, 'UNSET': None})
        statement, params = cursor.execute.call_args.args
        self.assertIn('"curriculum"."learning_components"', statement)
        self.assertEqual(params, [['FREE']])

    def resolve(self, inline=None, mapping_rows=None, **options):
        class Cursor(FakeCursor):
            def execute(self, sql, params=None):
                super().execute(sql, params)
                if 'FROM curriculum.components WHERE' in sql:
                    self.rows = [
                        (cid, 'W1', 'M1', 'reading', title, '', {}, None, order,
                         inline if cid == 'C1' else None, False, None, False, 1.5)
                        for cid, title, order in [('C1', 'First activity', 1), ('C2', 'Second activity', 2)]
                    ]
                elif 'FROM curriculum.ksb_mappings mapping' in sql:
                    self.rows = mapping_rows or []
                    if 'NULL AS ksb_description' in sql:
                        self.rows = [(cid, code, None, *rest) for cid, code, _description, *rest in self.rows]

        cursor = Cursor()
        connection = MagicMock()
        connection.cursor.return_value = cursor
        with patch.object(learner_detail, 'connections', {'enrolment': connection}):
            _, _, components = learner_detail._resolve_from_master(
                [], [], [], assigned_modules=[{'moduleId': 'M1'}], live_session_ids=False, **options)
        self.assertFalse(any(sql.lstrip().upper().startswith(('UPDATE ', 'INSERT ', 'DELETE '))
                             for sql in cursor.statements))
        return {item['componentId']: item for item in components}

    def test_all_normalized_mappings_reach_full_and_compact_activity_reads(self):
        rows = [
            ('C1', 'K1', 'Mapped knowledge', 'main', 20, 'hard'),
            ('C1', 'S2', 'Mapped skill', 'secondary', 30, 'soft'),
            ('C1', 'B3', 'Mapped behaviour', 'possible', 10, 'possible'),
            ('C2', 'K99', 'Other activity', 'main', 5, 'hard'),
        ]
        for options in ({}, {'compact': True}, {'compact': True, 'compact_content': True}):
            with self.subTest(options=options):
                result = self.resolve(mapping_rows=rows, **options)
                self.assertEqual([item['code'] for item in result['C1']['ksbMappings']], ['K1', 'S2', 'B3'])
                self.assertEqual([item['description'] for item in result['C1']['ksbMappings']],
                                 [None, None, None] if options.get('compact_content') else
                                 ['Mapped knowledge', 'Mapped skill', 'Mapped behaviour'])
                self.assertEqual(result['C1']['ksbMappingCount'], 3)
                self.assertEqual(result['C1']['ksbWeightTotal'], 60)
                self.assertEqual([item['code'] for item in result['C2']['ksbMappings']], ['K99'])
                self.assertEqual(result['C2']['ksbMappingCount'], 1)
                self.assertEqual(result['C2']['ksbWeightTotal'], 5)

    def test_inline_mapping_remains_authoritative_without_adding_stale_rows(self):
        inline = [
            {'code': 'K4', 'description': 'Current knowledge', 'classification': 'main', 'weight': 15},
            {'code': 'S5', 'description': 'Current skill', 'classification': 'secondary', 'weight': 25},
        ]
        result = self.resolve(inline=inline, mapping_rows=[
            ('C1', 'K1', 'Stale mapping', 'main', 99, 'hard'),
            ('C2', 'B1', 'First behaviour', 'main', 10, 'hard'),
            ('C2', 'B2', 'Second behaviour', 'secondary', 20, 'soft'),
        ])
        self.assertEqual([item['code'] for item in result['C1']['ksbMappings']], ['K4', 'S5'])
        self.assertEqual(result['C1']['ksbMappingCount'], 2)
        self.assertEqual(result['C1']['ksbWeightTotal'], 40)
        self.assertEqual([item['code'] for item in result['C2']['ksbMappings']], ['B1', 'B2'])
        self.assertEqual(result['C2']['ksbWeightTotal'], 30)

    def test_empty_mapping_remains_empty_without_inventing_programme_codes(self):
        for inline in (None, []):
            with self.subTest(inline=inline):
                result = self.resolve(inline=inline)
                for component in result.values():
                    self.assertEqual(component['ksbMappings'], [])
                    self.assertEqual(component['ksbMappingCount'], 0)
                    self.assertEqual(component['ksbWeightTotal'], 0)
