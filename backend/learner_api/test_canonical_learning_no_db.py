"""Isolated consolidated-record regressions: no DB, app startup or network."""
import ast
import base64
import hashlib
import json
import math
import re
import sys
import unittest
from collections import defaultdict
from contextlib import nullcontext
from datetime import date, datetime
from html import escape
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent))


class ServiceError(Exception):
    def __init__(self, message, code=None, status=None):
        super().__init__(message)
        self.code, self.status = code, status


def functions(filename, scope, names=None):
    if filename == 'canonical_learning.py':
        from learner_api.selectors import identity as identity_selector
        scope.setdefault('identity_selector', identity_selector)
        # Preserve disabled-path characterization; enabled reads are exercised
        # by login/test_learner_auth_http.py on real disposable PostgreSQL.
        scope.setdefault('learner_auth_runtime', SimpleNamespace(enabled=lambda: False))
    nodes = [node for node in ast.parse((ROOT / filename).read_text(encoding='utf-8')).body
             if isinstance(node, ast.FunctionDef) and (names is None or node.name in names)]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, 'exec'), scope)


def adapter(query):
    scope = dict(query=query, json=json, math=math, hashlib=hashlib, re=re,
                 datetime=datetime, escape=escape, UK=ZoneInfo('Europe/London'), ServiceError=ServiceError,
                 # KSB exclusion registry: absent here, as on a database the
                 # standards migration has not touched (no filter applied).
                 not_excluded_sql=lambda alias='k', using='default': '1 = 1',
                 repository=SimpleNamespace(_query_alias=SimpleNamespace(get=lambda: None), DB='enrolment'),
                 current_records=lambda owner, records: records,
                 current_records_bulk=lambda owners, records: {
                     owner['enrolment_id']: records.get(owner['id'], []) for owner in owners
                 })
    functions('monthly_log_sources.py', scope, {'decoded', 'number', 'stable_id', 'row'})
    functions('current_learning.py', scope, {'source_payload_metadata', 'is_unsynchronised_direct_save'})
    functions('canonical_learning.py', scope)
    return scope


