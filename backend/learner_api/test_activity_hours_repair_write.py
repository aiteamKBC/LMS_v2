"""Exercise repair writes and rollback against an isolated in-memory ledger.

SQLite accepts the guarded UPDATE used here; no production schema or network
connection is opened. PostgreSQL locking remains a separate runtime safeguard.
"""
from copy import deepcopy
import json
import sqlite3
import unittest

from psycopg.types.json import Jsonb

from learner_api.activity_hours_repair import build_plan
from scripts.repair_missing_activity_hours import apply_plan


class MemoryLedger:
    def __init__(self, rows):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.create_function('now', 0, lambda: '2026-10-31T12:00:00Z')
        self.db.execute("ATTACH DATABASE ':memory:' AS Learner")
        self.db.execute('''CREATE TABLE Learner.learner_progress_entries (
            id INTEGER PRIMARY KEY, learner_id INTEGER, accepted BOOLEAN, deleted_at TEXT,
            actual_seconds INTEGER, actual_basis TEXT, reporting_month TEXT,
            source_payload TEXT, ssot_updated_at TEXT, claimed_seconds INTEGER, title TEXT)''')
        for row in rows:
            self.db.execute('''INSERT INTO Learner.learner_progress_entries VALUES (
                :id,:learner_id,:accepted,NULL,:actual_seconds,:actual_basis,:reporting_month,
                :source_payload,:ssot_updated_at,:claimed_seconds,:title)''',
                {**row, 'source_payload': json.dumps(row['source_payload'])})
        self.db.commit()

    def execute(self, statement, params):
        sql = statement if isinstance(statement, str) else statement.as_string()
        return self.db.execute(sql.replace('%s', '?'),
                               [json.dumps(value.obj) if isinstance(value, Jsonb) else value for value in params])

    def row(self, ident):
        return dict(self.db.execute('SELECT * FROM Learner.learner_progress_entries WHERE id=?', [ident]).fetchone())


class ActivityHoursRepairWriteTests(unittest.TestCase):
    def setUp(self):
        self.rows = [{'id': ident, 'learner_id': 100 + ident, 'identity_valid': True, 'accepted': True,
                      'kind': 'component', 'component_ref': 'assignment:1', 'component_type': 'assignment',
                      'source_system': 'new_lms', 'actual_seconds': None, 'actual_basis': '',
                      'reporting_month': '2026-09', 'ssot_updated_at': '2026-09-21T12:00:00Z',
                      'source_payload': {'original_evidence': 'keep'}, 'claimed_seconds': 999,
                      'title': 'Synthetic assignment',
                      'marking': {'id': 10 + ident, 'status': 'accepted', 'actual_time_hours': '0.5'}}
                     for ident in (1, 2)]
        self.ledger = MemoryLedger(self.rows)
        self.addCleanup(self.ledger.db.close)
        self.plan = build_plan(self.rows)

    def test_applied_hours_preserve_unrelated_fields_and_append_reversible_evidence(self):
        original = deepcopy(self.rows)
        with self.ledger.db:
            self.assertEqual(apply_plan(self.ledger, self.plan, self.rows), 2)
        for row in self.rows:
            saved = self.ledger.row(row['id'])
            self.assertEqual(saved['actual_seconds'], 1800)
            self.assertEqual(saved['accepted'], 1)
            self.assertEqual(saved['claimed_seconds'], 999)
            self.assertEqual(saved['title'], row['title'])
            metadata = json.loads(saved['source_payload'])
            self.assertEqual(metadata['original_evidence'], 'keep')
            repair = metadata['activity_hours_repairs'][0]
            self.assertIsNone(repair['before']['actual_seconds'])
            self.assertEqual(repair['after']['actual_seconds'], 1800)
            self.assertEqual(repair['plan'], self.plan['fingerprint'])
            self.assertEqual(repair['marking_id'], row['marking']['id'])
        self.assertEqual(self.rows, original)

    def test_concurrent_change_rolls_back_other_rows_and_preserves_the_new_value(self):
        self.ledger.db.execute('UPDATE Learner.learner_progress_entries SET actual_seconds=7200 WHERE id=2')
        self.ledger.db.commit()
        with self.assertRaisesRegex(ValueError, 'candidate changed'):
            with self.ledger.db:
                apply_plan(self.ledger, self.plan, self.rows)
        self.assertIsNone(self.ledger.row(1)['actual_seconds'])
        self.assertEqual(self.ledger.row(2)['actual_seconds'], 7200)
        self.assertNotIn('activity_hours_repairs', json.loads(self.ledger.row(1)['source_payload']))

    def test_replaying_a_stale_plan_neither_changes_hours_nor_duplicates_history(self):
        with self.ledger.db:
            apply_plan(self.ledger, self.plan, self.rows)
        with self.assertRaisesRegex(ValueError, 'candidate changed'):
            with self.ledger.db:
                apply_plan(self.ledger, self.plan, self.rows)
        self.assertEqual(self.ledger.row(1)['actual_seconds'], 1800)
        self.assertEqual(len(json.loads(self.ledger.row(1)['source_payload'])['activity_hours_repairs']), 1)

    def test_nonlist_repair_history_is_flagged_before_any_write(self):
        for row in self.rows:
            row['source_payload']['activity_hours_repairs'] = 'original historical value'
        plan = build_plan(self.rows)
        self.assertEqual(plan['changes'], [])
        self.assertEqual(plan['skipped'], {'source_metadata_requires_review': 2})


if __name__ == '__main__':
    unittest.main()
