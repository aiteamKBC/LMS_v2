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
    nodes = [node for node in ast.parse((ROOT / filename).read_text(encoding='utf-8')).body
             if isinstance(node, ast.FunctionDef) and (names is None or node.name in names)]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, 'exec'), scope)


def adapter(query):
    scope = dict(query=query, json=json, math=math, hashlib=hashlib, re=re,
                 datetime=datetime, escape=escape, UK=ZoneInfo('Europe/London'), ServiceError=ServiceError,
                 current_records=lambda owner, records: records,
                 current_records_bulk=lambda owners, records: {
                     owner['enrolment_id']: records.get(owner['id'], []) for owner in owners
                 })
    functions('monthly_log_sources.py', scope, {'decoded', 'number', 'stable_id', 'row'})
    functions('current_learning.py', scope, {'source_payload_metadata'})
    functions('canonical_learning.py', scope)
    return scope


class CanonicalLearningTests(unittest.TestCase):
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
        scope = {'scope': Mock(return_value=({'_profile': self.owner}, 'learner')),
            'valid_month': lambda month: None,
            'canonical': SimpleNamespace(enabled=lambda _: True, content_row=Mock(return_value=(row, {'id': 20})), material_parts=Mock(return_value=parts),
                content=Mock(return_value={'id': 9, 'parts': [dict(parts[0])]})),
            'detail_data': Mock(return_value={'source': 'lms', 'rows': [row]}),
            'old': SimpleNamespace(ServiceError=ServiceError),
            'HttpResponseRedirect': lambda url: {'Location': url}, 'JsonResponse': lambda value: value}
        functions('monthly_logs.py', scope, {'canonical_material', 'content'})
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
        self.scope['rows_for'].assert_called_once_with(self.owner, records)
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
              'curriculum_module_ref': 'MOD-1'}]]
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
        functions('monthly_logs.py', scope, {'canonical_document'})
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


if __name__ == '__main__':
    unittest.main()
