"""Journal KSB source precedence, with repository I/O mocked and no database setup."""
from copy import deepcopy
from unittest.mock import patch

from django.test import SimpleTestCase

from . import repository as repo


class JournalKsbTests(SimpleTestCase):
    def row(self, **overrides):
        return {
            'id': 180988, 'category': 'reading+quiz', 'source_ref': 'la:101477:126339',
            'activity_id': 126339, 'group_id': 101477, 'component_ksbs': None,
            'journal_ksbs': None, 'learner_ksbs': None, 'material_ksbs': None,
            'ksb_source_preference': None, **overrides,
        }

    def read(self, rows, evidence=None):
        def query(sql, params):
            if 'SELECT r.id, r.month' in sql:
                self.assertEqual(params, [4609, '2026-05'])
                # Both per-learner sources must use the ledger row's owner.
                self.assertIn('jk.row_id=r.id AND jk.aptem_id=r.aptem_id', sql)
                self.assertIn('lk.activity_id=r.activity_id AND lk.aptem_id=r.aptem_id', sql)
                self.assertIn('mk.activity_id=r.activity_id', sql)
                self.assertIn('r.deleted_at IS NULL', sql)
                return deepcopy(rows)
            if 'FROM fetching_evidence.evidence_items' in sql:
                self.assertEqual(params, [4609, [41641]])
                return evidence or []
            return []

        with patch.object(repo, 'query', side_effect=query), patch.object(repo, 'source_documents', return_value=[]):
            result = repo.month_rows({'aptem_id': 4609}, '2026-05')
        for row in result:
            for field in ('journal_ksbs', 'learner_ksbs', 'material_ksbs', 'ksb_source_preference', 'component_ksbs'):
                self.assertNotIn(field, row)
        return result

    def test_assignment_and_lms_use_the_monthly_journal_mappings(self):
        rows = self.read([
            self.row(id=167195, category='assignment', source_ref='asg:77098:evidence:41641',
                     activity_id=None, journal_ksbs=[{'code': code} for code in ('B2', 'K5', 'S2')]),
            self.row(ksb_source_preference='learner',
                     learner_ksbs='[{"code":"B5"},{"code":"B8"},{"code":"K1"},{"code":"K5"},{"code":"S6"}]',
                     material_ksbs=[{'code': 'K99'}]),
        ])
        self.assertEqual(rows[0]['ksb_codes'], ['B2', 'K5', 'S2'])
        self.assertEqual(rows[1]['ksb_codes'], ['B5', 'B8', 'K1', 'K5', 'S6'])

    def test_row_mapping_overrides_learner_and_material_mappings(self):
        row = self.read([self.row(journal_ksbs=[{'code': 'B2'}], learner_ksbs=['K1'],
                                  material_ksbs=['K2'], ksb_source_preference='learner')])[0]
        self.assertEqual(row['ksb_codes'], ['B2'])

    def test_material_preference_uses_the_shared_mapping(self):
        row = self.read([self.row(learner_ksbs=['K1'], material_ksbs=['S2'],
                                  ksb_source_preference='material')])[0]
        self.assertEqual(row['ksb_codes'], ['S2'])

    def test_activity_without_learner_settings_uses_the_shared_mapping(self):
        row = self.read([self.row(material_ksbs=[{'code': 'K5'}, {'code': 'K5'}])])[0]
        self.assertEqual(row['ksb_codes'], ['K5'])

    def test_explicitly_cleared_mappings_do_not_restore_other_codes(self):
        for mapping in (
            {'journal_ksbs': [], 'material_ksbs': ['K1']},
            {'journal_ksbs': '[]', 'material_ksbs': ['K1']},
            {'learner_ksbs': [], 'ksb_source_preference': 'learner', 'material_ksbs': ['K1']},
            {'learner_ksbs': ['K1'], 'ksb_source_preference': 'material', 'material_ksbs': []},
        ):
            with self.subTest(mapping=mapping):
                row = self.read([self.row(component_ksbs=['S6'], **mapping)])[0]
                self.assertEqual(row['ksb_codes'], [])

    def test_legacy_component_mapping_remains_available_without_journal_mappings(self):
        row = self.read([self.row(component_ksbs={'K': [{'code': 'K1'}]})])[0]
        self.assertEqual(row['ksb_codes'], ['K1'])

    def test_saved_journal_mapping_wins_over_detected_evidence_codes(self):
        evidence = [{'evidence_id': 41641, 'component_name': 'Component', 'ksb_codes': ['K99']}]
        row = self.read([self.row(source_ref='ev:41641', journal_ksbs=['B2'])], evidence)[0]
        self.assertEqual(row['ksb_codes'], ['B2'])
        self.assertEqual(row['component_name'], 'Component')

    def test_legacy_evidence_codes_remain_available_without_journal_mappings(self):
        evidence = [{'evidence_id': 41641, 'component_name': 'Component', 'ksb_codes': ['S2']}]
        row = self.read([self.row(source_ref='ev:41641', component_ksbs=['K1'])], evidence)[0]
        self.assertEqual(row['ksb_codes'], ['S2'])
