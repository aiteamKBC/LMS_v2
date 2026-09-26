"""Isolated consolidated-record regressions: no DB, app startup or network."""
import ast
import base64
import hashlib
import json
import math
import re
import unittest
from collections import defaultdict
from contextlib import nullcontext
from datetime import date, datetime
from html import escape
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent


class ServiceError(Exception):
    pass


def functions(filename, scope, names=None):
    nodes = [node for node in ast.parse((ROOT / filename).read_text(encoding='utf-8')).body
             if isinstance(node, ast.FunctionDef) and (names is None or node.name in names)]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, 'exec'), scope)


def adapter(query):
    scope = dict(query=query, json=json, math=math, hashlib=hashlib, re=re,
                 datetime=datetime, escape=escape, UK=ZoneInfo('Europe/London'), ServiceError=ServiceError,
                 PILOT_IDENTITIES=ast.literal_eval(next(node.value for node in
                     ast.parse((ROOT / 'canonical_learning.py').read_text(encoding='utf-8')).body
                     if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PILOT_IDENTITIES' for t in node.targets))))
    functions('monthly_log_sources.py', scope, {'decoded', 'number', 'stable_id', 'row'})
    functions('canonical_learning.py', scope)
    return scope


class CanonicalLearningTests(unittest.TestCase):
    def setUp(self):
        self.query = Mock()
        self.scope = adapter(self.query)
        self.owner = {'id': 510, 'enrolment_id': 271, 'aptem_id': 3582, 'programme_id': 'PROG-ME-L4'}

    def test_other_learners_never_query_pilot_records(self):
        self.assertIsNone(self.scope['profile'](272))
        self.assertEqual(self.scope['entries'](272), [])
        self.assertEqual(self.scope['activity_rows'](272), [])
        self.query.assert_not_called()

    def test_second_pilot_keeps_identity_entries_and_documents_separate(self):
        owner = {'id': 536, 'enrolment_id': 234, 'aptem_id': 4691,
                 'programme_id': 'PROG-20260907141619067932'}
        self.query.side_effect = [[owner], [{'payload': {'id': 99, 'kind': 'reading',
            'accepted': True, 'actual_seconds': 3600, 'reporting_month': '2026-08'}, 'ksbs': []}],
            [{'id': 8, 'progress_id': 99, 'display_name': 'Evidence.pdf', 'content_type': 'application/pdf'}]]
        rows = self.scope['activity_rows'](234)
        self.assertEqual(self.query.call_args_list[0].args[1], [536, 234, 4691, owner['programme_id']])
        self.assertEqual(self.query.call_args_list[1].args[1], [536, 234, 4691, owner['programme_id']])
        self.assertEqual(self.query.call_args_list[2].args[1], [536])
        self.assertEqual(rows[0]['documents'][0]['url'], '/learner_api/monthly-logs/234/canonical-documents/8/')

    def test_metrics_use_final_records_and_accepted_hours_not_source_snapshots(self):
        self.scope['entries'] = Mock(return_value=[
            {'id': 1, 'accepted': True, 'actual_seconds': 1800, 'ksbs': ['K1', 'K1']},
            {'id': 2, 'accepted': False, 'actual_seconds': 7200, 'ksbs': ['K1', 'S1']},
            {'id': 3, 'accepted': True, 'actual_seconds': None, 'ksbs': ['S1']},
        ])
        self.scope['targets'] = Mock(return_value={})
        result = self.scope['metrics'](271)
        self.assertEqual(result['programme']['total'], 3)
        self.assertEqual(result['programme']['completed'], 2)
        self.assertEqual(result['programme']['percent'], 66.67)
        self.assertEqual(result['otjh']['completed_actual'], 0.5)
        self.assertIsNone(result['otjh']['planned'])
        self.assertIsNone(result['aptem_planned_total'])
        self.assertEqual(result['ksb']['total'], 4)
        self.assertEqual(result['ksb']['completed'], 2)
        self.scope['targets'].return_value = {'2026-07': 12, '2026-08': 15}
        self.assertEqual(self.scope['metrics'](271)['otjh']['planned'], 27)

    def test_identity_mismatch_fails_closed(self):
        self.query.return_value = []
        with self.assertRaises(ServiceError):
            self.scope['profile'](271)
        self.assertEqual(self.query.call_args.args[1], [510, 271, 3582, 'PROG-ME-L4'])

    def test_final_rows_only_no_source_duplicates_and_uk_time(self):
        record = {'id': 1, 'component_title': 'Reading', 'kind': 'reading', 'accepted': True,
                  'actual_seconds': 1800, 'reporting_month': '2026-09',
                  'reporting_started_at': '2026-08-31T23:30:00+00:00', 'source_payload': {}}
        self.query.side_effect = [[self.owner], [{'payload': json.dumps(record), 'ksbs': '["K1"]'}],
                                 [{'id': 9, 'progress_id': 1, 'display_name': 'Evidence.pdf', 'content_type': 'application/pdf'},
                                  {'id': 10, 'progress_id': 2, 'display_name': 'Other.pdf', 'content_type': 'application/pdf'}]]
        rows = self.scope['activity_rows'](271)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_hours'], .5)
        self.assertEqual(rows[0]['activity_date'], '2026-09-01')
        self.assertEqual(rows[0]['ksb_codes'], ['K1'])
        self.assertEqual(len(rows[0]['documents']), 1)
        sql, params = self.query.call_args_list[1].args
        self.assertIn('p.deleted_at IS NULL', sql)
        self.assertEqual(params, [510, 271, 3582, 'PROG-ME-L4'])
        self.assertNotIn('learner_activity_sources', sql)

    def test_missing_timestamp_is_not_invented_and_rejection_is_preserved(self):
        self.query.side_effect = [[self.owner], [{'payload': {'id': 2, 'kind': 'assignment',
            'reporting_month': '2026-08', 'actual_seconds': None, 'accepted': False}, 'ksbs': []}], []]
        row = self.scope['activity_rows'](271)[0]
        self.assertEqual(row['activity_date'], '')
        self.assertEqual(row['reporting_month'], '2026-08')
        self.assertFalse(row['actual_hours_recorded'])
        self.assertFalse(row['accepted'])

    def test_monthly_projection_includes_history_without_legacy_union(self):
        canonical = SimpleNamespace(enabled=lambda _: True,
            activity_rows=lambda _: [{'reporting_month': '2025-07'}, {'reporting_month': '2026-09'}, {'reporting_month': '2026-12'}],
            targets=lambda _: {'2026-08': 2})
        scope = dict(canonical=canonical, defaultdict=defaultdict,
                     timezone=SimpleNamespace(localdate=lambda: date(2026, 9, 24)))
        functions('monthly_logs.py', scope, {'current_months'})
        grouped = scope['current_months']({'id': 271}, include_open=True)
        self.assertEqual(set(grouped), {'2025-07', '2026-08', '2026-09'})
        self.assertEqual(len(grouped['2025-07']), 1)

    def test_subject_progress_uses_exact_lineage_and_never_matches_titles(self):
        activity = {'source_activity_id': 10, 'group_id': 50, 'activity': 'Same title', 'completed': False}
        records = [{'id': 1, 'source_system': 'journal', 'source_payload': {'original_source_ref': 'la:50:10'},
                    'accepted': True, 'actual_seconds': 1800, 'reporting_month': '2026-09', 'ksbs': ['K1'],
                    'activity_status': 'completed'},
                   {'id': 2, 'source_system': 'journal', 'source_payload': {'original_source_ref': 'la:51:10'},
                    'accepted': True, 'actual_seconds': 3600, 'reporting_month': '2026-09', 'ksbs': ['K2']}]
        summarize = lambda items: {'activities': items}
        result = self.scope['overlay_subjects']({'activities': [activity]}, records, summarize)
        self.assertEqual(result['activities'][0]['actual'], .5)
        self.assertTrue(result['activities'][0]['completed'])
        self.assertEqual(result['recorded_otjh_total'], 1.5)
        self.assertFalse(activity['completed'])

    def test_ambiguous_old_course_link_is_not_guessed(self):
        activities = [{'source_activity_id': 10, 'group_id': group} for group in (50, 51)]
        records = [{'id': 1, 'source_system': 'old_lms', 'source_payload': {'component_id': 10},
                    'accepted': True, 'actual_seconds': 1800, 'ksbs': []}]
        result = self.scope['overlay_subjects']({'activities': activities}, records, lambda items: {'activities': items})
        self.assertTrue(all(not item['has_result'] for item in result['activities']))

    def test_document_access_is_scoped_and_excludes_deleted_records(self):
        query = Mock(return_value=[])
        scope = dict(scope=Mock(), canonical=SimpleNamespace(profile=lambda _: self.owner),
                     old_repo=SimpleNamespace(query=query), old=SimpleNamespace(ServiceError=ServiceError))
        functions('monthly_logs.py', scope, {'canonical_document'})
        with self.assertRaises(ServiceError):
            scope['canonical_document'](object(), 271, 999)
        sql, params = query.call_args.args
        self.assertIn('p.learner_id=d.learner_id', sql)
        self.assertIn('d.deleted_at IS NULL', sql)
        self.assertEqual(params, [999, 510, 271, 'PROG-ME-L4'])

    def test_signing_pilot_writes_only_new_signature_table(self):
        report = {'snapshot_digest': 'digest', 'student_signature': None, 'coach_signature': None, 'rows': []}
        query = Mock(return_value=[])
        scope = dict(canonical=SimpleNamespace(enabled=lambda _: True, profile=lambda _: self.owner),
            scope=lambda *_: ({'id': 271, 'aptem_id': 3582}, 'learner'),
            storage=SimpleNamespace(sanitize=lambda _: b'png'), valid_month=lambda _: None,
            require_closed_month=lambda _: None, transaction=SimpleNamespace(atomic=lambda **_: nullcontext()),
            old_repo=SimpleNamespace(query=query), old=SimpleNamespace(ServiceError=ServiceError),
            detail_data=lambda *a, **kw: report, lock_state=lambda *_: {'locked': False},
            lock_if_fully_signed=Mock(), JsonResponse=lambda value: value, json=json, base64=base64)
        functions('monthly_logs.py', scope, {'sign'})
        request = SimpleNamespace(POST={'snapshot_digest': 'digest', 'confirmed': 'true', 'capture_method': 'draw'},
            FILES={'signature': object()}, GET={}, login_account=SimpleNamespace(display_name='Synthetic learner', email='', id=1))
        scope['sign'](request, 271, '2026-08')
        sql, params = query.call_args.args
        self.assertIn('"Learner".learner_monthly_signatures', sql)
        self.assertEqual(params[:3], [510, '2026-08', 'learner'])
        self.assertNotIn('monthly_audit_signoffs', sql)
        query.reset_mock()
        report['student_signature'] = {'signed_at': 'saved'}
        scope['sign'](request, 271, '2026-08')
        self.assertEqual(query.call_count, 1)  # Owner lock only; never overwrite a saved signature.


if __name__ == '__main__':
    unittest.main()