class CanonicalLearningTests(unittest.TestCase):
    def test_new_completion_date_moves_month_and_timestamp_without_rewriting_audit(self):
        self.query.return_value = []
        entry = {'id': 1, 'ksbs': [], 'accepted': True, 'actual_seconds': 1800,
                 'reporting_month': '2026-10', 'submitted_at': '2026-10-02T10:00:00Z',
                 'declared_completed_at': '2026-09-30T14:30:00+01:00',
                 'started_at': '2026-10-02T09:30:00Z',
                 'reporting_timestamp_label': '10:30:00 - 11:00:00'}
        original = dict(entry)
        row = self.scope['rows_for'](self.owner, [entry])[0]
        self.assertEqual(row['reporting_month'], '2026-09')
        self.assertEqual(row['activity_date'], '2026-09-30')
        self.assertEqual(row['timestamp_label'], '14:30:00')
        self.assertEqual(row['actual_hours'], 0.5)
        self.assertEqual(entry, original)
        scope = {'defaultdict': defaultdict, 'canonical_learning': SimpleNamespace(**self.scope)}
        functions('training_plan_dashboard.py', scope, {'_canonical_actual_rows'})
        totals = scope['_canonical_actual_rows'](self.owner, [entry])
        self.assertEqual(totals, [{'month': '2026-09', 'groupId': None, 'hours': 0.5, 'count': 1}])
        # The dashboard uses the same allocation to select the month and hours.
        parts = self.scope['allocations'](entry)
        self.assertEqual(sum(p['actual_seconds'] for p in parts if p['reporting_month'] == '2026-09'), 1800)
        self.assertFalse(any(p['reporting_month'] == '2026-10' for p in parts))
        dashboard = {'defaultdict': defaultdict, 'canonical': SimpleNamespace(**self.scope),
                     'number': self.scope['number']}
        functions('dashboard_tabs.py', dashboard, {'monthly_hours'})
        chart = dashboard['monthly_hours'](self.owner, [entry], {}, current_month='2026-10')
        self.assertEqual(chart['months'], [{'month': '2026-09', 'actual_hours': 0.5,
                                          'not_accepted_hours': 0, 'training_plan_target': None}])
        self.scope['entries_for'] = Mock(return_value=[entry])
        found, original_record = self.scope['content_row'](self.owner, '2026-09', row['id'])
        self.assertEqual(found['id'], row['id'])
        self.assertEqual(original_record, original)
        with self.assertRaises(ServiceError):
            self.scope['content_row'](self.owner, '2026-10', row['id'])

    def test_new_submission_fallback_uses_uk_month_and_saved_start(self):
        self.query.return_value = []
        entry = {'id': 2, 'ksbs': [], 'accepted': True, 'actual_seconds': 900,
                 'reporting_month': '2026-10', 'submitted_at': '2026-09-30T23:30:00Z',
                 'started_at': '2026-09-30T23:15:00Z'}
        row = self.scope['rows_for'](self.owner, [entry])[0]
        self.assertEqual(row['activity_date'], '2026-10-01')
        self.assertEqual(row['reporting_month'], '2026-10')
        self.assertEqual(row['timestamp_label'], '00:15:00 - 00:30:00')
        report_start = {**entry, 'started_at': None, 'reporting_started_at': entry['started_at']}
        self.assertEqual(self.scope['rows_for'](self.owner, [report_start])[0]['timestamp_label'],
                         '00:15:00 - 00:30:00')
        for missing in (None, ''):
            single = self.scope['rows_for'](self.owner, [{**entry, 'started_at': missing,
                                                          'declared_completed_at': missing}])[0]
            self.assertEqual(single['timestamp_label'], '00:30:00')

    def test_completion_policy_preserves_older_and_missing_submission_records(self):
        cases = [
            {'reporting_month': '2026-09', 'submitted_at': '2026-09-20T12:00:00Z',
             'declared_completed_at': '2026-09-19T10:00:00Z'},
            {'reporting_month': '2025-11', 'submitted_at': '2026-10-20T12:00:00Z',
             'source_system': 'journal', 'reporting_timestamp_label': 'Input'},
            {'reporting_month': '2026-10', 'submitted_at': None,
             'reporting_timestamp_label': 'attended'},
        ]
        for entry in cases:
            with self.subTest(entry=entry):
                self.assertEqual(self.scope['allocations'](entry), [entry])

    def test_declared_completion_handles_uk_dst_without_changing_seconds_or_acceptance(self):
        for value, expected in [('2026-10-24T23:30:00Z', '00:30:00'),
                                ('2026-10-25T02:30:00Z', '02:30:00'),
                                ('2026-10-25T14:30:00', '14:30:00')]:
            with self.subTest(value=value):
                entry = {'submitted_at': '2026-11-02T12:00:00Z', 'declared_completed_at': value,
                         'reporting_month': '2026-11', 'actual_seconds': 123, 'accepted': False}
                part = self.scope['allocations'](entry)[0]
                self.assertEqual(part['reporting_month'], '2026-10')
                self.assertEqual(part['reporting_timestamp_label'], expected)
                self.assertEqual(part['actual_seconds'], 123)
                self.assertFalse(part['accepted'])

    def test_staff_input_date_reaches_activity_log_without_inventing_a_timestamp(self):
        self.query.return_value=[]
        entry={'id':1,'accepted':True,'actual_seconds':3617,'actual_basis':'staff:module-progress','reporting_month':'2026-10',
            'reporting_timestamp_label':'Input','reporting_started_at':None,'reporting_ended_at':None,'ksbs':[],
            'source_payload':{'staff_time_entry':{'mode':'input','activity_date':'2026-10-01'}}}
        row=self.scope['rows_for'](self.owner,[entry])[0]
        self.assertEqual(row['activity_date'],'2026-10-01')
        self.assertEqual(row['timestamp_label'],'Input')
        self.assertAlmostEqual(row['actual_hours'],3617/3600)
        self.assertIsNone(entry['reporting_started_at']);self.assertIsNone(entry['reporting_ended_at'])
        for day in ('2026-09-30','2026-02-30'):
            invalid={**entry,'source_payload':{'staff_time_entry':{'mode':'input','activity_date':day}}}
            self.assertIsNone(self.scope['input_activity_date'](invalid))
    def test_completion_status_does_not_invent_accepted_otj_hours(self):
        completed = {'activity_status': 'completed', 'accepted': False,
                     'actual_seconds': None, 'ksbs': []}
        pending = {'activity_status': 'not_started', 'accepted': False,
                   'actual_seconds': None, 'ksbs': []}
        result = self.scope['metrics_from_records']([completed, pending], {})
        self.assertEqual(result['programme']['completed'], 1)
        self.assertEqual(result['programme']['total'], 2)
        self.assertEqual(result['otjh']['actual'], 0)
        self.assertTrue(self.scope['counts_as_completed']({'activity_status': 'passed'}))
        self.assertTrue(self.scope['counts_as_completed']({
            'activity_status': 'not accepted',
            'sources': [{'activity_status': 'completed', 'completed': True}],
        }))
        self.assertFalse(self.scope['counts_as_completed']({'activity_status': 'not accepted'}))

    def test_journal_date_corrects_an_import_timestamp_without_moving_hours(self):
        entry = {'id': 1, 'source_system': 'journal', 'accepted': True,
                 'actual_seconds': 2700, 'reporting_month': '2025-11', 'ksbs': [],
                 'reporting_started_at': '2026-08-20T13:07:44+00:00',
                 'reporting_timestamp_label': '13:07:44 - 13:52:44'}
        route = {'source_system': 'journal', 'month': '2025-11', 'activity_date': '2025-11-06'}
        self.query.side_effect = [[{'payload': entry, 'journal_routes': [route]}], []]
        loaded = self.scope['entries_for'](self.owner)
        result = self.scope['rows_for'](self.owner, loaded)[0]
        self.assertEqual(result['activity_date'], '2025-11-06')
        self.assertEqual(result['reporting_month'], '2025-11')
        self.assertEqual(result['actual_hours'], 0.75)
        self.assertTrue(result['accepted'])
        self.assertEqual(result['timestamp_label'], entry['reporting_timestamp_label'])
        self.assertEqual(loaded[0]['reporting_started_at'], entry['reporting_started_at'])
        self.assertEqual(loaded[0]['journal_routes'], [route])
        sql, params = self.query.call_args_list[0].args
        self.assertIn("'activity_date',j.activity_date", sql)
        self.assertIn('j.canonical_learner_id=p.learner_id', sql)
        self.assertIn('s.learner_id=p.learner_id AND s.canonical_progress_id=p.id', sql)
        self.assertEqual(params, [self.owner['id']])

    def test_journal_date_does_not_guess_from_ambiguous_or_wrong_month_sources(self):
        route = {'source_system': 'journal', 'month': '2025-11', 'activity_date': '2025-11-06'}
        entry = {'id': 1, 'source_system': 'journal', 'accepted': True,
                 'actual_seconds': 300, 'reporting_month': '2025-11', 'ksbs': [],
                 'reporting_started_at': '2026-08-20T13:07:44+00:00'}
        self.query.return_value = []
        for routes in ([], [{**route, 'activity_date': None}],
                       [{**route, 'activity_date': '2025-11-31'}],
                       [{**route, 'month': '2026-08'}],
                       [{**route, 'activity_date': '2026-08-20'}],
                       [{**route, 'source_system': 'old_lms'}],
                       [route, {**route, 'activity_date': '2025-11-07'}]):
            with self.subTest(routes=routes):
                result = self.scope['rows_for'](self.owner, [{**entry, 'journal_routes': routes}])[0]
                self.assertEqual(result['activity_date'], '2026-08-20')
                self.assertEqual(result['reporting_month'], '2025-11')
        duplicate_routes = {**entry, 'journal_routes': [route, dict(route)]}
        self.assertEqual(self.scope['rows_for'](self.owner, [duplicate_routes])[0]['activity_date'], '2025-11-06')

    def test_journal_date_fills_a_missing_date_only_from_a_valid_link(self):
        entry = {'id': 1, 'source_system': 'journal', 'accepted': True,
                 'actual_seconds': 300, 'reporting_month': '2025-11', 'ksbs': [],
                 'journal_routes': [{'source_system': 'journal', 'month': '2025-11',
                                     'activity_date': '2025-11-06'}]}
        self.query.return_value = []
        result = self.scope['rows_for'](self.owner, [entry])[0]
        self.assertEqual(result['activity_date'], '2025-11-06')
        self.assertEqual(result['reporting_month'], '2025-11')
        self.assertEqual(result['actual_hours'], 300 / 3600)
        unlinked = {**entry, 'journal_routes': []}
        self.assertFalse(self.scope['rows_for'](self.owner, [unlinked])[0]['activity_date'])

    def test_journal_date_preserves_native_and_already_consistent_dates(self):
        route = {'source_system': 'journal', 'month': '2025-11', 'activity_date': '2025-11-06'}
        entry = {'id': 1, 'source_system': 'old_lms', 'accepted': True,
                 'actual_seconds': 300, 'reporting_month': '2025-11', 'ksbs': [],
                 'reporting_started_at': '2026-08-20T13:07:44+00:00', 'journal_routes': [route]}
        self.query.return_value = []
        self.assertEqual(self.scope['rows_for'](self.owner, [entry])[0]['activity_date'], '2026-08-20')
        consistent = {**entry, 'source_system': 'journal', 'reporting_started_at': '2025-11-20T13:07:44+00:00'}
        self.assertEqual(self.scope['rows_for'](self.owner, [consistent])[0]['activity_date'], '2025-11-20')
        boundary = {**entry, 'source_system': 'journal', 'reporting_month': '2026-09',
                    'reporting_started_at': '2026-08-31T23:30:00+00:00',
                    'journal_routes': [{**route, 'month': '2026-09', 'activity_date': '2026-09-15'}]}
        self.assertEqual(self.scope['rows_for'](self.owner, [boundary])[0]['activity_date'], '2026-09-01')

    def test_estimate_metadata_does_not_override_stored_hours_acceptance_or_month(self):
        entry = {'id': 1, 'accepted': True, 'actual_seconds': 3600,
                 'reporting_month': '2026-09', 'ksbs': [],
                 'source_payload': {'reconciliation': {'reporting_allocation': {
                     'estimated': True, 'method': 'historical_estimate'}}},
                 'segments': [{'id': 10, 'actual_seconds': 7200, 'reporting_month': '2026-08'}]}
        rejected = {**entry, 'id': 2, 'accepted': False}
        self.assertTrue(self.scope['counts_as_actual'](entry))
        self.assertFalse(self.scope['counts_as_actual'](rejected))
        self.assertEqual(self.scope['metrics_from_records']([entry, rejected], {})['otjh']['actual'], 1)
        self.query.return_value = []
        rows = self.scope['rows_for'](self.owner, [entry])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_hours'], 1)
        self.assertEqual(rows[0]['reporting_month'], '2026-09')
        self.assertTrue(rows[0]['actual_estimated'])

    def test_material_preview_requires_exact_unique_activity_or_component_id(self):
        self.scope['__package__'] = 'learner_api'
        record = {'id': 20, 'actual_seconds': 9000,
                  'source_payload': {'original_source_ref': 'att:verified-session'}}
        self.scope['entries_for'] = Mock(return_value=[record])
        material = {'source_course_ref': '50', 'source_course_title': 'Course',
            'source_activity_id': 'material:10', 'source_activity_title': 'Same title',
            'curriculum_component_ref': 'COMP-10',
            'material_record_id': 100, 'material_title': 'Same title', 'backup_status': 'available',
            'material_blob_container': 'private', 'material_blob_name': 'hash',
            'material_blob_content_type': 'application/pdf'}
        sibling = {**material, 'source_activity_id': 'material:11',
                   'curriculum_component_ref': 'COMP-11', 'material_record_id': 101}
        self.query.return_value = [material, sibling]
        signer = Mock(return_value='https://materials.example/owned-file')
        item = {'id': 9, 'progress_id': 20, 'title': 'Same title', 'category': 'Attendance'}
        with patch.dict(sys.modules, {'django.conf': SimpleNamespace(settings=SimpleNamespace()),
                'learner_api.material_storage': SimpleNamespace(read_url=signer)}):
            self.assertEqual(self.scope['material_parts'](item, self.owner), [])
            signer.assert_not_called()
            self.assertEqual(self.query.call_count, 1)
            record['curriculum_component_ref'] = 'COMP-11'
            self.assertEqual([p['id'] for p in self.scope['material_parts'](item, self.owner)], [101])
            record['sources'] = [{'source_system': 'old_lms', 'source_course_ref': '50',
                                  'source_activity_id': 'material:10'}]
            self.assertEqual([p['id'] for p in self.scope['material_parts'](item, self.owner)], [100])
            record['sources'][0]['source_activity_id'] = 'quiz:10'
            self.assertEqual(self.scope['material_parts'](item, self.owner), [])
            record['sources'][0]['source_activity_id'] = 'material:10'
            record['sources'].append({**record['sources'][0], 'source_activity_id': 'material:11'})
            self.assertEqual(self.scope['material_parts'](item, self.owner), [])
            record['sources'] = [{**record['sources'][0], 'source_course_ref': '999'}]
            self.assertEqual(self.scope['material_parts'](item, self.owner), [])
            self.assertEqual(record['actual_seconds'], 9000)

    def test_monthly_material_redirect_checks_owner_month_row_and_material(self):
        row = {'id': 9, 'progress_id': 20}
        parts = [{'id': 100, 'url': 'https://materials.example/private?sig=test'}]
        scope = {'scope': Mock(return_value=({'id': 271, '_profile': self.owner}, 'learner')),
            'valid_month': lambda month: None,
            'canonical': SimpleNamespace(enabled=lambda _: True, content_row=Mock(return_value=(row, {'id': 20})), material_parts=Mock(return_value=parts),
                content=Mock(return_value={'id': 9, 'parts': [dict(parts[0])]})),
            'detail_data': Mock(return_value={'source': 'lms', 'rows': [row]}),
            'old': SimpleNamespace(ServiceError=ServiceError),
            'HttpResponseRedirect': lambda url: {'Location': url}, 'JsonResponse': lambda value: value}
        functions('monthly_logs.py', scope, {'canonical_material', 'material_response', 'content', 'content_response'})
        response = scope['canonical_material'](None, 271, '2026-08', 9, 100)
        self.assertEqual(response['Location'], parts[0]['url'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        payload = scope['content'](None, 271, '2026-08', 9)
        self.assertEqual(payload['parts'][0]['url'], '/learner_api/monthly-logs/271/2026-08/activities/9/materials/100/')
        with self.assertRaises(ServiceError):
            scope['canonical_material'](None, 271, '2026-08', 9, 999)
        scope['canonical'].content_row.side_effect = ServiceError('Missing row', 'not_found', 404)
        scope['canonical'].material_parts.reset_mock()
        with self.assertRaises(ServiceError):
            scope['canonical_material'](None, 271, '2026-09', 9, 100)
        scope['canonical'].material_parts.assert_not_called()
        scope['scope'].side_effect = ServiceError('Not allowed', 'forbidden', 403)
        scope['detail_data'].reset_mock()
        with self.assertRaises(ServiceError):
            scope['canonical_material'](None, 999, '2026-08', 9, 100)
        scope['detail_data'].assert_not_called()

    def test_monthly_content_uses_owned_azure_material_and_keeps_notes(self):
        self.scope['__package__'] = 'learner_api'
        self.scope['entries_for'] = Mock(return_value=[{'id': 20, 'accepted': True, 'actual_seconds': 60,
            'component_ref': 'journal:42',
            'journal_routes': [{'group_id': 50, 'activity_id': 10, 'source_ref': 'la:50:10'}],
            'source_payload': {'original_source_ref': 'la:50:10'}}])
        self.query.return_value = [{'source_course_ref': '50', 'source_course_title': 'Course',
            'source_activity_id': 'material:10', 'source_activity_title': 'PDF',
            'material_record_id': 100, 'material_title': 'Local PDF', 'backup_status': 'available',
            'material_blob_container': 'private', 'material_blob_name': 'hash',
            'material_blob_content_type': 'application/pdf'}]
        read_url = Mock(return_value='https://materials.blob.core.windows.net/private/hash?sig=test')
        item = {'id': 9, 'progress_id': 20, 'title': 'Activity', 'category': 'Reading',
                'completion_note': '<private note>'}
        with patch.dict(sys.modules, {'django.conf': SimpleNamespace(settings=SimpleNamespace()),
                'learner_api.material_storage': SimpleNamespace(read_url=read_url)}):
            result = self.scope['content'](item, self.owner)
            self.assertEqual(result['parts'][0]['url'], read_url.return_value)
            self.assertEqual(result['parts'][0]['content_type'], 'application/pdf')
            self.assertIn('&lt;private note&gt;', result['parts'][1]['html'])
            self.assertEqual(self.query.call_args_list[0].args[1], [self.owner['id']])
            self.assertNotIn('Last_audit', self.query.call_args_list[0].args[0])
            self.assertIn('m.material_id=a.source_material_id', self.query.call_args_list[0].args[0])
            read_url.reset_mock()
            self.query.return_value[0]['backup_status'] = 'pending'
            pending = self.scope['content'](item, self.owner)
            self.assertIsNone(pending['parts'][0]['url'])
            self.assertIn('not ready', pending['parts'][0]['html'])
            read_url.assert_not_called()
            self.query.return_value[0]['payload'] = {'text_body': '<p>Original reading</p>',
                'quiz_questions': [{'question_text': 'Question?'}]}
            combined = self.scope['content'](item, self.owner)['parts'][0]
            self.assertEqual(combined['html'], '<p>Original reading</p>')
            self.assertEqual(len(combined['quiz']['definition']['questions']), 1)
            self.assertIsNone(combined['url'])
            self.scope['entries_for'].return_value = []
            self.query.reset_mock()
            result = self.scope['content'](item, self.owner)
            self.assertIsNone(result['parts'][0]['url'])
            self.query.assert_not_called()
            read_url.assert_not_called()

    def test_content_row_reuses_records_and_rejects_other_month(self):
        records = [{'id': 20}]
        self.scope['entries_for'] = Mock(return_value=records)
        self.scope['rows_for'] = Mock(return_value=[{'id': 7, 'progress_id': 20, 'reporting_month': '2025-07'}])
        row, record = self.scope['content_row'](self.owner, '2025-07', 7)
        self.assertIs(record, records[0])
        self.scope['entries_for'].assert_called_once_with(self.owner)
        self.scope['rows_for'].assert_called_once_with(self.owner, records, include_documents=False)
        with self.assertRaises(ServiceError):
            self.scope['content_row'](self.owner, '2025-08', 7)
        with self.assertRaises(ServiceError):
            self.scope['content_row'](self.owner, '2025-07', 99)

    def test_material_questions_exclude_grading_keys(self):
        from learner_api.source_material_content import material_quiz_definition
        definition = material_quiz_definition({'quiz_questions': [{'question_body': 'Question?',
            'correct_answer': 'Secret', 'options': [{'option_body': 'Option', 'is_correct': True}]}]})
        self.assertEqual(definition['questions'][0]['answer_options'], [{'option_text': 'Option'}])
        self.assertNotIn('correct', json.dumps(definition))
        self.assertIsNone(material_quiz_definition({'quiz_questions': []}))

    def test_local_quiz_reads_exact_component_and_saved_answers(self):
        item = {'id': 7, 'title': 'Quiz', 'category': 'Quiz'}
        record = {'id': 20, 'passed': True, 'attempt': 2}
        quiz = {'id': 50, 'title': 'Local quiz', 'short_description': None, 'show_correct_answer': False}
        question = {'question_id': 1, 'question_text': 'Question?', 'question_type': 'single_choice',
                    'answer_options': [{'option_id': 4, 'option_text': 'Selected'}, {'option_id': 5, 'option_text': 'Other'}]}
        self.query.side_effect = [[quiz], [{**question, 'answer_options': json.dumps(question['answer_options'])}], [], []]
        parts = self.scope['component_parts'](item, self.owner, record)
        self.assertEqual(len(parts[0]['quiz']['definition']['questions']), 1)
        self.assertIsInstance(parts[0]['quiz']['definition']['questions'][0]['answer_options'], list)
        self.assertIsNone(parts[0]['quiz']['attempt'])
        first_sql, first_params = self.query.call_args_list[0].args
        self.assertEqual(first_params, [20, self.owner['id']])
        self.assertIn('c.id=p.component_ref', first_sql)
        self.assertIn('q.id::text=p.quiz_ref', first_sql)
        self.query.side_effect = [[quiz], [{**question, 'answer_options': json.dumps(question['answer_options'])}], [{'question_ref': 1, 'chosen_answer_ref': 4,
            'is_correct': True, 'selected': [], 'correct': [4]}], []]
        saved = self.scope['component_parts'](item, self.owner, record)[0]['quiz']['attempt']
        self.assertEqual(saved['quiz_body']['questions'][0]['learner_selected_answers'], ['Selected'])
        self.assertEqual(saved['quiz_body']['questions'][0]['correct_answers'], [])
        self.query.side_effect = [[quiz], [{**question, 'answer_options': 'invalid json'}]]
        with self.assertRaises(ServiceError):
            self.scope['component_parts'](item, self.owner, record)
        self.query.side_effect = [[quiz, {**quiz, 'id': 51}], []]
        self.assertEqual(self.scope['component_parts'](item, self.owner, record), [])
        self.query.side_effect = [[], []]
        self.assertEqual(self.scope['component_parts'](item, self.owner, record), [])

    def test_imported_quiz_uses_explicit_quiz_id_and_never_related_file(self):
        item = {'id': 7, 'title': 'Quiz', 'category': 'Quiz'}
        self.query.return_value = [{'id': 100, 'payload': {'quiz_questions': [{'question_text': 'Original question'}]}}]
        self.scope['__package__'] = 'learner_api'
        part = self.scope['source_quiz_parts'](item, self.owner, {'id': 20})[0]
        self.assertIsNone(part['url'])
        self.assertEqual(len(part['quiz']['definition']['questions']), 1)
        sql, params = self.query.call_args.args
        self.assertIn("m.payload->>'quiz_id'", sql)
        self.assertEqual(params, [20, self.owner['id'], 20, self.owner['id'], self.owner['id']])
        self.query.return_value *= 2
        self.assertEqual(self.scope['source_quiz_parts'](item, self.owner, {'id': 20}), [])

    def setUp(self):
        self.query = Mock()
        self.scope = adapter(self.query)
        self.owner = {'id': 510, 'enrolment_id': 271, 'aptem_id': 3582, 'programme_id': 'PROG-ME-L4', 'name': 'Synthetic learner',
                      'account_record_id': 271, 'email': 'learner@example.test',
                      'account_email': 'learner@example.test', 'account_aptem_id': '3582'}

    def test_training_facts_keep_authoritative_hours_completion_and_lineage(self):
        entry = {'id': 1, 'learner_id': 510, 'actual_basis': 'staff:module-progress',
                 'actual_seconds': 1800, 'accepted': True, 'module_ref': 'M1',
                 'feed_kind': 'attendance_confirmation', 'source_payload': {
                     'original_source_ref': 'la:20:30',
                     'course_display_placement': {'course_id': 20, 'section': 'introduction'}}}
        self.query.return_value = [{'payload': entry, 'ksbs': ['K1'],
                                    'segments': [{'id': 2}], 'sources': [],
                                    'historical_components': []}]
        compact = self.scope['entries_for'](self.owner, training_summary=True)
        compact_sql, params = self.query.call_args.args
        self.assertEqual(params, [self.owner['id']])
        self.assertEqual(compact[0]['actual_seconds'], 1800)
        self.assertEqual(compact[0]['actual_basis'], 'staff:module-progress')
        self.assertTrue(self.scope['counts_as_completed'](compact[0]))
        self.assertEqual(compact[0]['ksbs'], ['K1'])
        self.assertEqual(compact[0]['source_payload'], entry['source_payload'])
        self.assertNotIn('SELECT progress.*', compact_sql)
        self.assertIn('progress.declared_completed_at', compact_sql)
        self.assertNotIn('to_jsonb(s) ORDER BY s.segment_order', compact_sql)
        self.assertNotIn('to_jsonb(h) ORDER BY h.id', compact_sql)
        self.assertIn('course_display_placement', compact_sql)
        self.assertIn('progress.feed_kind', compact_sql)
        legacy = self.scope['entries_for'](self.owner)
        legacy_sql, _ = self.query.call_args.args
        self.assertIn('SELECT progress.*', legacy_sql)
        self.assertIn('to_jsonb(h) ORDER BY h.id', legacy_sql)
        self.assertEqual(compact, legacy)

    def test_selected_catalogue_filters_owned_courses_before_activity_read(self):
        self.query.return_value = []
        self.scope['source_subjects'](271, lambda items: {'activities': items},
            owner=self.owner, records=[], include_totals=False,
            course_ids=[20], module_ids=['M1'])
        sql, params = self.query.call_args.args
        self.assertEqual(params, [510, ['20'], ['M1']])
        self.assertIn('m.learner_id=%s', sql)
        self.assertIn('c.source_course_ref=ANY(%s)', sql)
        self.assertIn('c.curriculum_module_ref=ANY(%s)', sql)
        self.assertEqual(self.query.call_count, 1)


    def test_current_completion_cannot_replace_ledger_hours_or_add_submissions(self):
        stored = [
            {'id': 1, 'accepted': True, 'actual_seconds': 1200, 'reporting_month': '2026-08', 'ksbs': []},
            {'id': 2, 'accepted': False, 'actual_seconds': None, 'reporting_month': '2026-09', 'ksbs': []},
            {'id': 3, 'accepted': True, 'actual_seconds': 1800, 'reporting_month': None, 'ksbs': []},
        ]
        current = [
            {**stored[0], 'actual_seconds': 9900, 'reporting_month': '2026-10', 'accepted': False,
             'completed': True, 'achieved_score': 80, 'total_score': 100},
            {**stored[1], 'actual_seconds': 3600, 'accepted': True, 'completed': True},
            {'id': 'reflection:4', 'accepted': True, 'actual_seconds': 7200, 'ksbs': []},
        ]
        result = self.scope['progress_records_with_completion'](stored, current)
        self.assertEqual([r['id'] for r in result], [1, 2, 3])
        self.assertEqual([r['actual_seconds'] for r in result], [1200, None, 1800])
        self.assertEqual([r['accepted'] for r in result], [True, False, True])
        self.assertEqual([r['reporting_month'] for r in result], ['2026-08', '2026-09', None])
        self.assertTrue(result[0]['completed'])
        self.assertEqual(result[0]['achieved_score'], 80)
        self.assertNotIn('completed', stored[0])
        self.assertEqual(self.scope['metrics_from_records'](result, {})['otjh']['actual'], .8333)

    def test_unsynchronised_direct_save_uses_projected_time_and_decision(self):
        stored = [
            {'id': 1, 'component_link_source': 'direct', 'source_system': '', 'accepted': True,
             'actual_seconds': None, 'reporting_month': '', 'segments': [], 'ksbs': []},
            {'id': 2, 'component_link_source': 'direct', 'source_system': '', 'accepted': True,
             'actual_seconds': None, 'reporting_month': '', 'segments': [], 'ksbs': [],
             'component_type': 'assignment'},
            {'id': 3, 'component_link_source': 'direct', 'source_system': '', 'accepted': True,
             'actual_seconds': 600, 'reporting_month': '2026-09', 'segments': [], 'ksbs': []},
        ]
        current = [
            {**stored[0], 'accepted': True, 'actual_seconds': 1800, 'reporting_month': '2026-10',
             'activity_status': 'Completed'},
            # An assignment awaiting tutor review is submitted, not accepted.
            {**stored[1], 'accepted': False, 'actual_seconds': 3600, 'reporting_month': '2026-10',
             'activity_status': 'Submitted'},
            {**stored[2], 'actual_seconds': 9900, 'reporting_month': '2026-10'},
        ]
        result = self.scope['progress_records_with_completion'](stored, current)
        self.assertEqual([r['actual_seconds'] for r in result], [1800, 3600, 600])
        self.assertEqual([r['accepted'] for r in result], [True, False, True])
        self.assertEqual([r['reporting_month'] for r in result], ['2026-10', '2026-10', '2026-09'])
        self.assertEqual(self.scope['metrics_from_records'](result, {})['otjh']['actual'], .6667)

    def test_extra_activity_is_separate_actual_after_review_without_planned_hours(self):
        from .test_current_learning_no_db import adapter as current_adapter
        merge = current_adapter()['merge_submissions']
        assignment = {'id': 1, 'accepted': True, 'actual_seconds': 3600,
                      'component_ref': 'assignment', 'expected_otjh': 2, 'ksbs': []}
        extra = {'id': 'extra', 'activity_type': 'extra_activity', 'actual_time_hours': '1',
                 'activity_month': '2026-09', 'submitted_at': '2026-10-23T13:00:00Z', 'ksb_codes': []}
        for status, actual in [('draft', 1), ('submitted_for_tutor_review', 1),
                               ('accepted', 2), ('partial', 2), ('referred', 1), ('rejected', 1)]:
            with self.subTest(status=status):
                projected = merge([assignment], [{**extra, 'status': status}])
                records = self.scope['progress_records_with_completion']([assignment], projected)
                metrics = self.scope['metrics_from_records'](records, {'2026-09': 2})
                hours = metrics['otjh']
                self.assertEqual(hours['actual'], actual)
                self.assertEqual(hours['planned'], 2)
                self.assertEqual(assignment['actual_seconds'], 3600)
                self.assertEqual(metrics['programme']['total'], 1)
                if status == 'accepted':
                    self.assertEqual(records[-1]['reporting_month'], '2026-09')
                    self.assertEqual(records[-1]['expected_otjh'], 0)

    def test_single_reader_retains_distinct_accepted_rows_sharing_a_source_key(self):
        first = {'id': 1, 'canonical_activity_key': 'shared', 'accepted': True,
                 'actual_seconds': 1800, 'reporting_month': '2026-08'}
        second = {**first, 'id': 2, 'actual_seconds': 3600}
        self.query.return_value = [{'payload': r, 'ksbs': []} for r in (first, second)]
        self.scope['current_records'] = lambda owner, loaded: [
            {**loaded[0], 'actual_seconds': 99999},
            {'id': 'reflection:3', 'accepted': True, 'actual_seconds': 7200},
        ]
        result = self.scope['entries_for'](self.owner)
        self.assertEqual([r['id'] for r in result], [1, 2])
        self.assertEqual(self.scope['metrics_from_records'](result, {})['otjh']['actual'], 1.5)
        sql, params = self.query.call_args.args
        self.assertEqual(params, [510])
        self.assertIn('progress.deleted_at IS NULL', sql)
        self.assertNotIn('row_number()', sql)

    def test_bulk_reader_uses_stored_seconds_despite_segments_and_current_saves(self):
        self.query.side_effect = [
            [self.owner],
            [{'owner_id': 510, 'id': 1, 'accepted': True, 'actual_seconds': 3600,
              'reporting_month': '2026-08', 'source_payload': {}}],
            [],
            [{'progress_id': 1, 'payload': {'id': 10, 'actual_seconds': 9000, 'reporting_month': '2026-09'}}],
            [], [], [],
        ]
        self.scope['current_records_bulk'] = lambda owners, records: {
            271: [{**records[510][0], 'actual_seconds': 18000, 'reporting_month': '2026-10'},
                  {'id': 'reflection:7', 'accepted': True, 'actual_seconds': 3600, 'ksbs': []}]
        }
        result = self.scope['metrics_bulk']([271])
        self.assertEqual(result[271]['otjh']['actual'], 1)
        self.assertEqual(result[271]['programme']['total'], 1)
        sql, params = self.query.call_args_list[1].args
        self.assertEqual(params, [[510]])
        self.assertIn('p.deleted_at IS NULL', sql)
        self.assertNotIn('canonical_rank', sql)

    def test_unlinked_learner_does_not_guess_identity(self):
        self.query.return_value = []
        self.assertIsNone(self.scope['profile'](272))
        self.assertEqual(self.scope['entries'](272), [])
        self.assertEqual(self.scope['activity_rows'](272), [])
        self.assertTrue(all(call.args[1] == [272] for call in self.query.call_args_list))

    def test_metrics_fail_closed_when_the_ssot_identity_is_missing(self):
        self.query.return_value = []
        with self.assertRaises(ServiceError) as error:
            self.scope['metrics'](272)
        self.assertEqual(error.exception.code, 'ssot_identity_required')
        self.assertEqual(error.exception.status, 409)

    def test_rollout_is_not_limited_to_named_pilot_students(self):
        self.query.return_value = [{**self.owner, 'id': 700, 'enrolment_id': 500}]
        self.assertTrue(self.scope['enabled'](500))

    def test_second_pilot_keeps_identity_entries_and_documents_separate(self):
        owner = {'id': 536, 'enrolment_id': 234, 'aptem_id': 4691,
                 'programme_id': 'PROG-20260907141619067932',
                 'account_record_id': 234, 'email': 'other@example.test',
                 'account_email': 'other@example.test', 'account_aptem_id': '4691'}
        self.query.side_effect = [[owner], [{'payload': {'id': 99, 'kind': 'reading',
            'accepted': True, 'actual_seconds': 3600, 'reporting_month': '2026-08'}, 'ksbs': []}],
            [{'id': 8, 'progress_id': 99, 'display_name': 'Evidence.pdf', 'content_type': 'application/pdf'}]]
        rows = self.scope['activity_rows'](234)
        self.assertEqual(self.query.call_args_list[0].args[1], [234])
        self.assertEqual(self.query.call_args_list[1].args[1], [536])
        self.assertEqual(self.query.call_args_list[2].args[1], [536])
        self.assertEqual(rows[0]['documents'][0]['url'], '/learner_api/monthly-logs/234/canonical-documents/8/')

    def test_metrics_use_final_records_and_accepted_hours_not_source_snapshots(self):
        self.scope['profile'] = Mock(return_value=self.owner)
        self.scope['entries_for'] = Mock(return_value=[
            {'id': 1, 'accepted': True, 'actual_seconds': 1800, 'ksbs': ['K1', 'K1']},
            {'id': 2, 'accepted': False, 'actual_seconds': 7200, 'ksbs': ['K1', 'S1']},
            {'id': 3, 'accepted': True, 'actual_seconds': None, 'ksbs': ['S1']},
        ])
        self.scope['targets_for'] = Mock(return_value={})
        result = self.scope['metrics'](271)
        self.assertEqual(result['programme']['total'], 3)
        self.assertEqual(result['programme']['completed'], 2)
        self.assertEqual(result['programme']['percent'], 66.67)
        self.assertEqual(result['otjh']['completed_actual'], 0.5)
        self.assertIsNone(result['otjh']['planned'])
        self.assertIsNone(result['aptem_planned_total'])
        self.assertEqual(result['ksb']['total'], 4)
        self.assertEqual(result['ksb']['completed'], 2)
        self.scope['targets_for'].return_value = {'2026-07': 12, '2026-08': 15}
        self.assertEqual(self.scope['metrics'](271)['otjh']['planned'], 27)

    def test_source_lineage_does_not_discard_an_accepted_canonical_row(self):
        self.scope['profile'] = Mock(return_value=self.owner)
        self.scope['entries_for'] = Mock(return_value=[
            {'id': 1, 'source_system': 'old_lms', 'accepted': True, 'actual_seconds': 10800, 'ksbs': []},
            {'id': 2, 'source_system': 'journal', 'accepted': True, 'actual_seconds': 1800, 'ksbs': []},
        ])
        self.scope['targets_for'] = Mock(return_value={})
        result = self.scope['metrics'](271)
        self.assertEqual(result['otjh']['actual'], 3.5)
        self.assertEqual(result['programme']['historicalCompleted'], 2)

        self.scope['entries_for'] = Mock(return_value=[
            {'id': 1, 'source_system': 'old_lms', 'accepted': True, 'actual_seconds': 10800,
             'reporting_month': '2026-08', 'source_payload': {}, 'ksbs': []},
        ])
        self.query.return_value = []
        row = self.scope['rows_for'](self.owner)[0]
        self.assertTrue(row['accepted'])  # preserve the stored decision for the detail view
        self.assertEqual(row['source_system'], 'old_lms')

    def test_progress_month_and_seconds_remain_authoritative_with_segments(self):
        entry = {'id': 1, 'accepted': True, 'actual_seconds': 7200, 'ksbs': ['K1'],
                 'reporting_month': '2026-09',
                 'segments': [{'id': 10, 'actual_seconds': 1800, 'reporting_month': '2026-07'},
                              {'id': 11, 'actual_seconds': 3600, 'reporting_month': '2026-08'}]}
        self.scope['profile'] = Mock(return_value=self.owner)
        self.scope['entries_for'] = Mock(return_value=[entry])
        self.scope['targets_for'] = Mock(return_value={})
        result = self.scope['metrics'](271)
        self.assertEqual(result['programme']['total'], 1)
        self.assertEqual(result['otjh']['actual'], 2)
        self.scope['entries_for'] = Mock(return_value=[entry])
        self.query.return_value = [{'id': 9, 'progress_id': 1, 'display_name': 'Evidence.pdf', 'content_type': 'application/pdf'}]
        rows = self.scope['rows_for'](self.owner)
        self.assertEqual([r['reporting_month'] for r in rows], ['2026-09'])
        self.assertEqual([r['actual_hours'] for r in rows], [2])
        self.assertEqual(rows[0]['progress_id'], 1)
        self.assertTrue(all(len(r['documents']) == 1 for r in rows))

    def test_typed_course_lineage_takes_precedence_over_legacy_payload(self):
        records = [{'id': 1, 'source_system': 'journal', 'actual_seconds': 3600,
                    'accepted': True, 'ksbs': [], 'source_payload': {'original_source_ref': 'la:50:10'},
                    'sources': [{'source_system': 'old_lms', 'source_course_ref': '51', 'source_activity_id': 'material:10'}]}]
        activities = [{'source_activity_id': 10, 'group_id': group} for group in (50, 51)]
        result = self.scope['overlay_subjects']({'activities': activities}, records, lambda items: {'activities': items})
        self.assertFalse(result['activities'][0]['completed'])
        self.assertTrue(result['activities'][1]['completed'])

    def test_quiz_id_does_not_match_a_material_with_the_same_number(self):
        records = [{'id': 1, 'source_system': 'old_lms', 'actual_seconds': 3600,
                    'accepted': True, 'ksbs': [], 'source_payload': {'component_id': 10},
                    'sources': [{'source_system': 'old_lms', 'source_course_ref': '50', 'source_activity_id': 'quiz:10'}]}]
        result = self.scope['overlay_subjects']({'activities': [{'source_activity_id': 10, 'group_id': 50}]},
                                              records, lambda items: {'activities': items})
        self.assertFalse(result['activities'][0]['completed'])

    def test_source_subjects_use_membership_and_canonical_status_only(self):
        self.scope['profile'] = Mock(return_value=self.owner)
        self.scope['entries_for'] = Mock(return_value=[{
            'id': 20, 'accepted': True, 'actual_seconds': 3600, 'ksbs': [],
            'sources': [{'source_system': 'old_lms', 'source_course_ref': '50', 'source_activity_id': 'material:10'}]}])
        self.scope['targets_for'] = Mock(return_value={'2026-08': 10})
        self.query.side_effect = [[{'id': 3, 'source_course_ref': '50', 'source_course_title': 'Synthetic course'}],
            [{'id': 5, 'source_course_ref': '50', 'source_course_id': 3, 'source_activity_id': 'material:10',
              'source_activity_kind': 'material', 'source_activity_title': 'Reading', 'source_activity_type': 'reading',
              'source_course_title': 'Synthetic course', 'curriculum_component_ref': 'COMP-1',
              'curriculum_module_ref': 'MOD-1'}], []]
        result = self.scope['source_subjects'](271, lambda items: {'activities': items})
        self.assertEqual(result['module_count'], 1)
        self.assertEqual(result['audit_tp_planned'], 10)
        self.assertEqual(result['activities'][0]['actual'], 1)
        self.assertTrue(result['activities'][0]['completed'])
        self.assertEqual(result['activity_sources']['COMP-1']['module_id'], 'MOD-1')
        self.assertIn('membership', self.query.call_args_list[0].args[0])
        self.assertIn('m.learner_id=%s', self.query.call_args_list[0].args[0])
        self.assertEqual(self.query.call_args_list[1].args[1], [[3]])

    def test_missing_account_and_conflicting_aptem_fail_closed(self):
        for changes in ({'account_record_id': None}, {'account_aptem_id': '9000'}):
            self.query.return_value = [{**self.owner, **changes}]
            with self.assertRaises(ServiceError):
                self.scope['profile'](271)

    def test_course_distribution_uses_exact_student_links_including_quizzes(self):
        courses = [{'id': 1, 'source_course_ref': '50', 'source_course_title': 'Course A'},
                   {'id': 2, 'source_course_ref': '60', 'source_course_title': 'Course B'},
                   {'id': 3, 'source_course_ref': '70', 'source_course_title': 'Empty history'}]
        definitions = [{'source_course_ref': c, 'source_activity_id': kind + ':10',
            'source_course_title': c, 'source_activity_title': kind} for c in ('50', '60') for kind in ('material', 'quiz')]
        def record(ident, course, kind, accepted=True):
            return {'id': ident, 'accepted': accepted, 'actual_seconds': 1080, 'ksbs': [],
                'sources': [{'source_system': 'old_lms', 'source_course_ref': course, 'source_activity_id': kind + ':10'}]}
        records = [record(1, '50', 'quiz'), record(2, '60', 'material'), record(3, '60', 'quiz', False),
            {'id': 4, 'accepted': True, 'actual_seconds': 99999, 'ksbs': [],
             'historical_components': [{'source_system': 'old_lms', 'source_course_ref': '50', 'source_activity_id': 'material:10'}]}]
        records[0]['sources'] *= 2
        items, subjects, _ = self.scope['recorded_course_items'](courses, definitions, records)
        self.assertEqual(len(items), 3)
        self.assertEqual([s['id'] for s in subjects], [50, 60])
        self.assertEqual([s['catalogue_count'] for s in subjects], [2, 2])
        self.assertEqual([s['accepted_hours'] for s in subjects], [0.3, 0.3])
        self.assertFalse(items[0]['can_open_material'])
        self.assertTrue(items[1]['can_open_material'])
        self.assertFalse(items[2]['completed'])
        self.assertEqual(len({i['activity_id'] for i in items}), 3)

    def test_duplicate_profiles_fail_closed(self):
        self.query.return_value = [self.owner, self.owner]
        with self.assertRaises(ServiceError):
            self.scope['profile'](271)

    def test_bulk_metrics_use_three_canonical_queries_for_many_learners(self):
        other = {**self.owner, 'id': 511, 'enrolment_id': 272,
                 'email': 'other@example.test', 'account_email': 'other@example.test',
                 'account_record_id': 272, 'aptem_id': 3583, 'account_aptem_id': '3583'}
        self.query.side_effect = [
            [self.owner, other],
            [],
            [{'learner_id': 510, 'report_month': '2026-08', 'target_hours': 12}],
        ]

        result = self.scope['metrics_bulk']([271, 272])

        self.assertEqual(self.query.call_count, 3)
        self.assertEqual(set(result), {271, 272})
        self.assertEqual(result[271]['otjh']['planned'], 12)
        self.assertIsNone(result[272]['otjh']['planned'])
        self.assertIn('l.enrolment_id=ANY(%s)', self.query.call_args_list[0].args[0])
        self.assertIn('p.learner_id=ANY(%s)', self.query.call_args_list[1].args[0])

    def test_bulk_metrics_load_related_progress_in_constant_queries(self):
        progress = {
            'owner_id': 510, 'id': 90, 'kind': 'component', 'component_ref': 'C1',
            'component_link_source': 'direct', 'source_system': 'canonical',
            'accepted': True, 'actual_seconds': 3600, 'passed': None,
            'source_payload': {}, 'submitted_at': None,
        }
        self.query.side_effect = [
            [self.owner],
            [progress],
            [{'progress_id': 90, 'ksb_code': 'K1'}],
            [],
            [],
            [],
            [],
        ]

        result = self.scope['metrics_bulk']([271])

        self.assertEqual(self.query.call_count, 7)
        self.assertEqual(result[271]['programme']['completed'], 1)
        self.assertEqual(result[271]['otjh']['actual'], 1)
        self.assertEqual(result[271]['ksb']['completed'], 1)

    def test_verified_journal_route_precedes_payload_without_repeating_progress(self):
        courses = [{'source_course_ref': '50', 'source_course_title': 'Course A'}]
        definitions = [{'source_course_ref': '50', 'source_activity_id': 'material:10',
            'source_course_title': 'Course A', 'source_activity_title': 'Reading'}]
        route = {'group_id': 50, 'activity_id': 10, 'source_ref': 'la:50:10'}
        record = {'id': 1, 'accepted': True, 'actual_seconds': 120,
            'source_payload': {'original_source_ref': 'la:99:10'}, 'journal_routes': [route, route]}
        items, _, _ = self.scope['recorded_course_items'](courses, definitions, [record])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['actual'], 120 / 3600)
        record['journal_routes'] = [route, {**route, 'activity_id': 11, 'source_ref': 'la:50:11'}]
        record['source_payload']['original_source_ref'] = 'la:50:10'
        merged, _, _ = self.scope['recorded_course_items'](courses, definitions, [record])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]['actual'], 120 / 3600)
        for bad in ({**route, 'group_id': 99}, {**route, 'source_ref': 'att:50:10'},
                    {**route, 'activity_id': None}):
            record['journal_routes'] = [route, bad]
            record['source_payload']['original_source_ref'] = 'la:50:10'
            self.assertEqual(self.scope['recorded_course_items'](courses, definitions, [record])[0], [])

    def test_journal_payload_routes_only_to_owned_material_and_preserves_hours(self):
        courses = [{'source_course_ref': '50', 'source_course_title': 'Course A'},
                   {'source_course_ref': '60', 'source_course_title': 'Course B'}]
        definitions = [{'source_course_ref': c, 'source_activity_id': 'material:10',
            'source_course_title': c, 'source_activity_title': 'Reading'} for c in ('50', '60')]
        records = [{'id': 1, 'source_system': 'journal', 'accepted': True,
            'actual_seconds': 120, 'source_payload': {'original_source_ref': 'la:50:10'}}]
        items, _, _ = self.scope['recorded_course_items'](courses, definitions, records)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['group_id'], 50)
        self.assertEqual(items[0]['actual'], 120 / 3600)
        for ref in (None, 42, '', 'la:99:10', 'la:50:999', 'quiz:50:10', 'att:50:10'):
            records[0]['source_payload']['original_source_ref'] = ref
            self.assertEqual(self.scope['recorded_course_items'](courses, definitions, records)[0], [])

    def test_direct_route_precedes_conflicting_journal_payload(self):
        courses = [{'source_course_ref': '50', 'source_course_title': 'Course A'}]
        definitions = [{'source_course_ref': '50', 'source_activity_id': 'material:10',
            'source_course_title': 'Course A', 'source_activity_title': 'Reading'}]
        record = {'id': 1, 'accepted': True, 'actual_seconds': 120,
            'source_payload': {'original_source_ref': 'la:50:10'},
            'sources': [{'source_system': 'old_lms', 'source_course_ref': '99', 'source_activity_id': 'material:10'}]}
        self.assertEqual(self.scope['recorded_course_items'](courses, definitions, [record])[0], [])
        record['sources'][0].update(source_course_ref='50', source_activity_id='quiz:10')
        self.assertEqual(self.scope['recorded_course_items'](courses, definitions, [record])[0], [])

    def test_monthly_scope_checks_owner_before_reading_canonical_identity(self):
        canonical = SimpleNamespace(require_profile=Mock(return_value=self.owner))
        scope = dict(canonical=canonical, old=SimpleNamespace(ServiceError=ServiceError))
        functions('monthly_logs.py', scope, {'scope'})
        request = SimpleNamespace(login_account=SimpleNamespace(role='learner', is_active=True,
            subject_type='learner', subject_id=99))
        with self.assertRaises(ServiceError) as error:
            scope['scope'](request, 271)
        self.assertEqual(error.exception.status, 404)
        canonical.require_profile.assert_not_called()

    def test_monthly_scope_allows_owner_and_rejects_unassigned_coach(self):
        owner = {**self.owner, 'programme': 'Synthetic programme', 'coach_email': 'coach@example.test'}
        old = SimpleNamespace(ServiceError=ServiceError, normalize=lambda v: str(v or '').strip().lower(),
                              coach_actor=lambda _: {'role': 'coach', 'email': 'other@example.test'})
        scope = dict(canonical=SimpleNamespace(require_profile=lambda _: owner), old=old)
        functions('monthly_logs.py', scope, {'scope'})
        request = SimpleNamespace(GET={}, method='GET', login_account=SimpleNamespace(
            role='learner', is_active=True, subject_type='learner', subject_id=271, email='learner@example.test'))
        with patch.dict(sys.modules, {'coach_api.auth': SimpleNamespace(_requested_view_as_email=lambda _: None)}):
            learner, role = scope['scope'](request, 271)
        self.assertEqual(learner['id'], 271)
        self.assertEqual(learner['_profile']['id'], 510)
        self.assertEqual(role, 'learner')
        request.login_account.role = 'staff'
        with self.assertRaises(ServiceError) as error:
            scope['scope'](request, 271)
        self.assertEqual(error.exception.status, 404)

    def test_identity_mismatch_fails_closed(self):
        self.query.return_value = [{**self.owner, 'account_email': 'different@example.test'}]
        with self.assertRaises(ServiceError):
            self.scope['profile'](271)
        self.assertEqual(self.query.call_args.args[1], [271])

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
        self.assertIn('progress.deleted_at IS NULL', sql)
        self.assertNotIn('row_number()', sql)
        self.assertNotIn('canonical_rank=1', sql)
        self.assertIn('progress_ksbs AS', sql)
        self.assertIn('reporting_segments AS', sql)
        self.assertIn('activity_sources AS', sql)
        self.assertIn('journal_routes AS', sql)
        self.assertNotIn('coalesce((SELECT', sql)
        self.assertEqual(params, [510])
        self.assertIn('s.canonical_progress_id=p.id', sql)

    def test_otjh_activity_log_uses_accepted_progress_seconds_and_keeps_ksbs(self):
        records = [{
            'id': 7, 'kind': 'component', 'component_ref': 'COMP-7',
            'component_title': 'Reading', 'component_type': 'reading',
            'accepted': True, 'actual_seconds': 10800, 'expected_otjh': 2,
            'reporting_started_at': '2026-09-02T09:00:00Z',
            'ksbs': ['K1'], 'segments': [
                {'id': 70, 'actual_seconds': 1800, 'reporting_started_at': '2026-08-01T09:00:00Z'},
                {'id': 71, 'actual_seconds': 3600, 'reporting_started_at': '2026-09-01T09:00:00Z'},
            ],
        }, {'id': 8, 'accepted': False, 'actual_seconds': 7200, 'ksbs': []}]
        rows = self.scope['otjh_activities'](records)
        self.assertEqual([row['actualSeconds'] for row in rows], [10800])
        self.assertEqual(rows[0]['id'], '7:0')
        self.assertEqual(rows[0]['expectedOtjh'], 2)
        self.assertEqual(rows[0]['submittedAt'], '2026-09-02T10:00:00+01:00')
        self.assertEqual(rows[0]['ksbs'], ['K1'])

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
        functions('monthly_logs.py', scope, {'canonical_document', 'canonical_document_response'})
        with self.assertRaises(ServiceError):
            scope['canonical_document'](object(), 271, 999)
        sql, params = query.call_args.args
        self.assertIn('p.learner_id=d.learner_id', sql)
        self.assertIn('d.deleted_at IS NULL', sql)
        self.assertEqual(params, [999, 510])

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
        functions('monthly_logs.py', scope, {'_canonical_signature_scope', 'sign'})
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


