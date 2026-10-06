"""Actual projection and time-policy functions, isolated from Django and DBs."""
import ast
import json
import re
import unittest
from datetime import datetime
from math import isfinite
from pathlib import Path
from unittest.mock import Mock
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent


def load(filename, scope, names=None):
    nodes = [n for n in ast.parse((ROOT / filename).read_text(encoding='utf-8')).body
             if isinstance(n, ast.FunctionDef) and (names is None or n.name in names)]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, 'exec'), scope)


def adapter():
    scope = dict(datetime=datetime, ZoneInfo=ZoneInfo, json=json, re=re, isfinite=isfinite,
                 GRADED_PROGRESS_KINDS={'quiz'})
    load('progress_rules.py', scope)
    load('active_users.py', scope, {'_s', '_number', '_reported_minutes', '_progress_text',
        '_manual_claimed_seconds', '_progress_record_minutes', 'otjh_progress_dedupe_key',
        'dedupe_otjh_progress_records', '_component_expected_hours_lookup', 'completed_hours_value_from_progress'})
    load('current_learning.py', scope)
    return scope


class CurrentLearningTests(unittest.TestCase):
    def setUp(self):
        self.scope = adapter()
        self.native = dict(id=1, kind='quiz', passed=True, component_ref='C1', quiz_ref='Q1',
            component_link_source='direct', component_type='quiz', submitted_at='2026-08-31T23:30:00Z',
            claimed_seconds=1200, verified_seconds=100, time_tracking_source='timer:input',
            expected_otjh=10, ksbs=['K1'])

    def project(self, rows, markings=None):
        return self.scope['project_current'](rows, markings or {})

    def test_saved_claimed_time_and_business_month(self):
        row = self.project([self.native])[0]
        self.assertEqual(row['actual_seconds'], 1200)
        self.assertEqual(row['reporting_month'], '2026-09')
        self.assertTrue(row['completed'])
        self.assertNotIn('actual_seconds', self.native)

    def test_reported_and_verified_time_without_planned_fallback(self):
        p = {**self.native, 'claimed_seconds': None, 'reported_time': '30m'}
        self.assertEqual(self.project([p])[0]['actual_seconds'], 1800)
        p['reported_time'] = ''
        self.assertEqual(self.project([p])[0]['actual_seconds'], 100)
        p['verified_seconds'] = None
        self.assertEqual(self.project([p])[0]['actual_seconds'], 0)

    def test_failed_attempt_not_completed_or_accepted(self):
        p = self.project([{**self.native, 'passed': False}])[0]
        self.assertFalse(p['accepted'])
        self.assertFalse(p['completed'])

    def test_assignment_requires_marking_and_uses_approved_hours(self):
        p = {**self.native, 'kind': 'component', 'passed': None, 'component_type': 'assignment'}
        self.assertFalse(self.project([p])[0]['accepted'])
        for status in ('draft', 'rejected', 'submitted_for_tutor_review'):
            self.assertFalse(self.project([p], {'C1': {'status': status}})[0]['accepted'])
        accepted = self.project([p], {'C1': {'status': 'accepted', 'actual_time_hours': 0.5}})[0]
        self.assertTrue(accepted['accepted'])
        self.assertEqual(accepted['actual_seconds'], 1800)

    def test_saved_actual_time_accepts_decimal_legacy_and_extended_clocks(self):
        seconds = self.scope['actual_time_seconds']
        self.assertEqual(seconds('2.5'), 9000)
        self.assertEqual(seconds('11:00'), 660)
        self.assertEqual(seconds('02:30'), 150)
        self.assertEqual(seconds('02:30:15'), 9015)
        self.assertEqual(seconds('60:00'), 3600)

    def test_invalid_saved_actual_time_remains_unavailable(self):
        seconds = self.scope['actual_time_seconds']
        for value in (None, '', ' ', '1:60', '1:02:60', '-1', 'nan', 'not-a-duration', '1:2:3:4'):
            self.assertIsNone(seconds(value), value)

    def test_assignment_clock_duration_replaces_progress_time(self):
        p = {**self.native, 'kind': 'component', 'passed': None, 'component_type': 'assignment'}
        accepted = self.project([p], {'C1': {'status': 'accepted', 'actual_time_hours': '11:00'}})[0]
        self.assertEqual(accepted['actual_seconds'], 11 * 60)

    def test_extra_activity_accepts_legacy_clock_duration(self):
        submission = dict(id='legacy', submitted_at=self.native['submitted_at'],
            activity_type='extra_activity', status='accepted', actual_time_hours='02:30', ksb_codes=[])
        merged = self.scope['merge_submissions']([], [submission])
        self.assertEqual(merged[0]['actual_seconds'], 150)

    def test_retries_do_not_add_hours_or_remove_previous_pass(self):
        rows = self.project([self.native, {**self.native, 'id': 2, 'claimed_seconds': 2400},
            {**self.native, 'id': 3, 'claimed_seconds': 9000, 'passed': False}])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_seconds'], 2400)
        self.assertTrue(rows[0]['accepted'])

    def test_consolidated_zero_and_segments_are_preserved(self):
        for extra in ({'actual_seconds': 0}, {'source_system': 'journal'}, {'segments': [{'actual_seconds': 50}]}):
            p = {**self.native, **extra}
            self.assertEqual(self.project([p]), [p])

    def test_sync_mirror_not_counted_twice(self):
        retained = {'id': 9, 'source_system': 'new_lms', 'actual_seconds': 1200,
                    'source_payload': {'original_source_ref': 'progress:1'}}
        self.assertEqual(self.project([retained, self.native]), [retained])

    def test_list_source_payload_preserves_record_without_inventing_lineage(self):
        retained = {'id': 9, 'source_system': 'journal', 'actual_seconds': 1200,
                    'source_payload': ['synthetic-evidence-a', 'synthetic-evidence-b']}
        self.assertEqual(self.project([retained]), [retained])
        self.assertIsNone(self.scope['source_reference'](retained))
        self.assertEqual(self.scope['source_payload_metadata'](retained['source_payload']), {})
        self.assertEqual(self.scope['source_payload_metadata']('{"original_source_ref":"progress:1"}'),
                         {'original_source_ref': 'progress:1'})

    def test_unsubmitted_and_event_rows_do_not_increment_progress(self):
        self.assertEqual(self.project([{**self.native, 'submitted_at': None},
                                      {**self.native, 'kind': 'activity_event'}]), [])

    def attempt(self, **changes):
        return dict(group_id=5, activity_id=9, completed=True, best_percent=90,
                    submitted_at=self.native['submitted_at'], title='Synthetic quiz', **changes)

    def test_subject_completion_keeps_unapproved_hours_unapproved(self):
        record = {'id': 10, 'accepted': False, 'actual_seconds': 3600,
                  'source_payload': {'original_source_ref': 'la:5:9'}}
        rows = self.scope['merge_attempts']([record], [self.attempt()])
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]['completed'])
        self.assertFalse(rows[0]['accepted'])
        self.assertEqual(rows[0]['actual_seconds'], 3600)

    def test_course_scoped_attempt_without_duration_has_no_hours(self):
        other = {'id': 10, 'accepted': True, 'actual_seconds': 3600,
                 'source_payload': {'original_source_ref': 'la:6:9'}}
        rows = self.scope['merge_attempts']([other], [self.attempt()])
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[1]['actual_seconds'])
        self.assertTrue(rows[1]['completed'])

    def test_accepted_extra_activity_once_and_no_drafts(self):
        s = dict(id='extra1', submitted_at=self.native['submitted_at'], activity_type='extra_activity',
                 status='accepted', actual_time_hours=1, ksb_codes=['K1'])
        merge = self.scope['merge_submissions']
        rows = merge([], [s])
        self.assertEqual(rows[0]['actual_seconds'], 3600)
        self.assertTrue(rows[0]['accepted'])
        self.assertEqual(merge(rows, [s]), rows)
        self.assertEqual(merge([], [{**s, 'status': 'draft'}]), [])

    def test_extra_activity_accepts_clock_duration(self):
        submission = dict(id='extra-clock', submitted_at=self.native['submitted_at'],
                          activity_type='extra_activity', status='accepted',
                          actual_time_hours='02:00:00', ksb_codes=[])
        rows = self.scope['merge_submissions']([], [submission])
        self.assertEqual(rows[0]['actual_seconds'], 7200)

    def test_reads_are_scoped_to_both_account_and_aptem(self):
        query = Mock(side_effect=[[], [{'name': 'exists'}], [self.attempt()]])
        self.scope['query'] = query
        rows = self.scope['current_records']({'enrolment_id': 123, 'aptem_id': 789,
                                              'learner_type': 'commercial'}, [self.native])
        self.assertEqual(query.call_args_list[0].args[1], ['123', 'commercial'])
        self.assertEqual(query.call_args_list[2].args[1], [123, 789])
        self.assertEqual(len(rows), 2)

    def test_bulk_projection_bounds_shared_queries_for_the_whole_caseload(self):
        query = Mock(side_effect=[
            [],
            [{'name': '"Learner".subject_activity_attempts'}],
            [{'enrolment_id': 123, 'aptem_id': 789, **self.attempt()}],
        ])
        self.scope['query'] = query
        owners = [
            {'id': 1, 'enrolment_id': 123, 'aptem_id': 789, 'learner_type': 'commercial'},
            {'id': 2, 'enrolment_id': 124, 'aptem_id': 790, 'learner_type': 'apprenticeship'},
        ]

        rows = self.scope['current_records_bulk'](owners, {1: [], 2: []})

        self.assertEqual(query.call_count, 3)
        self.assertEqual(len(rows[123]), 1)
        self.assertEqual(rows[124], [])
        self.assertIn('(learner_id,learner_kind) IN', query.call_args_list[0].args[0])
        self.assertIn('(enrolment_id,aptem_id) IN', query.call_args_list[2].args[0])

    def test_dashboard_refresh_reads_new_saved_completion_and_time(self):
        scope = self.scope
        load('canonical_learning.py', scope, {'metrics', 'metrics_from_records',
            'recorded_seconds', 'allocations', 'counts_as_completed'})
        scope['number'] = lambda value: float(value or 0)
        owner = {'id': 1}
        scope['require_profile'] = lambda _: owner
        scope['targets_for'] = lambda _: {}
        saved = []
        scope['entries_for'] = lambda _: self.project(saved)
        self.assertEqual(scope['metrics'](123)['programme']['completed'], 0)
        saved.append(self.native)
        result = scope['metrics'](123)
        self.assertEqual(result['programme']['completed'], 1)
        self.assertAlmostEqual(result['otjh']['actual'], 0.3333)
        saved.append({**self.native, 'id': 2})
        self.assertEqual(scope['metrics'](123), result)

    def test_quiz_only_completion_does_not_credit_unapproved_hours(self):
        scope = self.scope
        load('canonical_learning.py', scope, {'metrics', 'metrics_from_records',
            'recorded_seconds', 'allocations', 'counts_as_completed'})
        scope['number'] = lambda value: float(value or 0)
        owner = {'id': 1}
        scope['require_profile'] = lambda _: owner
        scope['targets_for'] = lambda _: {}
        record = {'id': 10, 'accepted': False, 'actual_seconds': 3600, 'ksbs': [],
                  'source_payload': {'original_source_ref': 'la:5:9'}}
        scope['entries_for'] = lambda _: scope['merge_attempts']([record], [self.attempt()])
        result = scope['metrics'](123)
        self.assertEqual(result['programme']['completed'], 1)
        self.assertEqual(result['programme']['total'], 1)
        self.assertEqual(result['otjh']['actual'], 0)


if __name__ == '__main__':
    unittest.main()
