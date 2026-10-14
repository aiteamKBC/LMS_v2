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

    def test_fetch_profile_reads_archived_rows(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = ('KSBP-1', 'Old', '[]', False, None)
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(ksb_sources, 'connections', {'default': connection}):
            row = ksb_sources.fetch_profile('KSBP-1')
        sql = cursor.execute.call_args.args[0]
        self.assertNotIn('is_active = true', sql.lower())
        self.assertNotIn('where is_active', sql.lower())
        self.assertFalse(row['is_active'])


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

    def test_applied_profile_is_read_even_when_archived(self):
        calls = []

        def fake_rows(sql, params=None):
            calls.append(sql)
            if 'FROM curriculum.programmes' in sql:
                return [{'programme_id': 'PROG-X', 'ksb_profile_source_id': 'KSBP-1'}]
            return [{'id': 'KSBP-1', 'name': 'Archived profile', 'ksb_items': MANUAL_ITEMS}]

        with patch.object(curriculum, '_rows', side_effect=fake_rows):
            standard, results = curriculum.ksb_profile_for_programme('Programme X')
        self.assertEqual(standard['label'], 'Archived profile')
        self.assertEqual([r['codes'][0] for r in results], ['K1', 'K1.1', 'S2'])
        self.assertEqual(results[0]['id'], 'KSBP-1-0')
        profile_sql = calls[1]
        self.assertNotIn('COALESCE(is_active, true) AND', profile_sql)
        self.assertNotIn('WHERE COALESCE(is_active', profile_sql)

    def test_discovery_uses_programme_ids_and_active_profiles_only(self):
        calls = []

        def fake_rows(sql, params=None):
            calls.append((sql, params))
            if 'FROM curriculum.programmes' in sql:
                return [{'programme_id': 'PROG-Y', 'ksb_profile_source_id': ''}]
            return []

        with patch.object(curriculum, '_rows', side_effect=fake_rows):
            self.assertEqual(curriculum.ksb_profile_for_programme('Programme Y'), (None, []))
        discovery_sql, params = calls[-1]
        self.assertIn('programme_ids @>', discovery_sql)
        self.assertIn('COALESCE(is_active, true)', discovery_sql)
        self.assertNotIn('programme_name', discovery_sql)
        self.assertEqual(params, ['PROG-Y', 'Programme Y'])

    def test_explicit_source_for_history(self):
        with patch.object(curriculum, '_rows', return_value=[
                {'id': 'KSBP-1', 'name': 'Archived', 'ksb_items': MANUAL_ITEMS}]):
            standard, results = curriculum.ksb_profile_for_source('KSBP-1', 'Programme')
        self.assertEqual(standard['id'], 'KSBP-1')
        self.assertEqual(len(results), 3)
        self.assertEqual(curriculum.ksb_profile_for_source('', 'Programme'), (None, []))


class ExclusionRegistryTests(unittest.TestCase):
    def setUp(self):
        ksb_exclusions._exists_cache.clear()

    def test_predicate_skips_registered_rows_unless_released(self):
        with patch.object(ksb_exclusions, 'exclusions_table_exists', return_value=True):
            sql = ksb_exclusions.not_excluded_sql('k', 'default')
        self.assertIn('not exists', sql)
        self.assertIn('"Learner".learner_progress_ksb_exclusions', sql)
        self.assertIn('ksb_x.progress_id = k.progress_id', sql)
        self.assertIn('ksb_x.position = k.position', sql)
        self.assertIn('ksb_x.ksb_code = upper(btrim(k.ksb_code))', sql)
        self.assertIn("ksb_x.status <> 'released'", sql)

    def test_no_registry_means_no_filter(self):
        with patch.object(ksb_exclusions, 'exclusions_table_exists', return_value=False):
            self.assertEqual(ksb_exclusions.not_excluded_sql('k', 'default'), '1 = 1')
            self.assertEqual(ksb_exclusions.and_not_excluded('k', SimpleNamespace(alias='default')), '')

    def test_fake_connections_never_get_a_filter(self):
        self.assertEqual(ksb_exclusions.and_not_excluded('k', MagicMock()), '')
        self.assertEqual(ksb_exclusions.and_not_excluded('k', None), '')

    def test_non_postgres_database_reports_no_registry(self):
        connection = MagicMock(vendor='sqlite')
        with patch.object(ksb_exclusions, 'connections', {'default': connection}):
            self.assertFalse(ksb_exclusions.exclusions_table_exists('default'))
        connection.cursor.assert_not_called()

    def test_existing_registry_is_cached(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (True,)
        connection = MagicMock(vendor='postgresql')
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(ksb_exclusions, 'connections', {'default': connection}):
            self.assertTrue(ksb_exclusions.exclusions_table_exists('default'))
            self.assertTrue(ksb_exclusions.exclusions_table_exists('default'))
        self.assertEqual(cursor.execute.call_count, 1)

    def test_breakdown_reader_applies_the_registry_in_its_join(self):
        connection = MagicMock()
        connection.alias = 'default'
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []
        with patch.object(ksb_exclusions, 'exclusions_table_exists', return_value=True):
            read_breakdown(connection, 315)
        sql = cursor.execute.call_args.args[0]
        join = sql.split('JOIN "Learner".learner_progress_ksbs k ON')[1].split('WHERE')[0]
        self.assertIn('learner_progress_ksb_exclusions', join)
        self.assertEqual(sql.split('WHERE')[1].split('ORDER BY')[0].strip().splitlines()[0].strip(),
                         'p.learner_id=%s AND p.deleted_at IS NULL')


if __name__ == '__main__':
    unittest.main()