class ImportedQuizProjectionTests(unittest.TestCase):
    """Model two-key JSONB projection; real PostgreSQL semantics need integration proof."""

    ORIGINAL_SOURCE = (
        'def source_quiz_parts(item, owner, record):\n'
        '    """Resolve imported quiz definitions by stored quiz ID within an owned course."""\n'
        '    if record is None:\n'
        '        return []\n'
        "    rows = query('''WITH routes AS (\n"
        '        SELECT a.source_course_id,a.source_activity_id\n'
        '        FROM "Learner".learner_activity_sources s\n'
        '        JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id\n'
        "          AND a.source_activity_kind='quiz' AND a.source_system='old_lms' AND a.deleted_at IS NULL\n"
        '        WHERE s.canonical_progress_id=%s AND s.learner_id=%s AND s.deleted_at IS NULL\n'
        '        UNION\n'
        '        SELECT c.id,a.source_activity_id\n'
        '        FROM "Learner".learner_journal_rows j\n'
        '        JOIN "Learner".learner_activity_sources s ON s.id=j.source_id\n'
        '          AND s.canonical_progress_id=j.progress_id AND s.learner_id=j.canonical_learner_id AND s.deleted_at IS NULL\n'
        '        JOIN curriculum.source_courses c ON c.source_course_ref=j.group_id::text\n'
        "          AND c.source_system='old_lms' AND c.deleted_at IS NULL\n"
        '        JOIN curriculum.source_activities a ON a.source_course_id=c.id\n'
        "          AND a.source_activity_id='quiz:'||j.activity_id::text AND a.source_activity_kind='quiz'\n"
        '          AND a.source_system=c.source_system AND a.deleted_at IS NULL\n'
        '        WHERE j.progress_id=%s AND j.canonical_learner_id=%s AND j.deleted_at IS NULL\n'
        "          AND j.source_ref='la:'||j.group_id::text||':'||j.activity_id::text)\n"
        '        SELECT DISTINCT m.id,m.payload\n'
        '        FROM routes r\n'
        '        JOIN "Learner".learner_source_course_memberships member ON member.source_course_id=r.source_course_id\n'
        '          AND member.learner_id=%s AND member.deleted_at IS NULL\n'
        '        JOIN curriculum.source_activities material ON material.source_course_id=r.source_course_id\n'
        "          AND material.source_activity_kind='material' AND material.source_system='old_lms' AND material.deleted_at IS NULL\n"
        '        JOIN curriculum.source_materials m ON m.material_id=material.source_material_id\n'
        '          AND m.source_system=material.source_system AND m.deleted_at IS NULL\n'
        "          AND 'quiz:'||(m.payload->>'quiz_id')=r.source_activity_id''',\n"
        "        [record['id'], owner['id'], record['id'], owner['id'], owner['id']])\n"
        '    if len(rows) != 1:\n'
        '        return []\n'
        '    from .source_material_content import material_quiz_definition\n'
        "    definition = material_quiz_definition(rows[0]['payload'])\n"
        '    if not definition:\n'
        '        return []\n'
        "    return [{'id': item['id'], 'title': item['title'], 'category': item['category'],\n"
        "             'url': None, 'html': None, 'quiz': {'state': 'unavailable', 'attempt': None,\n"
        "             'answers_available': False, 'definition': definition}}]\n"
    )
    ITEM = {'id': 5, 'title': 'Imported quiz', 'category': 'quiz'}
    OWNER = {'id': 70}
    RECORD = {'id': 20}

    def reader(self, query, *, original=False):
        scope = {'query': query, '__package__': 'learner_api'}
        if original:
            exec(compile(self.ORIGINAL_SOURCE, '<frozen pre-projection reader>', 'exec'), scope)
        else:
            functions('canonical_learning.py', scope, {'source_quiz_parts'})
        return scope['source_quiz_parts']

    def read_payload(self, payload, *, original=False):
        # This is a Python model of the approved two-key projection, not a SQL engine.
        # Only object roots are eligible for the unchanged quiz_id route predicate.
        transferred = payload if original else {key: payload.get(key) for key in ('quiz', 'quiz_questions')}
        query = Mock(return_value=[{'id': 100, 'payload': transferred}])
        result = self.reader(query, original=original)(self.ITEM, self.OWNER, self.RECORD)
        query.assert_called_once()
        self.assertEqual(query.call_args.args[1], [20, 70, 20, 70, 70])
        return result

    def test_only_the_approved_sql_projection_changes(self):
        old = ast.parse(self.ORIGINAL_SOURCE).body[0]
        current = next(node for node in ast.parse((ROOT / 'canonical_learning.py').read_text(encoding='utf-8')).body
                       if isinstance(node, ast.FunctionDef) and node.name == 'source_quiz_parts')
        old_sql = next(node.value for node in ast.walk(old)
                       if isinstance(node, ast.Constant) and isinstance(node.value, str) and 'WITH routes' in node.value)
        sql_node = next(node for node in ast.walk(current)
                        if isinstance(node, ast.Constant) and isinstance(node.value, str) and 'WITH routes' in node.value)
        projection = ("SELECT DISTINCT m.id,\n"
                      "            jsonb_build_object('quiz', m.payload->'quiz',\n"
                      "                               'quiz_questions', m.payload->'quiz_questions') AS payload")
        self.assertEqual(sql_node.value, old_sql.replace('SELECT DISTINCT m.id,m.payload', projection, 1))
        self.assertEqual(sql_node.value.count('jsonb_build_object'), 1)
        self.assertIn("'quiz:'||(m.payload->>'quiz_id')=r.source_activity_id", sql_node.value)
        sql_node.value = old_sql
        self.assertEqual(ast.dump(current, include_attributes=False), ast.dump(old, include_attributes=False))

    def test_nested_questions_keep_the_exact_public_contract_and_hide_solutions(self):
        payload = {'quiz': {'questions': [{'question_id': 9, 'question_order': 4,
                   'question_body': 'Question \u00df?', 'correct_answer': 'SECRET',
                   'options': [{'option_body': 'Choice', 'is_correct': True}]}]},
                   'quiz_questions': [{'question_text': 'Must not win'}], 'html': 'Unused'}
        expected = [{'id': 5, 'title': 'Imported quiz', 'category': 'quiz', 'url': None, 'html': None,
                     'quiz': {'state': 'unavailable', 'attempt': None, 'answers_available': False,
                              'definition': {'description': None, 'questions': [{'question_id': 9,
                               'question_order': 4, 'question_text': 'Question \u00df?',
                               'answer_options': [{'option_text': 'Choice'}]}]}}}]
        for original in (True, False):
            self.assertEqual(self.read_payload(payload, original=original), expected)
        self.assertIn(chr(0xDF), expected[0]['quiz']['definition']['questions'][0]['question_text'])
        self.assertNotIn('SECRET', json.dumps(expected))
        self.assertNotIn('is_correct', json.dumps(expected))

    def test_missing_null_empty_and_encoded_values_match_the_original_parser(self):
        question = {'question_text': 'Fallback', 'answer_options': [{'option_text': 'A'}, None]}
        cases = [{}, {'quiz': None}, {'quiz_questions': None}, {'quiz': {}}, {'quiz': []},
                 {'quiz': {'questions': []}}, {'quiz_questions': {}}, {'quiz_questions': 'null'},
                 {'quiz': json.dumps({'questions': [question]})},
                 {'quiz_questions': json.dumps([question])}, {'quiz_questions': [question]},
                 {'quiz': {'questions': []}, 'quiz_questions': [question]},
                 {'quiz': {'questions': None}, 'quiz_questions': [question]},
                 {'quiz': {'questions': [None, {}, question]}},
                 {'quiz_questions': [{'question_text': 'Q', 'options': 'invalid'}]}]
        for payload in cases:
            with self.subTest(payload=payload):
                old = self.read_payload(payload, original=True)
                current = self.read_payload(payload)
                self.assertEqual(current, old)
                if not old:
                    self.assertEqual(current, [])
        part = self.read_payload({'quiz_questions': [question]})[0]
        self.assertEqual(part['quiz']['definition']['questions'], [
            {'question_id': 1, 'question_order': 1, 'question_text': 'Fallback',
             'answer_options': [{'option_text': 'A'}]}])
        self.assertEqual(self.read_payload({'quiz_questions': [{'question_text': 'Q', 'options': 'invalid'}]})
                         [0]['quiz']['definition']['questions'][0]['answer_options'], [])

    def test_invalid_nested_json_preserves_exception_type_and_message(self):
        for payload in ({'quiz': '{'}, {'quiz_questions': '['}, {'quiz': {'questions': '['}}):
            with self.subTest(payload=payload):
                with self.assertRaises(json.JSONDecodeError) as old:
                    self.read_payload(payload, original=True)
                with self.assertRaises(json.JSONDecodeError) as current:
                    self.read_payload(payload)
                self.assertEqual(type(current.exception), type(old.exception))
                self.assertEqual(str(current.exception), str(old.exception))

    def test_no_record_and_missing_or_ambiguous_material_keep_cardinality_checks(self):
        payload = {'quiz_questions': [{'question_text': 'Same quiz'}]}
        for original in (True, False):
            query = Mock()
            self.assertEqual(self.reader(query, original=original)(self.ITEM, self.OWNER, None), [])
            query.assert_not_called()
            for rows in ([], [{'id': 100, 'payload': payload}, {'id': 101, 'payload': payload}]):
                query = Mock(return_value=rows)
                self.assertEqual(self.reader(query, original=original)(self.ITEM, self.OWNER, self.RECORD), [])
                query.assert_called_once()
        # DISTINCT routing itself remains a PostgreSQL integration requirement.

    def test_owner_parameters_and_query_errors_remain_scoped(self):
        for original in (True, False):
            for owner_id in (70, 71):
                query = Mock(return_value=[])
                self.reader(query, original=original)(self.ITEM, {'id': owner_id}, self.RECORD)
                query.assert_called_once()
                self.assertEqual(query.call_args.args[1], [20, owner_id, 20, owner_id, owner_id])
            error = ServiceError('Synthetic query failure', 'query_failure', 503)
            query = Mock(side_effect=error)
            with self.assertRaises(ServiceError) as caught:
                self.reader(query, original=original)(self.ITEM, self.OWNER, self.RECORD)
            self.assertIs(caught.exception, error)
            self.assertEqual((caught.exception.code, caught.exception.status), ('query_failure', 503))
            query.assert_called_once()

    def test_unrelated_large_payload_does_not_change_response_or_query_count(self):
        question = {'question_text': 'Question \u00df?', 'correct_answer': 'secret',
                    'options': [{'option_body': 'A', 'is_correct': True}]}
        for count in (1, 50):
            payload = {'quiz_id': 9, 'quiz_questions': [question] * count,
                       'html': 'x' * 102400, 'metadata': {'unused': 'y' * 10240}}
            projected = {key: payload.get(key) for key in ('quiz', 'quiz_questions')}
            old = self.read_payload(payload, original=True)
            current = self.read_payload(payload)
            self.assertEqual(current, old)
            self.assertEqual(json.dumps(current, ensure_ascii=False).encode('utf-8'),
                             json.dumps(old, ensure_ascii=False).encode('utf-8'))
            self.assertEqual(len(current[0]['quiz']['definition']['questions']), count)
            self.assertLess(len(json.dumps(projected)), len(json.dumps(payload)))
            self.assertNotIn('secret', json.dumps(current))
        # Serialized fixture sizes are not database wire or request latency measurements.

    def test_existing_content_precedence_and_escaped_notes_are_unchanged(self):
        for material, component, imported, selected in (([{'id': 1}], [], [], 1),
                ([], [{'id': 2}], [], 2), ([], [], [{'id': 3}], 3)):
            scope = {'material_parts': Mock(return_value=material),
                     'component_parts': Mock(return_value=component),
                     'source_quiz_parts': Mock(return_value=imported), 'escape': escape}
            functions('canonical_learning.py', scope, {'content'})
            result = scope['content']({**self.ITEM, 'completion_note': '<note>'}, self.OWNER, self.RECORD)
            self.assertEqual(result['parts'][0]['id'], selected)
            self.assertEqual(result['parts'][-1]['html'], '<p>&lt;note&gt;</p>')
            self.assertEqual(scope['component_parts'].call_count, int(selected != 1))
            self.assertEqual(scope['source_quiz_parts'].call_count, int(selected == 3))


