"""Canonical KSB display metadata regressions; no Django startup, DB or network."""
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from learner_api.test_canonical_learning_no_db import adapter


class KsbPointDisplayTests(unittest.TestCase):
    def setUp(self):
        self.query = Mock(return_value=[])
        self.scope = adapter(self.query)

    def test_metadata_preserves_canonical_counts_and_identity(self):
        records = [
            {'id': 1, 'ksbs': ['B1', 'B1'], 'accepted': True,
             'ksb_definitions': [{'ksb_code': 'B1', 'ksb_definition_id': 101, 'definition_code': 'B1.1'}]},
            {'id': 2, 'ksbs': ['B1'], 'accepted': False},
            {'id': 3, 'ksbs': ['K2.3'], 'accepted': True,
             'ksb_definitions': [{'ksb_code': 'K2.3', 'ksb_definition_id': 202, 'definition_code': 'K2.4'}]},
        ]
        with patch.dict(sys.modules, {'learner_api.journal_sources': SimpleNamespace(enabled=lambda: False)}):
            plain = self.scope['metrics_from_records'](records, {})
            detailed = self.scope['metrics_from_records'](records, {}, include_ksb_points=True)
        points = detailed['ksb'].pop('points')
        self.assertEqual(plain, detailed)
        self.assertEqual([(p['activityId'], p['code'], p['completed']) for p in points],
                         [('1', 'B1', True), ('2', 'B1', False), ('3', 'K2.3', True)])
        self.assertEqual(points[0]['ksbDefinitionId'], '101')
        self.assertEqual(points[0]['definitionCode'], 'B1.1')
        self.assertIsNone(points[1]['ksbDefinitionId'])
        self.assertIsNone(points[1]['definitionCode'])
        self.query.assert_not_called()

    def test_ambiguous_links_and_other_codes_cannot_supply_a_label(self):
        resolve = self.scope['ksb_point_definition']
        record = {'ksb_definitions': [
            {'ksb_code': 'B1', 'ksb_definition_id': 101, 'definition_code': 'B1.1'},
            {'ksb_code': 'B1', 'ksb_definition_id': 102, 'definition_code': 'B1.2'},
        ]}
        self.assertEqual(resolve(record, 'B1'), {'ksbDefinitionId': None, 'definitionCode': None})
        self.assertEqual(resolve(record, 'S4'), {'ksbDefinitionId': None, 'definitionCode': None})

    def test_bulk_resolves_only_verified_progress_ids_for_each_learner(self):
        owners = [dict(id=700+i, enrolment_id=10+i, aptem_id=4000+i, learner_type=kind,
                       email=f'learner-{i}@example.test', account_record_id=10+i,
                       account_email=f'learner-{i}@example.test', account_aptem_id=4000+i)
                  for i, kind in enumerate(['apprenticeship', 'commercial'])]
        def query(sql, params):
            if 'FROM "Learner".learners l' in sql:
                return owners
            if 'FROM "Learner".learner_progress_entries p' in sql:
                self.assertEqual(params, [[700, 701]])
                return [dict(owner_id=700+i, id=1+i, accepted=bool(i), actual_seconds=0)
                        for i in range(2)]
            if 'learner_progress_ksbs' in sql:
                self.assertEqual(params, [[1, 2]])
                self.assertIn("d.id::text=to_jsonb(k)->>'ksb_definition_id'", sql)
                return [dict(progress_id=1+i, ksb_code='B1', ksb_definition_id=101+i,
                             definition_code=f'B1.{i+1}') for i in range(2)]
            return []
        self.query.side_effect = query
        with patch.dict(sys.modules, {'learner_api.journal_sources': SimpleNamespace(enabled=lambda: False)}):
            result = self.scope['metrics_bulk']([10, 11], include_ksb_points=True)
        self.assertEqual(result[10]['ksb']['points'][0]['definitionCode'], 'B1.1')
        self.assertEqual(result[11]['ksb']['points'][0]['definitionCode'], 'B1.2')
        self.assertEqual(result[10]['ksb']['points'][0]['activityId'], '1')
        self.assertEqual(result[11]['ksb']['points'][0]['activityId'], '2')
