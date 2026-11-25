"""KSB standards migration: source resolution and exclusion registry.

No Django startup, database writes or network: every database read is replaced.
Covers both source types (manual profile, Skills England standard), archived
profiles, missing sources, and the exclusion predicate the achievement readers
share.
"""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from learner_api import curriculum, ksb_exclusions, ksb_sources
from learner_api.aptem_ksb_breakdown import read_breakdown

STANDARD_ROWS = [
    {'id': 501, 'ksb_code': 'K1', 'ksb_type': 'knowledge', 'ksb_description': 'Marketing theory',
     'standard_title': 'Marketing executive', 'standard_ref': 'ST0596'},
    {'id': 502, 'ksb_code': 'K1', 'ksb_type': 'knowledge', 'ksb_description': 'Duplicate row',
     'standard_title': 'Marketing executive', 'standard_ref': 'ST0596'},
    {'id': 503, 'ksb_code': 's2', 'ksb_type': 'skill', 'ksb_description': 'Plan campaigns',
     'standard_title': 'Marketing executive', 'standard_ref': 'ST0596'},
    {'id': 504, 'ksb_code': 'B8', 'ksb_type': 'behaviour', 'ksb_description': 'Ethical behaviour',
     'standard_title': 'Marketing executive', 'standard_ref': 'ST0596'},
]

MANUAL_ITEMS = [
    {'code': 'K1', 'type': 'K', 'number': '1', 'description': 'Marketing Concepts & Theories'},
    {'code': 'K1.1', 'type': 'K', 'number': '1.1', 'description': 'Marketing theory'},
    {'id': 'custom-id', 'code': '2', 'type': 'S', 'description': 'Plan campaigns'},
]


class ParseSourceTests(unittest.TestCase):
    def test_every_stored_form(self):
        cases = {
            'standard:st0596-v1-0': ('standard', 'st0596-v1-0'),
            'STANDARD:ST0596-V1-0': ('standard', 'st0596-v1-0'),
            'KSBP-20260610080934000011': ('profile', 'KSBP-20260610080934000011'),
            'profile:KSBP-1': ('profile', 'KSBP-1'),
            'framework:KSBP-1': ('profile', 'KSBP-1'),
            'ksb-KSBP-1': ('profile', 'KSBP-1'),
            '': ('', ''),
            None: ('', ''),
            '   ': ('', ''),
        }
        for value, expected in cases.items():
            self.assertEqual(ksb_sources.parse_source(value), expected, value)