class PreviewDocumentLoadingTests(unittest.TestCase):
    def setUp(self):
        self.owner = {'id': 70, 'enrolment_id': 7}
        self.record = {'id': 20, 'kind': 'reading', 'component_title': 'Reading',
                       'actual_seconds': 60, 'accepted': True, 'ksbs': [],
                       'reporting_month': '2026-08', 'reporting_started_at': '2026-08-01T12:00:00+00:00',
                       'source_payload': {}, 'sources': [{'source_system': 'old_lms',
                       'source_course_ref': '50', 'source_activity_id': 'material:10'}]}
        self.document = {'id': 1, 'progress_id': 20, 'display_name': 'Synthetic evidence',
                         'content_type': 'application/pdf'}
        self.query = Mock()
        self.scope = adapter(self.query)
        self.scope['entries_for'] = Mock(return_value=[self.record])
        self.row_id = self.scope['stable_id']('canonical:20')

    def test_default_and_explicit_true_keep_report_document_loading(self):
        for records in ([self.record], []):
            for count in (0, 1, 10):
                with self.subTest(records=len(records), documents=count):
                    documents = [{**self.document, 'id': index + 1} for index in range(count)]
                    self.query.return_value = documents
                    default = self.scope['rows_for'](self.owner, records)
                    self.query.assert_called_with(
                        'SELECT id,progress_id,display_name,content_type\n'
                        '        FROM "Learner".learner_activity_documents\n'
                        '        WHERE learner_id=%s AND deleted_at IS NULL ORDER BY id', [70])
                    explicit = self.scope['rows_for'](self.owner, records, include_documents=True)
                    self.assertEqual(default, explicit)
                    self.assertEqual(self.query.call_count, 2)
                    if records:
                        self.assertEqual(default[0]['documents'], [
                            {'id': index + 1, 'display_name': 'Synthetic evidence',
                             'content_type': 'application/pdf',
                             'url': f'/learner_api/monthly-logs/7/canonical-documents/{index + 1}/'}
                            for index in range(count)])
                    else:
                        self.assertEqual(default, [])
                    self.query.reset_mock()

    def test_opt_out_has_zero_document_dispatches_and_identical_other_fields(self):
        for records in ([self.record], []):
            for count in (0, 1, 1000):
                with self.subTest(records=len(records), documents=count):
                    self.query.return_value = [self.document] * count
                    default = self.scope['rows_for'](self.owner, records)
                    self.query.reset_mock()
                    self.query.side_effect = AssertionError('Opt-out must not dispatch document SQL')
                    preview = self.scope['rows_for'](self.owner, records, include_documents=False)
                    self.query.assert_not_called()
                    self.assertEqual(preview, [{**row, 'documents': []} for row in default])
                    self.query.side_effect = None
        self.scope['rows_for'](self.owner, include_documents=False)
        self.scope['entries_for'].assert_called_once_with(self.owner)
        self.query.assert_not_called()

    def test_content_row_preserves_population_record_identity_and_missing_activity_errors(self):
        sibling = {**self.record, 'id': 21, 'reporting_month': '2026-07'}
        self.scope['entries_for'].return_value = [sibling, self.record]
        self.query.side_effect = AssertionError('Preview document lookup forbidden')
        row, record = self.scope['content_row'](self.owner, '2026-08', self.row_id)
        self.scope['entries_for'].assert_called_once_with(self.owner)
        self.assertIs(record, self.record)
        self.assertEqual(row['documents'], [])
        self.assertEqual(row['progress_id'], 20)
        for month, ident in (('2026-07', self.row_id), ('2026-08', -1)):
            with self.subTest(month=month, row=ident), self.assertRaises(ServiceError) as caught:
                self.scope['content_row'](self.owner, month, ident)
            self.assertEqual((str(caught.exception), caught.exception.code, caught.exception.status),
                             ('Activity not found.', 'not_found', 404))
        self.query.assert_not_called()

    def test_only_the_skipped_document_lookup_failure_is_removed(self):
        error = ServiceError('Synthetic document lookup failure', 'documents', 503)
        self.query.side_effect = error
        with self.assertRaises(ServiceError) as caught:
            self.scope['rows_for'](self.owner, [self.record])
        self.assertIs(caught.exception, error)
        self.query.reset_mock()
        self.assertEqual(len(self.scope['rows_for'](self.owner, [self.record], include_documents=False)), 1)
        self.query.assert_not_called()
        invalid = {key: value for key, value in self.record.items() if key != 'ksbs'}
        with self.assertRaises(KeyError):
            self.scope['rows_for'](self.owner, [invalid], include_documents=False)
        ledger_error = ServiceError('Identity needs review', 'identity_review_required', 409)
        self.scope['entries_for'].side_effect = ledger_error
        with self.assertRaises(ServiceError) as caught:
            self.scope['content_row'](self.owner, '2026-08', self.row_id)
        self.assertIs(caught.exception, ledger_error)
        self.query.assert_not_called()

    def test_preview_content_matches_document_hydrated_input_without_extra_queries(self):
        material = {'source_course_ref': '50', 'source_course_title': 'Course',
                    'source_activity_id': 'material:10', 'material_record_id': 100,
                    'material_title': 'Material', 'backup_status': 'available',
                    'material_blob_container': 'private', 'material_blob_name': 'synthetic',
                    'material_blob_content_type': 'application/pdf'}
        def dispatch(sql, params):
            if 'FROM "Learner".learner_activity_documents' in sql:
                self.assertEqual(params, [70])
                return [self.document] * 1000
            if 'FROM "Learner".learner_source_course_memberships' in sql:
                self.assertEqual(params, [70])
                return [material]
            self.assertEqual(sql, 'SELECT payload FROM curriculum.source_materials WHERE id=%s AND deleted_at IS NULL')
            self.assertEqual(params, [100])
            return [{'payload': {'text_body': '<p>Reading</p>'}}]
        self.query.side_effect = dispatch
        self.scope['__package__'] = 'learner_api'
        signer = Mock(return_value='https://materials.example/synthetic')
        with patch.dict(sys.modules, {'django.conf': SimpleNamespace(settings=SimpleNamespace()),
                'learner_api.material_storage': SimpleNamespace(read_url=signer)}):
            hydrated = self.scope['rows_for'](self.owner, [self.record])[0]
            before = self.scope['content'](hydrated, self.owner, self.record)
            self.assertEqual(self.query.call_count, 3)
            self.query.reset_mock()
            row, record = self.scope['content_row'](self.owner, '2026-08', self.row_id)
            after = self.scope['content'](row, self.owner, record)
            self.assertEqual(after, before)
            self.assertEqual(json.dumps(after).encode(), json.dumps(before).encode())
            self.assertEqual(after['parts'][0]['html'], '<p>Reading</p>')
            self.assertEqual(self.query.call_count, 2)
            self.assertFalse(any('learner_activity_documents' in call.args[0]
                                 for call in self.query.call_args_list))

    def test_material_redirect_and_endpoint_failures_stay_protected(self):
        url = 'https://materials.example/synthetic'
        material_parts = Mock(return_value=[{'id': 100, 'url': url}])
        canonical = SimpleNamespace(enabled=Mock(return_value=True),
            content_row=Mock(wraps=self.scope['content_row']), material_parts=material_parts)
        authorized = {'id': 7, '_profile': self.owner}
        endpoint_scope = {'scope': Mock(return_value=(authorized, 'learner')), 'canonical': canonical,
                          'valid_month': Mock(), 'old': SimpleNamespace(ServiceError=ServiceError),
                          'HttpResponseRedirect': lambda value: {'Location': value}}
        functions('monthly_logs.py', endpoint_scope, {'canonical_material', 'material_response'})
        response = endpoint_scope['canonical_material'](None, 7, '2026-08', self.row_id, 100)
        self.assertEqual(response, {'Location': url, 'Cache-Control': 'private, no-store',
                                   'Referrer-Policy': 'no-referrer'})
        self.query.assert_not_called()
        material_parts.reset_mock()
        with self.assertRaises(ServiceError) as missing:
            endpoint_scope['canonical_material'](None, 7, '2026-07', self.row_id, 100)
        self.assertEqual(missing.exception.status, 404)
        material_parts.assert_not_called()
        canonical.content_row.reset_mock()
        for error in (ServiceError('Forbidden', 'forbidden', 403),
                      ServiceError('Identity mismatch', 'identity_review_required', 409)):
            endpoint_scope['scope'].side_effect = error
            with self.assertRaises(ServiceError) as caught:
                endpoint_scope['canonical_material'](None, 7, '2026-08', self.row_id, 100)
            self.assertIs(caught.exception, error)
            canonical.content_row.assert_not_called()
        self.query.assert_not_called()



