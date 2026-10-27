"""Exercise compact coach reads against an isolated in-memory ledger."""
import json
import sqlite3
from unittest.mock import patch

from django.test import SimpleTestCase
from coach_api.otjh_ksb import read_hour_totals
from learner_api import canonical_learning as canonical
from learner_api.canonical_hours import extra_activity_hour_records, pending_hour_records
from learner_api.current_learning import merge_submissions, project_current


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
            id,learner_id,learner_kind,component_ref,status,actual_time_hours,activity_type,submitted_at,
            progress_entry_id,activity_title,module_title,ksb_codes,full_submission)''')
        self.reads = []

    def read(self, sql, params):
        self.reads.append((sql, params))
        # Translate PostgreSQL syntax only; retain the reader's actual predicates.
        sql = sql.replace('actual_seconds::text', 'CAST(actual_seconds AS TEXT)')
        sql = sql.replace('s.id::text', 'CAST(s.id AS TEXT)')
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
        self.db.executemany('''INSERT INTO Learner.learning_reflection_submissions
            (id,learner_id,learner_kind,component_ref,status,actual_time_hours,activity_type,submitted_at)
            VALUES(?,?,?,?,?,?,?,?)''', [
            (1, '201', 'commercial', 'shared', 'accepted', '2.5', 'assignment', '2026-10-12'),
            (2, '202', 'apprenticeship', 'shared', 'submitted', '1.5', 'assignment', '2026-10-12'),
            (3, '201', 'apprenticeship', 'shared', 'accepted', '100', 'assignment', '2026-10-13'),
        ])
        owners = [self.owner, {'id': 102, 'enrolment_id': 202, 'learner_type': 'apprenticeship'}]
        with patch.object(canonical, 'query', side_effect=self.read):
            result = pending_hour_records(owners)
        self.assertEqual([(r['actual_seconds'], r['accepted']) for r in result[101]], [(9000, True)])
        self.assertEqual([(r['actual_seconds'], r['accepted']) for r in result[102]], [(5400, False)])
        self.assertEqual(len(self.reads), 4)  # One bounded extra-activity read for both owners.

    def test_empty_and_stored_only_ledgers_skip_current_context_reads(self):
        with patch.object(canonical, 'query', side_effect=self.read):
            self.assertEqual(pending_hour_records([]), {})
            self.assertEqual(self.reads, [])
            self.entry(1, actual_seconds=0, verified_seconds=7500)
            self.assertEqual(pending_hour_records([self.owner]), {101: []})
        self.assertEqual(len(self.reads), 2)

    def extra(self, key, **values):
        row = dict(id=key, learner_id='201', learner_kind='commercial', component_ref=None,
                   status='accepted', actual_time_hours='1', activity_type='extra_activity',
                   submitted_at='2026-10-23T13:00:00+00:00', progress_entry_id=None,
                   activity_title='Independent extra activity', module_title='', ksb_codes='[]',
                   full_submission=json.dumps({'monthlyAssignment': {'month': '2026-09'}}))
        row.update(values)
        self.db.execute(f'INSERT INTO Learner.learning_reflection_submissions ({",".join(row)}) '
                        f'VALUES ({",".join("?" for _ in row)})', list(row.values()))
        return {**row, 'activity_month': json.loads(row['full_submission']).get('monthlyAssignment', {}).get('month')}

    def test_extra_review_changes_actual_once_and_leaves_assignment_and_plan_unchanged(self):
        assignment = self.entry(1, component_type='assignment', actual_seconds=3600)
        assignment['expected_otjh'] = 2
        extra = self.extra('extra')
        for status, expected in [('submitted_for_tutor_review', 1), ('accepted', 2), ('accepted', 2),
                                 ('partial', 2), ('referred', 1), ('rejected', 1), ('draft', 1)]:
            with self.subTest(status=status):
                self.db.execute('UPDATE Learner.learning_reflection_submissions SET status=? WHERE id=?',
                                [status, 'extra'])
                before = self.db.total_changes
                with patch.object(canonical, 'query', side_effect=self.read):
                    months = read_hour_totals(self.owner)
                learner = canonical.progress_records_with_completion([assignment],
                    merge_submissions([assignment], [{**extra, 'status': status}]))
                hours = canonical.metrics_from_records(learner, {'2026-10': 2})['otjh']
                self.assertEqual(sum(row['completed'] for row in months), expected)
                self.assertEqual(hours['actual'], expected)
                self.assertEqual(hours['planned'], 2)
                self.assertEqual(assignment['actual_seconds'], 3600)
                self.assertEqual(self.db.total_changes, before)
                if status == 'accepted':
                    self.assertEqual(next(row for row in months if row['month'] == '2026-09')['completed'], 1)

    def test_extra_ledger_links_and_imports_are_not_counted_twice(self):
        ledger = [self.entry(1, actual_seconds=1800),
                  self.entry(2, actual_seconds=900, source_payload={'original_source_ref': 'reflection:source'})]
        extras = [self.extra('linked', progress_entry_id=1),
                  self.extra('component', component_ref='C1'),
                  self.extra('source'),
                  self.extra('imported', full_submission=json.dumps({'submissionOrigin': 'imported_legacy'})),
                  self.extra('separate', actual_time_hours='1.25')]
        with patch.object(canonical, 'query', side_effect=self.read):
            records = extra_activity_hour_records([self.owner])[101]
            totals = read_hour_totals(self.owner)
        self.assertEqual([row['id'] for row in records], ['reflection:separate'])
        self.assertEqual(sum(row['completed'] for row in totals), 2)
        extras[3]['imported'] = True
        current = merge_submissions(ledger, extras)
        expected = canonical.metrics_from_records(canonical.progress_records_with_completion(ledger, current), {})
        self.assertEqual(expected['otjh']['actual'], 2)

    def test_empty_component_reference_does_not_link_unrelated_extra_to_ledger(self):
        ledger = self.entry(1, component_ref='', actual_seconds=3600)
        extra = self.extra('independent', component_ref='')
        with patch.object(canonical, 'query', side_effect=self.read):
            result = read_hour_totals(self.owner)
        self.assertEqual(sum(row['completed'] for row in result), 2)
        self.assertEqual(len(merge_submissions([ledger], [extra])), 2)

    def test_extra_scopes_enrolment_and_kind_and_preserves_selected_or_uk_month(self):
        self.extra('one')
        self.extra('two', learner_id='202', learner_kind='apprenticeship', actual_time_hours='1.25')
        self.extra('wrong-kind', learner_id='201', learner_kind='apprenticeship', actual_time_hours='99')
        self.extra('wrong-learner', learner_id='203', actual_time_hours='99')
        self.extra('uk-fallback', submitted_at='2026-09-30T23:30:00Z', full_submission='{}')
        owners = [self.owner, {'id': 102, 'enrolment_id': 202, 'learner_type': 'apprenticeship'}]
        with patch.object(canonical, 'query', side_effect=self.read):
            result = extra_activity_hour_records(owners)
        self.assertEqual({row['id'] for row in result[101]}, {'reflection:one', 'reflection:uk-fallback'})
        self.assertEqual(result[102][0]['actual_seconds'], 4500)
        self.assertEqual({row['id']: row['reporting_month'] for row in result[101]},
                         {'reflection:one': '2026-09', 'reflection:uk-fallback': '2026-10'})
        self.assertTrue(all(row['expected_otjh'] == 0 for rows in result.values() for row in rows))
        self.assertEqual(len(self.reads), 1)

    def test_coach_monthly_summary_counts_approved_extra_without_a_planned_target(self):
        from coach_api import monthly_logs
        from datetime import date
        self.extra('accepted', actual_time_hours='1.25')
        self.extra('pending', status='submitted_for_tutor_review')
        learner = {'id': 201, 'name': 'Synthetic learner', 'programme': 'Programme', '_canonical_profile': self.owner}
        with patch.object(canonical, 'query', side_effect=self.read), \
             patch.object(monthly_logs, 'query', side_effect=[[], []]), \
             patch.object(canonical, 'targets_for', return_value={'2026-10': 2}), \
             patch.object(monthly_logs.timezone, 'localdate', return_value=date(2026, 10, 26)):
            result = monthly_logs.project_year(learner, 2026)
        self.assertEqual(result['summary']['acceptedOtjhHours'], 1.25)
        self.assertEqual(result['summary']['trainingPlanHours'], 2)
        september = result['months'][0]
        self.assertEqual(september['month'], '2026-09')
        self.assertEqual(september['acceptedOtjhHours'], 1.25)
        self.assertEqual(september['activities'], 2)
        self.assertIsNone(september['targetHours'])
