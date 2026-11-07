"""Append after signing without replacing the original record or capture."""
from copy import deepcopy
import json
import sqlite3

from django.test import SimpleTestCase
from old_otjh.service import ServiceError
from . import manual_time_corrections as guards, monthly_logs
from .retake_timing import native_choices
from unittest.mock import patch


class SignedActivityTimeMonthsTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript('''
            ATTACH DATABASE ':memory:' AS Learner;
            CREATE TABLE Learner.learner_monthly_locks(learner_id,report_month,locked_at,unlocked_at);
            CREATE TABLE Learner.learner_monthly_signatures(
                learner_id,report_month,review_confirmed,signer_role,signer_name,
                signature_data,signed_at,snapshot_digest,reviewed_rows);
            CREATE TABLE Learner.monthly_audit_signoffs(learner_id,report_month,review_confirmed);
            CREATE TABLE Learner.manual_month_finalization_events(id,aptem_id,report_month,event_type);
            CREATE TABLE Learner.learner_progress_entries(id,learner_id,claimed_seconds,source_payload);
            INSERT INTO Learner.learner_progress_entries VALUES(1,70,7200,'{"original":"keep"}');
        ''')
        self.owner = {'id': 70, 'enrolment_id': 7, 'aptem_id': 42}
        self.statements = []
        self.enterContext(patch.object(guards.repository, 'query', side_effect=self.query))

    def query(self, sql, params=()):
        self.statements.append(sql)
        cursor = self.db.execute(sql.replace('%s', '?'), params)
        return [dict(row) for row in cursor.fetchall()] if cursor.description else []

    def sign(self, role='learner', *, owner=70, confirmed=True):
        self.db.execute('INSERT INTO Learner.learner_monthly_signatures VALUES(?,?,?,?,?,?,?,?,?)',
            [owner, '2026-10', confirmed, role, f'Synthetic {role}', f'{role}-signature',
             '2026-10-20T10:00:00Z', 'original-signed-digest', '[{"hours":2}]'])

    def snapshots(self):
        return [tuple(row) for row in self.db.execute('SELECT * FROM Learner.learner_monthly_signatures')]

    def lock(self):
        self.db.execute("INSERT INTO Learner.learner_monthly_locks VALUES(70,'2026-10','locked',NULL)")

    def test_one_signature_allows_new_attempts_but_not_a_correction(self):
        self.sign()
        before = self.snapshots()
        for mode in ('add', 'retry'):
            guards.require_activity_time_month(self.owner, '2026-10', mode)
        with self.assertRaisesRegex(ServiceError, 'signed'):
            guards.require_activity_time_month(self.owner, '2026-10', 'correct')
        self.assertEqual(self.snapshots(), before)
        self.assertTrue(all(sql.lstrip().upper().startswith('SELECT') for sql in self.statements))

    def test_both_signatures_allow_append_through_the_automatic_lock_without_unlocking(self):
        self.sign(); self.sign('coach'); self.lock()
        before, changes = self.snapshots(), self.db.total_changes
        for mode in ('add', 'retry'):
            guards.require_activity_time_month(self.owner, '2026-10', mode)
        with self.assertRaisesRegex(ServiceError, 'locked'):
            guards.require_activity_time_month(self.owner, '2026-10', 'correct')
        self.assertEqual(self.snapshots(), before)
        self.assertEqual(self.db.total_changes, changes)
        self.assertEqual(self.db.execute('SELECT locked_at FROM Learner.learner_monthly_locks').fetchone()[0], 'locked')

    def test_other_learners_or_unconfirmed_signatures_cannot_bypass_a_lock(self):
        self.sign(); self.sign('coach', owner=71); self.sign('coach', confirmed=False); self.lock()
        for mode in ('add', 'retry'):
            with self.assertRaisesRegex(ServiceError, 'locked'):
                guards.require_activity_time_month(self.owner, '2026-10', mode)

    def test_separate_administrative_finalization_stays_protected(self):
        self.sign(); self.sign('coach'); self.lock()
        self.db.execute("INSERT INTO Learner.manual_month_finalization_events VALUES(1,42,'2026-10','finalized')")
        for mode in ('add', 'retry'):
            with self.assertRaisesRegex(ServiceError, 'finalized'):
                guards.require_activity_time_month(self.owner, '2026-10', mode)

    def test_an_audit_signature_is_preserved_while_the_new_native_attempt_is_allowed(self):
        self.db.execute("INSERT INTO Learner.monthly_audit_signoffs VALUES('42','2026-10',true)")
        changes = self.db.total_changes
        for mode in ('add', 'retry'):
            guards.require_activity_time_month(self.owner, '2026-10', mode)
        with self.assertRaisesRegex(ServiceError, 'audit signature'):
            guards.require_activity_time_month(self.owner, '2026-10', 'correct')
        self.assertEqual(self.db.total_changes, changes)

    def test_signed_month_reports_sum_or_max_without_changing_the_reviewed_capture(self):
        self.sign(); self.sign('coach'); self.lock()
        snapshot = self.snapshots()
        original = tuple(self.db.execute('SELECT * FROM Learner.learner_progress_entries WHERE id=1').fetchone())
        for mode, seconds, expected in [('add', 3600, 10800), ('retry', 3600, 7200), ('retry', 10800, 10800)]:
            with self.subTest(mode=mode, seconds=seconds):
                guards.require_activity_time_month(self.owner, '2026-10', mode)
                self.db.execute('DELETE FROM Learner.learner_progress_entries WHERE id=2')
                self.db.execute('INSERT INTO Learner.learner_progress_entries VALUES(2,70,?,?)',
                                [seconds, json.dumps({'retakeTimeChoice': mode})])
                records = [dict(row, component_ref='C1', component_type='reading', accepted=True,
                                actual_seconds=row['claimed_seconds'], submitted_at=f'2026-10-{row["id"]:02d}T10:00:00Z')
                           for row in self.db.execute('SELECT * FROM Learner.learner_progress_entries ORDER BY id')]
                before = deepcopy(records)
                projected = native_choices(records, records)
                self.assertEqual(sum(row['actual_seconds'] for row in projected), expected)
                report_rows = [{'source_ref': 'progress:2', 'actual_hours': expected / 3600,
                                'planned_hours': 0, 'accepted': True}]
                signs = [{'report_month': '2026-10', 'signer_role': row[3], 'signer_name': row[4],
                          'url': row[5], 'signed_at': row[6], 'snapshot_hash': row[7]} for row in snapshot]
                state = monthly_logs.month_state('2026-10', report_rows, signs,
                    lock={'locked': True, 'locked_at': 'locked', 'unlocked_at': None, 'unlocked_by': None})
                self.assertEqual(state['actual_hours'], expected / 3600)
                self.assertEqual(state['status'], 'complete')
                self.assertEqual(state['student_signature']['url'], 'learner-signature')
                self.assertEqual(state['coach_signature']['url'], 'coach-signature')
                self.assertTrue(state['locked'])
                self.assertEqual(self.snapshots(), snapshot)
                self.assertEqual(tuple(self.db.execute('SELECT * FROM Learner.learner_progress_entries WHERE id=1').fetchone()), original)
                self.assertEqual(records, before)