# Exact pre-extraction functions: test-only compatibility oracles, never production.
_ACTUAL_OTJH_BEFORE = {
    'source_subjects': (
        'def source_subjects(learner_id, summarize, *, owner=None, records=None, overview_only=False, include_totals=True, include_ledger=True,\r\n'
        '                    course_ids=None, module_ids=None):\r\n'
        '    """Owned course catalogue with progress, or a compact recorded overview."""\r\n'
        '    from learner_api.course_catalogue_display import read_export_placements, catalogue_display_context\r\n'
        '    owner = owner if owner is not None else profile(learner_id)\r\n'
        '    if owner is None:\r\n'
        "        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)\r\n"
        "    # Filter membership before loading a selected module's catalogue. Keep the\r\n"
        '    # complete canonical fact set supplied by the caller for lineage/dedupe.\r\n'
        '    courses = owned_source_courses(owner, course_ids=course_ids, module_ids=module_ids)\r\n'
        '    catalogue_columns = ("a.source_activity_id,c.source_course_ref" if overview_only else\r\n'
        "        '''a.id,a.source_course_id,a.source_activity_id,a.source_activity_kind,\r\n"
        '        a.source_activity_title,a.source_activity_type,a.source_section_ref,a.source_section_title,a.curriculum_component_ref,\r\n'
        '        c.source_course_ref,c.source_course_title,c.curriculum_module_ref,a.source_position AS position,\r\n'
        "        jsonb_build_object('quiz_id',a.source_payload->'quiz_id',\r\n"
        "            'activity_id',a.source_payload->'activity_id','parent_activity_id',a.source_payload->'parent_activity_id',\r\n"
        "            'section_title',a.source_payload->'section_title',\r\n"
        "            'section_order',coalesce(a.source_payload->'section_order',a.source_payload#>'{live_catalogue_recovery,section_order}'),\r\n"
        "            'component_order',coalesce(a.source_payload->'component_order',a.source_payload#>'{live_catalogue_recovery,component_order}'),\r\n"
        "            'created_at',a.source_payload->'created_at','created_at_utc',a.source_payload->'created_at_utc') AS source_payload,\r\n"
        '        EXISTS (SELECT 1 FROM curriculum.source_materials m\r\n'
        '            WHERE m.material_id=a.source_material_id AND m.source_system=a.source_system\r\n'
        "              AND m.deleted_at IS NULL) AS material_available''')\r\n"
        "    catalogue = query(f'''SELECT {catalogue_columns}\r\n"
        '        FROM curriculum.source_activities a\r\n'
        '        JOIN curriculum.source_courses c ON c.id=a.source_course_id AND c.deleted_at IS NULL\r\n'
        '        WHERE a.source_course_id=ANY(%s) AND a.deleted_at IS NULL\r\n'
        "          AND a.source_system='old_lms'\r\n"
        "        ORDER BY c.id,a.source_position NULLS LAST,a.id''', [[c['id'] for c in courses]]) if courses else []\r\n"
        '    if not overview_only:\r\n'
        '        catalogue = catalogue_display_context(catalogue, read_export_placements(query, courses))\r\n'
        '    records = entries_for(owner) if records is None else records\r\n'
        '    items, subjects, links = recorded_course_items(courses, catalogue, records,\r\n'
        '        overview_only=overview_only, include_catalogue=not overview_only)\r\n'
        '    if overview_only:\r\n'
        "        return {'progress_basis': 'recorded_activities', 'subjects': subjects,\r\n"
        "                'activities': [{key: item[key] for key in ('activity_id', 'group_id', 'completed')}\r\n"
        '                               for item in items]}\r\n'
        "    result = {'source': 'canonical', 'source_status': 'historical',\r\n"
        "        'progress_basis': 'catalogue_activities',\r\n"
        "        'learner_name': owner['name'], 'aptem_id': owner['aptem_id'],\r\n"
        "        'subjects': subjects, **summarize(items)}\r\n"
        '    if not include_totals:\r\n'
        "        result['activity_sources'] = {key: values[0] for key, values in links.items() if len(values) == 1}\r\n"
        '        return result\r\n'
        '    total = round(sum(recorded_seconds(r) for r in records if counts_as_actual(r)) / 3600, 4)\r\n'
        '    result.update(recorded_otjh_total=total, audit_lms_actual=total,\r\n'
        "        audit_ksb_evidenced=len({k for r in records if counts_as_actual(r) for k in r['ksbs']}),\r\n"
        '        direct_otjh_activities=[])\r\n'
        '    if include_ledger:\r\n'
        "        result['canonical_otjh_activities'] = otjh_activities(records)\r\n"
        "    result['activity_sources'] = {key: values[0] for key, values in links.items() if len(values) == 1}\r\n"
        "    result['activity_source_issues'] = {key: 'ambiguous_lineage' for key, values in links.items() if len(values) != 1}\r\n"
        '    canonical_modules = {\r\n'
        "        str(record.get('module_ref') or record.get('module_title') or '').strip()\r\n"
        '        for record in records\r\n'
        "        if str(record.get('module_ref') or record.get('module_title') or '').strip()\r\n"
        '    }\r\n'
        "    result['module_count'] = max(len(subjects), len(canonical_modules))\r\n"
        "    result['unresolved_source_routes'] = sum(len(values) != 1 for values in links.values())\r\n"
        '    from learner_api import journal_sources\r\n'
        '    if journal_sources.enabled():\r\n'
        "        result['audit_tp_planned'] = programme_planned_hours(learner_id, owner=owner)\r\n"
        '    else:\r\n'
        '        monthly_targets = targets_for(owner)\r\n'
        "        result['audit_tp_planned'] = sum(monthly_targets.values()) if monthly_targets else None\r\n"
        '    from coach_api.migrated_otjh import planned_hours_bulk\r\n'
        "    review_planned = planned_hours_bulk([owner]).get(owner['enrolment_id'], 0)\r\n"
        '    if review_planned:\r\n'
        "        result['review_planned_otjh'] = review_planned\r\n"
        "        if result.get('audit_tp_planned') is not None:\r\n"
        "            result['audit_tp_planned'] += review_planned\r\n"
        '    return result'
    ),
    'metrics_from_records': (
        'def metrics_from_records(records, monthly_targets, *, include_ksb_points=False):\r\n'
        '    """Count final activity records once, using accepted evidence only for hours.\r\n'
        '\r\n'
        '    KSB points retain the shared activity/code definition; they are not a claim\r\n'
        "    that the learner has achieved the entire programme's KSB framework.\r\n"
        '    """\r\n'
        '    # A configured review allowance contributes hours, not a taught activity\r\n'
        '    # or a KSB achievement. Keep programme completion denominators unchanged.\r\n'
        '    records = list(records)\r\n'
        "    counted = [item for item in records if item.get('kind') != 'migrated_review']\r\n"
        "    accepted = [item for item in records if item.get('accepted') is True]\r\n"
        '    completed = [item for item in counted if counts_as_completed(\r\n'
        "        item, include_source_evidence='completed' in item)]\r\n"
        '    ratio = point_ratio\r\n'
        '    codes = {}\r\n'
        '    for item in counted:\r\n'
        "        for code in set(item.get('ksbs') or []):\r\n"
        '            counts = codes.setdefault(code, [0, 0])\r\n'
        "            counts[0] += item.get('accepted') is True\r\n"
        '            counts[1] += 1\r\n'
        '    actual = round(sum(recorded_seconds(item) for item in accepted) / 3600, 4)\r\n'
        '    from learner_api import journal_sources\r\n'
        '    planned = round(sum(monthly_targets.values()), 4) if monthly_targets or journal_sources.enabled() else None\r\n'
        '    result = {\r\n'
        "        'migrated': True, 'aptem_planned_total': planned,\r\n"
        "        'programme': {**ratio(len(completed), len(counted)), 'historicalCompleted': sum(item.get('accepted') is True for item in counted)},\r\n"
        "        'otjh': {'historical': actual, 'new': 0, 'actual': actual,\r\n"
        "                 'completed_actual': actual, 'planned': planned},\r\n"
        "        'ksb': {**ratio(sum(v[0] for v in codes.values()), sum(v[1] for v in codes.values())),\r\n"
        "                'historicalCompleted': sum(v[0] for v in codes.values()),\r\n"
        "                'codes': [{'code': code, **ratio(*counts)} for code, counts in sorted(codes.items())]},\r\n"
        "        '_ksb_evidence_sources': [],\r\n"
        '    }\r\n'
        '    if include_ksb_points:\r\n'
        '        # Expand the very same activity/code pairs counted above. A completion\r\n'
        '        # belongs to this activity, never to every activity sharing its code.\r\n'
        "        result['ksb']['points'] = [\r\n"
        "            {'activityId': str(item['id']), 'code': code,\r\n"
        '             **ksb_point_definition(item, code),\r\n'
        "             'completed': item.get('accepted') is True,\r\n"
        "             'title': item.get('component_title') or None,\r\n"
        "             'type': item.get('component_type') or item.get('kind') or None,\r\n"
        "             'module': item.get('module_title') or None,\r\n"
        "             'status': item.get('activity_status') or None,\r\n"
        "             'source': item.get('source_system') or None,\r\n"
        "             'completedAt': (item.get('submitted_at') or item.get('reporting_ended_at'))\r\n"
        "                 if item.get('accepted') is True else None,\r\n"
        "             'componentId': item.get('component_ref') or None}\r\n"
        "            for item in counted for code in sorted(set(item.get('ksbs') or []))\r\n"
        '        ]\r\n'
        '    return result'
    ),
}


