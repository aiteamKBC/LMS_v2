import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from curriculum_api import learner_ksb_sync as sync


class FakeCursor:
    description = [
        ('id',), ('learner_id',), ('reporting_month',), ('component_id',),
        ('position',), ('ksb_code',), ('standard_ksb_id',), ('ksb_description',), ('source_type',),
        ('source_id',), ('classification',), ('weight',), ('weight_class',),
    ]

    def __init__(self):
        self.executed = []
        self.executed_many = []
        self.progress_rows = [
            (101, 11, '2026-07', 'COMP-1', 0, 'K1', 901, 'Old text', 'standard', 'STD-1', 'knowledge', 1, 'hard'),
            (102, 12, '2025-04', 'COMP-1', 0, 'K1', 902, 'Old text', 'standard', 'STD-1', 'knowledge', 1, 'hard'),
        ]
        self.definition_rows = [(11, 'K2', 201), (12, 'K2', 202)]
        self.rows = self.progress_rows

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        self.executed.append((sql, params or []))
        if "coalesce(m.source_preference" in sql:
            self.rows = [(row[0], None, row[2], None, 'material') for row in self.progress_rows]
        elif 'FOR UPDATE' in sql:
            self.rows = [(row[0],) for row in self.progress_rows]
        else:
            self.rows = self.definition_rows if 'JOIN curriculum.ksb_standard_versions' in sql else self.progress_rows

    def executemany(self, sql, params):
        self.executed_many.append((sql, list(params)))

    def fetchall(self):
        return self.rows


class LearnerKsbSyncTests(SimpleTestCase):
    def test_updates_current_and_completed_progress_and_records_each_revision(self):
        cursor = FakeCursor()
        fake_connection = SimpleNamespace(vendor='postgresql', cursor=lambda: cursor)
        mappings = {'COMP-1': [{
            'code': 'K2', 'description': 'New text', 'sourceType': 'standard',
            'sourceId': 'STD-1', 'classification': 'knowledge', 'weight': 2, 'weightClass': 'hard',
        }]}

        with patch.object(sync, 'connection', fake_connection):
            result = sync.sync_progress_ksbs(mappings, actor='admin@example.test')

        self.assertEqual(result['progress_rows'], 2)
        select_sql = cursor.executed[0][0]
        self.assertIn('p.deleted_at IS NULL', select_sql)
        self.assertNotIn('p.accepted', select_sql)
        self.assertNotIn('completed', select_sql.lower())
        revisions = [(sql, params) for sql, params in cursor.executed if 'learner_activity_revisions' in sql]
        self.assertEqual(len(revisions), 2)
        self.assertEqual({params[1] for _, params in revisions}, {101, 102})
        self.assertEqual(len({params[3] for _, params in revisions}), 2)
        self.assertEqual(json.loads(revisions[0][1][4])['ksbs'][0]['ksb_code'], 'K1')
        self.assertEqual(json.loads(revisions[0][1][5])['ksbs'][0]['ksb_code'], 'K2')
        self.assertEqual(json.loads(revisions[0][1][4])['ksbs'][0]['standard_ksb_id'], 901)
        self.assertEqual(json.loads(revisions[0][1][5])['ksbs'][0]['standard_ksb_id'], 201)
        self.assertEqual(len(cursor.executed_many), 2)
        self.assertEqual(cursor.executed_many[0][1][0][3], 201)
        self.assertNotIn(
            'learner_progress_ksb_exclusions',
            '\n'.join(sql for sql, _params in cursor.executed),
        )

    def test_rebuilding_unchanged_rows_preserves_definition_ids_and_is_idempotent(self):
        cursor = FakeCursor()
        mappings = {'COMP-1': [{
            'code': 'K1', 'description': 'Old text', 'sourceType': 'standard',
            'sourceId': 'STD-1', 'classification': 'knowledge', 'weight': 1,
            'weightClass': 'hard',
        }]}

        with patch.object(sync, 'connection', SimpleNamespace(vendor='postgresql', cursor=lambda: cursor)):
            result = sync.sync_progress_ksbs(mappings)

        self.assertEqual(result['progress_rows'], 0)
        self.assertEqual(cursor.executed_many, [])
        writes = '\n'.join(sql for sql, _params in cursor.executed)
        self.assertNotIn('DELETE FROM "Learner".ksb_learner_progress', writes)
        self.assertNotIn('learner_progress_ksb_exclusions', writes)

    def test_normalisation_is_deterministic_and_deduplicates_mapping_identity(self):
        rows = sync.normalise_mappings([
            {'ksbCode': ' k1 ', 'sourceType': 'standard', 'sourceId': 'S', 'weight': '1.50'},
            {'code': 'K1', 'source_type': 'standard', 'source_id': 'S', 'weight': 9},
            {'code': 'S2'},
        ])
        self.assertEqual([row['position'] for row in rows], [0, 1])
        self.assertEqual([row['ksb_code'] for row in rows], ['K1', 'S2'])
        self.assertEqual(str(rows[0]['weight']), '1.50')

    def test_explicit_definition_identity_survives_normalisation(self):
        rows = sync.normalise_mappings([{'code': 'K1', 'ksbDefinitionId': 44}])
        self.assertEqual(rows[0]['standard_ksb_id'], 44)