class ResolveSourceTests(unittest.TestCase):
    def resolve(self, value, profile=None, rows=None):
        return ksb_sources.resolve_source(
            value,
            fetch_profile_fn=lambda _pid: profile,
            fetch_standard_fn=lambda _sid: list(rows or []),
        )

    def test_standard_items_come_from_the_standard_one_per_code(self):
        resolved = self.resolve('standard:st0596-v1-0', rows=STANDARD_ROWS)
        self.assertEqual(resolved.kind, 'standard')
        self.assertEqual(resolved.source_value, 'standard:st0596-v1-0')
        self.assertEqual(resolved.label, 'Marketing executive')
        self.assertEqual(resolved.standard_ref, 'st0596')
        self.assertEqual([i['code'] for i in resolved.items], ['K1', 'S2', 'B8'])
        self.assertEqual([i['type'] for i in resolved.items], ['K', 'S', 'B'])
        # Stable id whose last segment is the code (board_wizard reads it back).
        self.assertEqual(resolved.items[0]['id'], 'st0596-v1-0-K1')
        self.assertEqual(resolved.items[0]['description'], 'Marketing theory')

    def test_active_profile(self):
        profile = {'id': 'KSBP-1', 'name': 'Marketing executive', 'ksb_items': MANUAL_ITEMS,
                   'is_active': True, 'standard_source_id': 'st0596-v1-0'}
        resolved = self.resolve('KSBP-1', profile=profile)
        self.assertEqual((resolved.kind, resolved.source_id, resolved.active), ('profile', 'KSBP-1', True))
        self.assertEqual([i['code'] for i in resolved.items], ['K1', 'K1.1', 'S2'])
        # Profile item ids are unchanged from what the Skills Radar stored.
        self.assertEqual([i['id'] for i in resolved.items], ['KSBP-1-0', 'KSBP-1-1', 'custom-id'])
        self.assertEqual(resolved.standard_ref, 'st0596')

    def test_archived_profile_still_resolves_when_applied(self):
        profile = {'id': 'KSBP-1', 'name': 'Old', 'ksb_items': '[{"code": "K1", "type": "K", "description": "x"}]',
                   'is_active': False, 'standard_source_id': None}
        resolved = self.resolve('profile:KSBP-1', profile=profile)
        self.assertFalse(resolved.active)
        self.assertEqual([i['code'] for i in resolved.items], ['K1'])

    def test_missing_and_unknown_sources_resolve_to_nothing(self):
        self.assertEqual(self.resolve('').items, [])
        self.assertEqual(self.resolve('').kind, '')
        unknown_profile = self.resolve('KSBP-404', profile=None)
        self.assertEqual((unknown_profile.kind, unknown_profile.items), ('profile', []))
        unknown_standard = self.resolve('standard:st9999-v1-0', rows=[])
        self.assertEqual((unknown_standard.kind, unknown_standard.items), ('standard', []))

    def test_retired_profile_reader_never_queries_deleted_table(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = ('KSBP-1', 'Old', '[]', False, None)
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(ksb_sources, 'connections', {'default': connection}):
            row = ksb_sources.fetch_profile('KSBP-1')
        cursor.execute.assert_not_called()
        self.assertIsNone(row)



class SkillsRadarSourceTests(unittest.TestCase):
    """learner_api.curriculum: the list the Skills Radar shows and records."""

    def test_standard_programme_gets_the_standard(self):
        programme_row = [{'programme_id': 'PROG-ME-L4', 'ksb_profile_source_id': 'standard:st0596-v1-0'}]
        with patch.object(curriculum, '_rows', return_value=programme_row) as rows, \
             patch.object(ksb_sources, 'fetch_standard_rows', return_value=STANDARD_ROWS):
            standard, results = curriculum.ksb_profile_for_programme('Marketing Executive Level 4')
        self.assertEqual(standard['id'], 'standard:st0596-v1-0')
        self.assertEqual([r['codes'] for r in results], [['K1'], ['S2'], ['B8']])
        self.assertEqual([r['kind'] for r in results], ['Knowledge', 'Skill', 'Behaviour'])
        self.assertEqual(results[0]['id'], 'st0596-v1-0-K1')
        self.assertEqual(rows.call_count, 1)  # no profile lookup for a standard

    def test_retired_profile_cannot_supply_official_definitions(self):
        calls = []

        def fake_rows(sql, params=None):
            calls.append(sql)
            if 'FROM curriculum.programmes' in sql:
                return [{'programme_id': 'PROG-X', 'ksb_profile_source_id': 'KSBP-1'}]
            return [{'id': 'KSBP-1', 'name': 'Archived profile', 'ksb_items': MANUAL_ITEMS}]

        with patch.object(curriculum, '_rows', side_effect=fake_rows):
            standard, results = curriculum.ksb_profile_for_programme('Programme X')
        self.assertEqual((standard,results),(None,[]))
        self.assertEqual(len(calls),1)
        self.assertNotIn('curriculum.ksb_profiles',calls[0])

    def test_missing_pair_does_not_discover_retired_profiles(self):
        calls = []

        def fake_rows(sql, params=None):
            calls.append((sql, params))
            if 'FROM curriculum.programmes' in sql:
                return [{'programme_id': 'PROG-Y', 'ksb_profile_source_id': ''}]
            return []

        with patch.object(curriculum, '_rows', side_effect=fake_rows):
            self.assertEqual(curriculum.ksb_profile_for_programme('Programme Y'), (None, []))
        self.assertEqual(len(calls),1)
        self.assertIn('standard_ref',calls[0][0])
        self.assertNotIn('curriculum.ksb_profiles',calls[0][0])

    def test_explicit_source_for_history(self):
        with patch.object(curriculum, '_rows', return_value=[
                {'id': 'KSBP-1', 'name': 'Archived', 'ksb_items': MANUAL_ITEMS}]):
            standard, results = curriculum.ksb_profile_for_source('KSBP-1', 'Programme')
        self.assertEqual((standard,results),(None,[]))
        self.assertEqual(curriculum.ksb_profile_for_source('', 'Programme'), (None, []))


class CanonicalExclusionTests(unittest.TestCase):
    def test_inline_exclusion_cannot_be_released_by_a_missing_registry(self):
        sql=ksb_exclusions.not_excluded_sql('k')
        self.assertIn('k.is_excluded=false',sql)
        self.assertNotIn('learner_progress_ksb_exclusions',sql)

    def test_official_resolution_is_required(self):
        self.assertIn("mapping_status='verified'",ksb_exclusions.not_excluded_sql())

    def test_learner_pin_and_programme_reference_are_checked(self):
        sql=ksb_exclusions.not_excluded_sql()
        self.assertIn('coalesce(owner.standard_ref,programme.standard_ref)',sql)
        self.assertIn('owner.standard_ref=programme.standard_ref',sql)

    def test_null_and_fake_connections_do_not_disable_the_filter(self):
        for connection in (None,MagicMock(),SimpleNamespace(vendor='sqlite')):
            self.assertIn('k.is_excluded=false',ksb_exclusions.and_not_excluded('k',connection))

    def test_alias_preserves_progress_and_position_identity(self):
        sql=ksb_exclusions.not_excluded_sql('snapshot')
        self.assertIn('eligible_ksb.progress_id=snapshot.progress_id',sql)
        self.assertIn('eligible_ksb.position=snapshot.position',sql)

    def test_breakdown_reader_applies_eligibility_and_primary_owner_scope(self):
        connection=MagicMock()
        connection.alias='default'
        cursor=connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value=[]
        read_breakdown(connection,315)
        sql=cursor.execute.call_args.args[0]
        self.assertIn('k.is_excluded=false',sql)
        self.assertIn('WHERE p.learner_id=%s AND p.deleted_at IS NULL',sql)
        self.assertEqual(cursor.execute.call_args.args[1],[315])


if __name__ == '__main__':
    unittest.main()
