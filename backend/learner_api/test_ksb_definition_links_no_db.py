from types import SimpleNamespace

from django.test import SimpleTestCase

from . import ksb_definition_links as links
from .models import LearnerProgressKsb


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.execute_args = None

    def execute(self, sql, params):
        self.execute_args = (sql, params)

    def fetchall(self):
        return self.rows


class KsbDefinitionLinkTests(SimpleTestCase):
    def test_profile_scoped_lookup_keeps_learners_on_different_versions(self):
        cursor = FakeCursor([
            (11, 'K1', 101),
            (12, 'K1', 202),
            # An invalid duplicate assignment/profile result is ambiguous.
            (13, 'K1', 301),
            (13, 'K1', 302),
        ])

        resolved = links.assigned_definition_ids(
            cursor, [11, 12, 13], [{'ksb_code': 'k1'}],
        )

        self.assertEqual(resolved, {(11, 'K1'): 101, (12, 'K1'): 202})
        self.assertIn('ksb_standard_versions', cursor.execute_args[0])
        self.assertIn('d.standard_ref=v.standard_ref AND d.standard_version=v.standard_version', cursor.execute_args[0])
        self.assertEqual(cursor.execute_args[1], [[11, 12, 13], ['K1']])

    def test_unchanged_mapping_preserves_its_historical_definition(self):
        current = [{
            'position': 1, 'ksb_code': 'K1', 'ksb_definition_id': 77,
            'source_type': 'standard', 'source_id': 'ST-OLD',
        }]
        desired = [{
            'position': 1, 'ksb_code': 'K1',
            'source_type': 'standard', 'source_id': 'ST-OLD',
        }]

        result = links.attach_definition_ids(
            desired, 11, {(11, 'K1'): 99}, existing=current,
        )

        self.assertEqual(result[0]['ksb_definition_id'], 77)

    def test_unchanged_historical_null_is_not_silently_backfilled(self):
        current = [{
            'position': 1, 'ksb_code': 'K1', 'ksb_definition_id': None,
            'source_type': '', 'source_id': '',
        }]
        desired = [{
            'position': 1, 'ksb_code': 'K1', 'source_type': '', 'source_id': '',
        }]

        result = links.attach_definition_ids(
            desired, 11, {(11, 'K1'): 99}, existing=current,
        )

        self.assertIsNone(result[0]['ksb_definition_id'])

    def test_new_mapping_uses_only_the_assigned_profile_definition(self):
        rows = links.attach_definition_ids(
            [{'position': 1, 'ksb_code': 'K2', 'source_type': 'standard', 'source_id': 'ST-1'}],
            11,
            {(11, 'K2'): 102},
        )
        self.assertEqual(rows[0]['ksb_definition_id'], 102)

        unresolved = links.attach_definition_ids(
            [{'position': 1, 'ksb_code': 'K2'}], 99, {},
        )
        self.assertIsNone(unresolved[0]['ksb_definition_id'])

    def test_explicit_definition_must_match_profile_and_code_resolution(self):
        accepted = links.attach_definition_ids(
            [{'position': 1, 'ksb_code': 'K1', 'ksbDefinitionId': 101}],
            11,
            {(11, 'K1'): 101},
        )
        rejected = links.attach_definition_ids(
            [{'position': 1, 'ksb_code': 'K1', 'ksbDefinitionId': 999}],
            11,
            {(11, 'K1'): 101},
        )
        self.assertEqual(accepted[0]['ksb_definition_id'], 101)
        self.assertIsNone(rejected[0]['ksb_definition_id'])

    def test_model_maps_the_existing_nullable_foreign_key_column(self):
        field = LearnerProgressKsb._meta.get_field('standard_ksb')
        self.assertEqual(field.column, 'standard_ksb_id')
        self.assertTrue(field.null)
        self.assertEqual(field.remote_field.model._meta.db_table, 'curriculum"."ksb_standard_definitions')