class ActualOtjhAggregationTests(unittest.TestCase):
    # Preserve complete old responses/errors while checking independent outcomes.
    def setUp(self):
        self.query = Mock(side_effect=AssertionError('Aggregation must not query'))
        self.scope = adapter(self.query)
        self.owner = {'id': 510, 'enrolment_id': 271, 'aptem_id': 3582,
                      'name': 'Synthetic learner'}

    def legacy_scope(self, query=None):
        scope = adapter(query if query is not None else self.query)
        for source in _ACTUAL_OTJH_BEFORE.values():
            exec(compile(ast.parse(source), '<captured Actual OTJH adapter>', 'exec'), scope)
        return scope

    def records(self):
        link = {'source_system': 'old_lms', 'source_course_ref': '50',
                'source_activity_id': 'material:10'}
        return [
            {'id': 20, 'kind': 'reading', 'accepted': True, 'actual_seconds': 1800,
             'ksbs': ['K1'], 'sources': [link, dict(link)],
             'segments': [{'actual_seconds': 99999}]},
            {'id': 21, 'kind': 'reading', 'accepted': True, 'actual_seconds': 3600,
             'ksbs': [], 'sources': [dict(link)]},
            {'id': 22, 'kind': 'reading', 'accepted': False, 'actual_seconds': 7200,
             'ksbs': [], 'sources': [dict(link)]},
        ]

    def source_scope(self, legacy=False):
        query = Mock(side_effect=[
            [{'id': 3, 'source_course_ref': '50', 'source_course_title': 'Synthetic course'}],
            [{'id': 5, 'source_course_ref': '50', 'source_course_id': 3,
              'source_activity_id': 'material:10', 'source_activity_kind': 'material',
              'source_activity_title': 'Reading', 'source_activity_type': 'reading',
              'source_course_title': 'Synthetic course',
              'curriculum_component_ref': 'COMP-1', 'curriculum_module_ref': 'MOD-1'}],
            [],
        ])
        scope = self.legacy_scope(query) if legacy else adapter(query)
        scope['targets_for'] = Mock(return_value={'2026-08': 10})
        return scope, query

    def projection(self):
        scope = {'datetime': datetime, 'ZoneInfo': ZoneInfo, 'json': json,
                 'isfinite': math.isfinite, 're': re}
        functions('active_users.py', scope, {
            '_s', '_number', '_reported_minutes', '_progress_text',
            '_selected_timer_seconds', '_manual_claimed_seconds',
            '_progress_record_minutes', 'otjh_progress_dedupe_key',
            'dedupe_otjh_progress_records', '_component_expected_hours_lookup',
            'completed_hours_value_from_progress',
        })
        scope['GRADED_PROGRESS_KINDS'] = frozenset({'quiz'})
        functions('progress_rules.py', scope, {'_kind', 'progress_counts_as_achieved'})
        functions('current_learning.py', scope, {
            'instant', 'actual_time_seconds', 'is_unsynchronised_direct_save',
            'source_payload_metadata', 'source_reference', 'project_current',
        })
        return scope['project_current']

    def direct(self, ident=1, **changes):
        return {'id': ident, 'learner_id': 510, 'kind': 'component',
                'component_ref': 'COMP-1', 'component_type': 'reading',
                'component_link_source': 'direct', 'source_system': '',
                'actual_seconds': None, 'segments': [], 'accepted': True,
                'passed': None, 'submitted_at': '2026-10-01T10:00:00+00:00',
                'time_tracking_source': 'component:timer', 'claimed_seconds': 1800,
                'ksbs': [], **changes}

    def test_strict_acceptance_and_empty_results(self):
        helper = self.scope['actual_otjh_hours']
        self.assertEqual(helper([]), 0.0)
        self.assertIs(type(helper([])), float)
        records = [{'accepted': value, 'actual_seconds': 3600}
                   for value in (False, None, 1, 'true', '', [], {})]
        records += [{'actual_seconds': 3600}, {'accepted': True, 'actual_seconds': 1800}]
        self.assertEqual(helper(records), .5)
        self.query.assert_not_called()

    def test_numeric_coercion_null_zero_and_errors(self):
        helper = self.scope['actual_otjh_hours']
        for value in (None, '', 0, -1, 'invalid', float('nan'), float('inf'),
                      -float('inf'), [], {}):
            with self.subTest(value=value):
                self.assertEqual(helper([{'accepted': True, 'actual_seconds': value}]), 0)
        self.assertEqual(helper([{'accepted': True}]), 0)
        self.assertEqual(helper([{'accepted': True, 'actual_seconds': '3600'}]), 1)
        self.assertEqual(helper([{'accepted': True, 'actual_seconds': True}]), .0003)
        with self.assertRaises(OverflowError):
            helper([{'accepted': True, 'actual_seconds': 10 ** 1000}])
        for value in (None, [None]):
            with self.subTest(malformed=value), self.assertRaises((TypeError, AttributeError)):
                helper(value)
        self.query.assert_not_called()

    def test_rounds_once_after_ordered_sum_and_preserves_input(self):
        records = [{'id': i, 'accepted': True, 'actual_seconds': .2} for i in range(3)]
        before = json.dumps(records, sort_keys=True)
        self.assertEqual(self.scope['actual_otjh_hours'](records), .0002)
        self.assertNotEqual(self.scope['actual_otjh_hours'](records), .0003)
        self.assertEqual(json.dumps(records, sort_keys=True), before)
        seconds = self.scope['recorded_seconds']
        self.scope['recorded_seconds'] = Mock(side_effect=seconds)
        self.scope['actual_otjh_hours'](records)
        self.assertEqual([call.args[0]['id'] for call in self.scope['recorded_seconds'].call_args_list],
                         [0, 1, 2])

    def test_generator_is_consumed_once_without_loading_or_cross_owner_state(self):
        visited = []
        def rows():
            for ident in range(3):
                visited.append(ident)
                yield {'id': ident, 'accepted': True, 'actual_seconds': 1200}
        self.assertEqual(self.scope['actual_otjh_hours'](rows()), 1)
        self.assertEqual(visited, [0, 1, 2])
        self.assertEqual(self.scope['actual_otjh_hours']([
            {'learner_id': 999, 'accepted': True, 'actual_seconds': 7200}]), 2)
        self.assertEqual(self.scope['actual_otjh_hours']([
            {'learner_id': 510, 'accepted': True, 'actual_seconds': 1800}]), .5)
        self.query.assert_not_called()

    def test_full_metrics_response_and_migrated_review_parity(self):
        for points in (False, True):
            records = self.records() + [{'id': 30, 'kind': 'migrated_review',
                                         'accepted': True, 'actual_seconds': 900, 'ksbs': []}]
            original = json.dumps(records, sort_keys=True)
            old = self.legacy_scope()['metrics_from_records'](
                iter(records), {'2026-08': 10}, include_ksb_points=points)
            current = self.scope['metrics_from_records'](
                iter(records), {'2026-08': 10}, include_ksb_points=points)
            self.assertEqual(current, old)
            self.assertEqual(json.dumps(current, sort_keys=True), json.dumps(old, sort_keys=True))
            self.assertEqual(current['otjh'], {'historical': 1.75, 'new': 0,
                'actual': 1.75, 'completed_actual': 1.75, 'planned': 10})
            self.assertEqual(current['programme']['total'], 3)
            self.assertEqual(current['programme']['completed'], 2)
            self.assertEqual('points' in current['ksb'], points)
            self.assertEqual(json.dumps(records, sort_keys=True), original)
        self.query.assert_not_called()

    def test_full_source_response_queries_and_duplicate_lineage_parity(self):
        for ledger in (False, True):
            outputs, calls = [], []
            for legacy in (True, False):
                scope, query = self.source_scope(legacy)
                records = self.records()
                original = json.dumps(records, sort_keys=True)
                outputs.append(scope['source_subjects'](271, lambda items: {'activities': items},
                    owner=self.owner, records=records, include_ledger=ledger))
                calls.append(query.call_args_list)
                self.assertEqual(query.call_count, 3)
                self.assertEqual(json.dumps(records, sort_keys=True), original)
            self.assertEqual(outputs[0], outputs[1])
            self.assertEqual(json.dumps(outputs[0], sort_keys=True), json.dumps(outputs[1], sort_keys=True))
            self.assertEqual(calls[0], calls[1])
            self.assertEqual(calls[1][0].args[1], [510])
            self.assertEqual(outputs[1]['recorded_otjh_total'], 1.5)
            self.assertEqual(outputs[1]['audit_lms_actual'], 1.5)
            self.assertEqual(outputs[1]['subjects'][0]['accepted_hours'], 1.5)
            self.assertEqual(outputs[1]['audit_tp_planned'], 10)
            self.assertEqual('canonical_otjh_activities' in outputs[1], ledger)

    def test_source_early_returns_never_calculate_totals(self):
        for options in ({'overview_only': True}, {'include_totals': False}):
            outputs, calls = [], []
            for legacy in (True, False):
                scope, query = self.source_scope(legacy)
                scope['actual_otjh_hours'] = Mock(side_effect=AssertionError('Early return'))
                outputs.append(scope['source_subjects'](271, lambda items: {'activities': items},
                    owner=self.owner, records=self.records(), **options))
                calls.append(query.call_args_list)
                scope['actual_otjh_hours'].assert_not_called()
            self.assertEqual(outputs[0], outputs[1])
            self.assertEqual(calls[0], calls[1])
            self.assertNotIn('recorded_otjh_total', outputs[1])

    def test_metrics_retains_accepted_materialization_and_delegates_once(self):
        records = self.records()
        helper = self.scope['actual_otjh_hours']
        self.scope['actual_otjh_hours'] = Mock(wraps=helper)
        self.scope['metrics_from_records'](iter(records), {})
        self.scope['actual_otjh_hours'].assert_called_once()
        accepted = self.scope['actual_otjh_hours'].call_args.args[0]
        self.assertIsInstance(accepted, list)
        self.assertEqual([row['id'] for row in accepted], [20, 21])
        self.assertIs(accepted[0], records[0])
        self.query.assert_not_called()

    def test_errors_and_original_exceptions_propagate_without_extra_queries(self):
        for malformed in ([None], [{'accepted': True, 'actual_seconds': 10 ** 1000,
                                    'ksbs': []}]):
            caught = []
            for scope in (self.legacy_scope(), self.scope):
                try:
                    scope['metrics_from_records'](malformed, {})
                except (AttributeError, OverflowError) as error:
                    caught.append((type(error), str(error)))
                else:
                    self.fail('Original error was hidden')
            self.assertEqual(caught[0], caught[1])
        for legacy in (True, False):
            scope, query = self.source_scope(legacy)
            error = ServiceError('Owner denied', 'forbidden', 403)
            scope['profile'] = Mock(side_effect=error)
            scope['actual_otjh_hours'] = Mock(side_effect=AssertionError('Must not calculate'))
            with self.assertRaises(ServiceError) as caught:
                scope['source_subjects'](999, lambda items: {'activities': items})
            self.assertIs(caught.exception, error)
            query.assert_not_called()
            scope['actual_otjh_hours'].assert_not_called()
        self.query.assert_not_called()

    def test_source_query_and_missing_owner_errors_match_original(self):
        for missing in (False, True):
            outcomes = []
            for legacy in (True, False):
                scope, query = self.source_scope(legacy)
                scope['profile'] = Mock(return_value=None if missing else self.owner)
                query.side_effect = RuntimeError('Synthetic query unavailable')
                try:
                    scope['source_subjects'](271, lambda items: {'activities': items})
                except (ServiceError, RuntimeError) as error:
                    outcomes.append((type(error), str(error), getattr(error, 'code', None),
                                     getattr(error, 'status', None), query.call_args_list))
                else:
                    self.fail('Original failure was hidden')
            self.assertEqual(outcomes[0], outcomes[1])
            self.assertEqual(len(outcomes[1][-1]), 0 if missing else 1)

    def test_stored_zero_null_and_segment_authority_precede_aggregation(self):
        records = [self.direct(1, actual_seconds=0),
                   self.direct(2, component_ref='COMP-2'),
                   self.direct(3, component_ref='COMP-3', segments=[{'actual_seconds': 99999}])]
        before = json.dumps(records, sort_keys=True)
        projected = self.projection()(records, {})
        self.assertEqual([row['id'] for row in projected], [1, 3, 2])
        self.assertEqual([row['actual_seconds'] for row in projected], [0, None, 1800])
        self.assertEqual(self.scope['actual_otjh_hours'](projected), .5)
        self.assertEqual(json.dumps(records, sort_keys=True), before)
        self.assertEqual(self.scope['metrics_from_records'](projected, {}),
                         self.legacy_scope()['metrics_from_records'](projected, {}))

    def test_retry_winner_and_quiz_pass_policy_remain_upstream(self):
        records = [self.direct(1, kind='quiz', quiz_ref=5, passed=False, claimed_seconds=7200),
                   self.direct(2, kind='quiz', quiz_ref=5, passed=True, claimed_seconds=1800),
                   self.direct(3, kind='quiz', quiz_ref=5, passed=True, claimed_seconds=3600),
                   self.direct(4, kind='quiz', quiz_ref=6, component_ref='COMP-2',
                               passed=None, claimed_seconds=7200)]
        projected = self.projection()(records, {})
        self.assertEqual([row['id'] for row in projected], [3, 4])
        self.assertEqual([row['accepted'] for row in projected], [True, False])
        self.assertEqual(self.scope['actual_otjh_hours'](projected), 1)
        self.assertEqual(self.scope['metrics_from_records'](projected, {}),
                         self.legacy_scope()['metrics_from_records'](projected, {}))

    def test_assignment_marking_transitions_preserve_partial_credit(self):
        record = self.direct(component_type='assignment')
        for status, expected in [('submitted_for_tutor_review', 0), ('partial', .25),
                                 ('accepted', .25), ('rejected', 0), ('partial', .25)]:
            with self.subTest(status=status):
                projected = self.projection()([record], {'COMP-1': {
                    'status': status, 'actual_time_hours': '.25'}})
                self.assertEqual(projected[0]['actual_seconds'], 900)
                self.assertEqual(self.scope['actual_otjh_hours'](projected), expected)
                self.assertEqual(self.scope['metrics_from_records'](projected, {}),
                                 self.legacy_scope()['metrics_from_records'](projected, {}))
        self.assertIsNone(record['actual_seconds'])

    def test_import_and_staff_correction_suppress_direct_save_duplicates(self):
        for extra in (
            {'id': 10, 'learner_id': 510, 'source_system': 'old_lms', 'accepted': True,
             'actual_seconds': 3600, 'ksbs': [],
             'source_payload': {'original_source_ref': 'progress:1'}},
            {'id': 10, 'learner_id': 510, 'component_ref': 'COMP-1',
             'actual_basis': 'staff:module-progress', 'accepted': True,
             'actual_seconds': 3600, 'ksbs': []},
        ):
            projected = self.projection()([self.direct(), extra], {})
            self.assertEqual([row['id'] for row in projected], [10])
            self.assertEqual(self.scope['actual_otjh_hours'](projected), 1)
            self.assertEqual(self.scope['metrics_from_records'](projected, {}),
                             self.legacy_scope()['metrics_from_records'](projected, {}))

    def test_distinct_stored_rows_are_not_deduplicated_by_aggregation(self):
        records = self.records()
        records[1]['source_payload'] = {'original_source_ref': 'shared'}
        records[0]['source_payload'] = {'original_source_ref': 'shared'}
        self.assertEqual(self.scope['actual_otjh_hours'](records), 1.5)
        self.assertEqual(self.scope['actual_otjh_hours'](records[:1]), .5)
        self.query.assert_not_called()

if __name__ == '__main__':
    unittest.main()
