"""Module formula regression cases; private SQLite only, no external effects."""
import copy
import sqlite3
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from . import module_progress_metrics as metrics


class ModuleProgressMetricsTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript('''
            CREATE TABLE learner_progress_ksbs (progress_id integer,position integer,ksb_code text,weight numeric);
            CREATE TABLE learning_reflection_submissions (id integer,learner_id text,learner_kind text,
                component_ref text,status text,actual_time_hours numeric,submitted_at text,activity_type text);
        ''')
        self.connection = SimpleNamespace(vendor='sqlite')
        self.payload = {
            'identifier': 'M1', 'assignedLearners': [{'id': 1}, {'id': 2}],
            'learnerActivityPlan': [{'learnerId': learner, 'componentId': component}
                                    for learner in (1, 2) for component in ('C1', 'C2')],
            'coverage': {'items': [
                {'code': 'K1', 'mappings': [{'component_id': 'C1', 'weight': 50}, {'weight': 10}]},
                {'code': 'S1', 'mappings': [{'component_id': 'C2', 'weight': 50}]},
            ]},
        }

    def read(self, sql, params=()):
        return [dict(row) for row in self.db.execute(sql.replace('%s', '?'), params).fetchall()]

    def record(self, ident=1, **values):
        return {'id': ident, 'learner_id': 1, 'kind': 'component', 'component_ref': 'C1',
                'module_ref': 'M1', 'accepted': True, 'passed': None, 'actual_seconds': 600, **values}

    def calculate(self, records):
        metrics.apply_ksb_metrics(self.payload, records, self.read, lambda name: name, self.connection)
        return self.payload['learnerKsbConsumption']

    def test_current_weights_retry_deduplication_caps_and_history_are_separate(self):
        self.db.executemany('INSERT INTO learner_progress_ksbs VALUES (?,?,?,?)', [
            (1, 1, 'K1', 80), (2, 1, 'K1', 80), (3, 1, 'K1', 30), (4, 1, 'K1', 900),
        ])
        rows = self.calculate([self.record(), self.record(2), self.record(3, component_ref='OLD'),
                               self.record(4, component_ref='OTHER', module_ref='M2')])
        self.assertEqual(rows[0]['consumedWeightTotal'], 80)
        self.assertEqual(rows[0]['cappedConsumedWeightTotal'], 50)
        self.assertEqual(rows[0]['expectedWeightTotal'], 100)
        self.assertEqual(rows[0]['progressPercentage'], 50)
        self.assertEqual(rows[0]['historicalConsumedWeightTotal'], 30)
        self.assertEqual(rows[0]['unallocatedPlannedWeight'], 10)
        self.assertEqual(rows[1]['consumedWeightTotal'], 0)
        summary = self.payload['ksbAchievement']
        self.assertEqual(summary['expectedWeightTotal'], 200)
        self.assertEqual(summary['cappedAchievedWeightTotal'], 50)
        self.assertEqual(summary['progressPercentage'], 25)
        self.assertEqual(summary['historicalAchievedWeightTotal'], 30)

    def test_corrected_component_reference_and_registry_exclusions_are_honoured(self):
        self.db.executemany('INSERT INTO learner_progress_ksbs VALUES (?,?,?,?)', [(1, 1, 'K1', 20), (1, 2, 'K1', 80)])
        with patch.object(metrics, 'and_not_excluded', return_value=' AND k.position<>2'):
            rows = self.calculate([self.record(component_ref='OLD', curriculum_component_ref='C1')])
        self.assertEqual(rows[0]['consumedWeightTotal'], 20)
        self.assertEqual(rows[0]['historicalConsumedWeightTotal'], 0)

    def test_failed_unaccepted_deleted_feed_and_staff_time_cannot_create_ksb_achievement(self):
        self.db.executemany('INSERT INTO learner_progress_ksbs VALUES (?,?,?,?)', [(ident, 1, 'K1', 50) for ident in range(1, 7)])
        records = [self.record(1, accepted=False, activity_status='Submitted'),
                   self.record(2, accepted=False, passed=False, kind='quiz', activity_status='Completed'),
                   self.record(3, deleted_at='2026-10-01'), self.record(4, kind='activity_event'),
                   self.record(5, kind='staff_hours'),
                   self.record(6, accepted=False, activity_status='Completed')]
        canonical = metrics.completion_records(records, {}, self.read, lambda name: name)
        rows = self.calculate(canonical)
        self.assertEqual(rows[0]['consumedWeightTotal'], 0)
        self.assertEqual(rows[0]['progressPercentage'], 0)

    def test_native_assignment_marks_are_scoped_by_enrolment_and_learner_type_without_fabricating_time(self):
        self.db.executemany('INSERT INTO learning_reflection_submissions VALUES (?,?,?,?,?,?,?,?)', [
            (1, '91', 'apprenticeship', 'C1', 'accepted', 2, '2026-10-01', 'assignment'),
            (2, '91', 'commercial', 'C1', 'submitted', 9, '2026-10-02', 'assignment'),
        ])
        original = [self.record(actual_seconds=None, component_link_source='direct', component_type='assignment',
                                submitted_at=datetime(2026, 10, 1, tzinfo=timezone.utc), verified_seconds=600)]
        before = copy.deepcopy(original)
        owner = {'1': {'enrolment_id': 91, 'learner_type': 'apprenticeship'}}
        rows = metrics.completion_records(original, owner, self.read, lambda name: name)
        self.assertTrue(rows[0]['completed'])
        self.assertTrue(rows[0]['accepted'])
        self.assertIsNone(rows[0]['actual_seconds'])
        self.assertEqual(original, before)
        self.assertEqual(self.db.execute('SELECT count(*) FROM learning_reflection_submissions').fetchone()[0], 2)

    def test_canonical_duplicate_is_not_credited_again_as_history_or_for_another_learner(self):
        self.db.executemany('INSERT INTO learner_progress_ksbs VALUES (?,?,?,?)', [(1, 1, 'K1', 20), (2, 1, 'K1', 20), (3, 1, 'K1', 20)])
        rows = self.calculate([self.record(canonical_activity_key='same'),
                               self.record(2, component_ref='OLD', canonical_activity_key='same'),
                               self.record(3, learner_id=2, canonical_activity_key='same')])
        self.assertEqual(rows[0]['consumedWeightTotal'], 20)
        self.assertEqual(rows[0]['historicalConsumedWeightTotal'], 0)
        self.assertEqual(rows[1]['consumedWeightTotal'], 20)

    def test_missing_targets_stay_unmeasurable_and_orphan_mappings_do_not_inflate_targets(self):
        self.payload['coverage']['items'].append({'code': 'K9', 'mappings': [{'component_id': 'REMOVED', 'weight': 500}]})
        self.db.execute('INSERT INTO learner_progress_ksbs VALUES (1,1,\'UNMAPPED\',500)')
        rows = self.calculate([self.record()])
        self.assertEqual(rows[0]['expectedWeightTotal'], 100)
        self.assertEqual(rows[0]['cappedConsumedWeightTotal'], 0)
        self.assertEqual(rows[0]['unallocatedPlannedWeight'], 510)

    def test_postgres_snapshot_read_binds_one_array_instead_of_one_parameter_per_attempt(self):
        from unittest.mock import Mock
        read = Mock(return_value=[])
        records = [self.record(ident) for ident in range(1, 1001)]
        metrics.apply_ksb_metrics(self.payload, records, read, lambda name: name, SimpleNamespace(vendor='postgresql'))
        sql, params = read.call_args.args
        self.assertIn('k.progress_id = ANY(%s)', sql)
        self.assertEqual(len(params), 1)
        self.assertEqual(len(params[0]), 1000)
