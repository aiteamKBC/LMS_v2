"""Exercise compact coach reads against an isolated in-memory ledger."""
import json
import sqlite3
from unittest.mock import patch

from django.test import SimpleTestCase
from coach_api.otjh_ksb import read_hour_totals
from learner_api import canonical_learning as canonical
from learner_api.canonical_hours import pending_hour_records
from learner_api.current_learning import project_current


class CanonicalHoursTests(SimpleTestCase):
    owner = {'id': 101, 'enrolment_id': 201, 'learner_type': 'commercial'}

    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.execute("ATTACH DATABASE ':memory:' AS Learner")
        self.db.create_function('GREATEST', 2, max)
        self.db.execute('''CREATE TABLE Learner.learner_progress_entries(
            id,learner_id,kind,component_ref,component_type,quiz_ref,passed,reported_time,
            submitted_at,time_tracking_source,claimed_seconds,verified_seconds,
            component_link_source,source_system,actual_seconds,accepted,reporting_month,
            actual_basis,source_payload,deleted_at)''')
        self.db.execute('CREATE TABLE Learner.learner_activity_reporting_segments(progress_id,learner_id)')
        self.db.execute('''CREATE TABLE Learner.learning_reflection_submissions(
            id,learner_id,learner_kind,component_ref,status,actual_time_hours,activity_type,submitted_at)''')
        self.reads = []

    def read(self, sql, params):
        self.reads.append((sql, params))
        # Translate PostgreSQL syntax only; retain the reader's actual predicates.
        sql = sql.replace('actual_seconds::text', 'CAST(actual_seconds AS TEXT)')
        sql = sql.replace('jsonb_build_object', 'json_object')
        if '=ANY(%s)' in sql:
            sql = sql.replace('=ANY(%s)', ' IN (' + ','.join('?' for _ in params[0]) + ')')
            params = params[0]
        else:
            sql = sql.replace('%s', '?')
        rows = [dict(row) for row in self.db.execute(sql, params).fetchall()]
        for row in rows:
            for field in ('accepted', 'passed'):
                if row.get(field) is not None:
                    row[field] = bool(row[field])
        return rows

    def entry(self, key, **values):
        entry = dict(id=key, learner_id=101, kind='component', component_ref=f'C{key}',
                     component_type='reading', component_link_source='direct', source_system='',
                     submitted_at='2026-10-12T13:00:00+00:00', reporting_month='2026-10',
                     actual_seconds=None, accepted=True, passed=None, verified_seconds=0,
                     source_payload={})
        entry.update(values)
        saved = {key: json.dumps(value) if key == 'source_payload' else value for key, value in entry.items()}
        columns = ','.join(saved)
        self.db.execute(f'INSERT INTO Learner.learner_progress_entries ({columns}) VALUES ({",".join("?" for _ in saved)})', list(saved.values()))
        return entry

    def test_missing_125_minutes_match_learner_and_monthly_logs_without_writes(self):
        stored = self.entry(1, actual_seconds=697564, source_system='historical')
        current = self.entry(2, component_type='live_session', claimed_seconds=7500,
                             verified_seconds=7500, reported_time='125.0 minutes',
                             time_tracking_source='signed_session_capped_visible_page:input')
        learner_records = canonical.progress_records_with_completion([stored, current], project_current([stored, current], {}))
        expected = canonical.metrics_from_records(learner_records, {})['otjh']['actual']
        before = self.db.total_changes
        with patch.object(canonical, 'query', side_effect=self.read):
            months = read_hour_totals(self.owner)
        self.assertEqual(round(sum(row['completed'] for row in months), 4), expected)
        self.assertEqual(expected, 195.8511)
        self.assertEqual(months[0]['submitted'], 0)
        self.assertEqual(self.db.total_changes, before)
        self.assertIsNone(self.db.execute('SELECT actual_seconds FROM Learner.learner_progress_entries WHERE id=2').fetchone()[0])

    def test_shared_projection_preserves_retries_failures_staff_corrections_and_retained_imports(self):
        records = [
            self.entry(1, component_ref='retry', verified_seconds=120),
            self.entry(2, component_ref='retry', verified_seconds=300),
            self.entry(3, kind='quiz', quiz_ref='Q1', passed=False, verified_seconds=600),
            self.entry(4, actual_seconds=0, claimed_seconds=999, verified_seconds=999),
            self.entry(5, component_ref='corrected', verified_seconds=7500),
            self.entry(6, component_ref='corrected', actual_seconds=600, actual_basis='staff:module-progress'),
            self.entry(7, component_ref='imported', verified_seconds=800),
            self.entry(8, source_system='import', actual_seconds=900, source_payload={'original_source_ref': 'progress:7'}),
            self.entry(9, source_system='import', verified_seconds=999),
            self.entry(10, kind='activity_event', verified_seconds=999),
            self.entry(11, submitted_at=None, verified_seconds=999),
            self.entry(12, verified_seconds=999),
            self.entry(13, deleted_at='2026-10-12', actual_seconds=999),
        ]
        self.db.execute('INSERT INTO Learner.learner_activity_reporting_segments VALUES(12,101)')
        records[11]['segments'] = [{'actual_seconds': 999}]
        records = [row for row in records if not row.get('deleted_at')]
        expected = canonical.metrics_from_records(canonical.progress_records_with_completion(records, project_current(records, {})), {})['otjh']['actual']
        with patch.object(canonical, 'query', side_effect=self.read):
            months = read_hour_totals(self.owner)
        self.assertEqual(round(sum(row['completed'] for row in months), 4), expected)
        self.assertEqual(expected, .5)  # One retry + staff correction + retained import.
        self.assertAlmostEqual(sum(row['submitted'] for row in months), 600 / 3600)

    def test_assignment_verdict_time_and_learner_identity_match_current_learning(self):
        self.entry(1, component_type='assignment', component_ref='shared', verified_seconds=7500)
        self.entry(2, learner_id=102, component_type='assignment', component_ref='shared', verified_seconds=7500)
        self.db.executemany('INSERT INTO Learner.learning_reflection_submissions VALUES(?,?,?,?,?,?,?,?)', [
            (1, '201', 'commercial', 'shared', 'accepted', '2.5', 'assignment', '2026-10-12'),
            (2, '202', 'apprenticeship', 'shared', 'submitted', '1.5', 'assignment', '2026-10-12'),
            (3, '201', 'apprenticeship', 'shared', 'accepted', '100', 'assignment', '2026-10-13'),
        ])
        owners = [self.owner, {'id': 102, 'enrolment_id': 202, 'learner_type': 'apprenticeship'}]
        with patch.object(canonical, 'query', side_effect=self.read):
            result = pending_hour_records(owners)
        self.assertEqual([(r['actual_seconds'], r['accepted']) for r in result[101]], [(9000, True)])
        self.assertEqual([(r['actual_seconds'], r['accepted']) for r in result[102]], [(5400, False)])
        self.assertEqual(len(self.reads), 3)

    def test_empty_and_stored_only_ledgers_skip_current_context_reads(self):
        with patch.object(canonical, 'query', side_effect=self.read):
            self.assertEqual(pending_hour_records([]), {})
            self.assertEqual(self.reads, [])
            self.entry(1, actual_seconds=0, verified_seconds=7500)
            self.assertEqual(pending_hour_records([self.owner]), {101: []})
        self.assertEqual(len(self.reads), 1)
