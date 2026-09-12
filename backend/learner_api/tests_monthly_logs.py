"""Journal regressions without database setup, migrations or writes."""
from contextlib import nullcontext
from copy import deepcopy
from datetime import date
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, RequestFactory
from django.core.files.uploadedfile import SimpleUploadedFile

from old_otjh.service import ServiceError
from . import monthly_logs as logs, monthly_log_sources as sources


class MonthlyLogsTests(SimpleTestCase):
    def setUp(self):
        today = patch.object(logs.timezone, 'localdate', return_value=date(2026, 10, 1))
        today.start()
        self.addCleanup(today.stop)
        self.account = SimpleNamespace(id=1, role='learner', subject_type='learner', subject_id=7,
                                       display_name='Learner', email='learner@example.test')
        self.learner = {'id': 7, 'aptem_id': 42, 'name': 'Learner', 'programme': 'Programme',
                        'email': 'learner@example.test', 'coach_email': 'coach@example.test',
                        '_profile': None, '_view_as': False}
        self.row = sources.row('progress:1', '2026-09-12T10:00:00Z', 'Reading', 'Reading', hours=1)

    def request(self, method='get', **data):
        request = getattr(RequestFactory(), method)('/', data=data)
        request.login_account = self.account
        return request

    def test_another_learner_is_rejected_before_reading(self):
        with patch.object(logs.old, 'resolve_authenticated_learner') as resolve:
            with self.assertRaises(ServiceError) as result:
                logs.scope(self.request(), 8)
            self.assertEqual(result.exception.status, 404)
            resolve.assert_not_called()

    def test_coach_is_scoped_to_assigned_learner(self):
        self.account.role = 'staff'
        self.account.subject_type = 'staff'
        with patch.object(logs.old, 'coach_actor', return_value={'role': 'coach', 'email': 'other@example.test'}), \
             patch.object(logs.old, 'resolve_record', return_value=self.learner), \
             patch.object(sources, 'profile', return_value=None):
            with self.assertRaises(ServiceError) as result:
                logs.scope(self.request(), 7)
            self.assertEqual(result.exception.status, 404)

    def test_admin_view_as_cannot_sign(self):
        self.account.role = 'staff'
        with patch.object(logs.old, 'coach_actor', return_value={'role': 'admin', 'email': 'admin@example.test'}), \
             patch.object(logs.old, 'resolve_record', return_value=self.learner), \
             patch.object(sources, 'profile', return_value=None), \
             patch('coach_api.auth._requested_view_as_email', return_value='coach@example.test'):
            with self.assertRaises(ServiceError) as result:
                logs.scope(self.request('post'), 7)
            self.assertEqual(result.exception.status, 403)

    def test_month_appears_from_execution_date_without_copying_old_rows(self):
        old_row = sources.row('progress:2', '2026-08-31T10:00:00Z', 'Old activity', 'Reading', hours=2)
        with patch.object(sources, 'activity_rows', return_value=[self.row, old_row]):
            self.assertEqual(logs.current_months(self.learner), {'2026-09': [self.row]})
            self.assertEqual(set(logs.current_months({**self.learner, 'aptem_id': None})), {'2026-08', '2026-09'})

    def test_signatures_attest_exact_revision_and_coach_can_sign_separately(self):
        signature = {'report_month': '2026-09', 'signer_role': 'learner', 'signer_name': 'Learner',
                     'signed_at': '2026-09-12', 'url': 'data:image/png;base64,signed',
                     'snapshot_hash': logs.old.digest([self.row])}
        state = logs.month_state('2026-09', [self.row], [signature])
        self.assertEqual(state['status'], 'complete')
        self.assertIsNone(state['coach_signature'])
        added = sources.row('progress:2', '2026-09-12', 'Video', 'Video')
        changed = logs.month_state('2026-09', [self.row, added], [signature])
        self.assertEqual(changed['status'], 'complete')
        self.assertEqual(changed['student_signature']['url'], signature['url'])

    def test_old_report_is_returned_with_existing_signatures_and_iframe_rows(self):
        historical = {'month': '2026-08', 'rows': [], 'student_signature': {'file_id': 'saved',
                       'signed_at': '2026-09-01', 'signer_name': 'Learner'}, 'coach_signature': None}
        with patch.object(logs.old, 'month_detail', return_value=historical), patch.object(logs.old, 'start') as start:
            detail = logs.detail_data(self.learner, '2026-08')
        self.assertEqual(detail['student_signature']['url'], '/audit_api/old-otjh/signatures/saved/')
        self.assertEqual(detail['source'], 'legacy')
        start.assert_not_called()

    def test_summary_includes_retained_and_current_months(self):
        retained = {'month': '2026-08', 'status': 'complete', 'student_signature': {'url': 'saved'}}
        with patch.object(logs, 'legacy_summary', return_value={'months': [retained]}), \
             patch.object(logs, 'signatures', return_value=[]), \
             patch.object(logs, 'current_months', return_value={'2026-09': [self.row]}):
            summary = logs.summary_data(self.learner)
        self.assertEqual([m['month'] for m in summary['months']], ['2026-08', '2026-09'])
        self.assertEqual(summary['months'][0]['student_signature']['url'], 'saved')
        self.assertEqual(summary['completed_months'], 1)

    def test_lms_month_appears_only_after_month_end_with_all_its_activities(self):
        last_day = sources.row('progress:2', '2026-09-30', 'End-of-month reflection', 'Assignment')
        future = sources.row('progress:3', '2026-10-01', 'Next month', 'Reading')
        with patch.object(sources, 'activity_rows', return_value=[last_day, self.row, future]):
            with patch.object(logs.timezone, 'localdate', return_value=date(2026, 9, 30)):
                self.assertEqual(logs.current_months(self.learner), {})
            self.assertEqual(logs.current_months(self.learner), {'2026-09': [self.row, last_day]})

    def test_open_month_cannot_be_requested_or_signed_directly(self):
        with patch.object(logs.timezone, 'localdate', return_value=date(2026, 9, 30)), \
             patch.object(sources, 'activity_rows') as activities, \
             patch.object(logs.old_repo, 'query') as query:
            with self.assertRaises(ServiceError) as result:
                logs.detail_data(self.learner, '2026-09')
            self.assertEqual(result.exception.code, 'month_not_closed')
            request = self.request('post', snapshot_digest='hash', confirmed='true', capture_method='draw',
                                   signature=SimpleUploadedFile('signature.png', b'fake', content_type='image/png'))
            with patch.object(logs, 'scope', return_value=(self.learner, 'learner')), \
                 patch.object(logs.storage, 'sanitize', return_value=b'clean'):
                with self.assertRaises(ServiceError) as result:
                    unwrap(logs.sign)(request, 7, '2026-09')
            self.assertEqual(result.exception.code, 'month_not_closed')
            activities.assert_not_called()
            query.assert_not_called()

    def test_learner_preview_is_read_only_and_ignores_a_stale_coach_selection(self):
        self.account.role = 'admin'
        with patch.object(logs.old, 'coach_actor', return_value={'role': 'admin', 'email': 'admin@example.test'}), \
             patch.object(logs.old, 'resolve_record', return_value=self.learner), \
             patch.object(sources, 'profile', return_value=None), \
             patch('coach_api.auth._requested_view_as_email', return_value='other@example.test') as view_as:
            learner, role = logs.scope(self.request(perspective='learner'), 7)
            self.assertTrue(learner['_view_as'])
            self.assertEqual(role, 'admin')
            view_as.assert_not_called()
            request = self.request('post')
            request.GET = {'perspective': 'learner'}
            with self.assertRaises(ServiceError) as result:
                logs.scope(request, 7)
            self.assertEqual(result.exception.status, 403)

    def test_coach_preview_cannot_read_an_unassigned_learner(self):
        self.account.role = 'staff'
        with patch.object(logs.old, 'coach_actor', return_value={'role': 'coach', 'email': 'other@example.test'}), \
             patch.object(logs.old, 'resolve_record', return_value=self.learner), \
             patch.object(sources, 'profile', return_value=None):
            with self.assertRaises(ServiceError) as result:
                logs.scope(self.request(perspective='learner'), 7)
            self.assertEqual(result.exception.status, 404)

    def test_month_end_rollover_does_not_create_empty_months(self):
        with patch.object(sources, 'activity_rows', return_value=[self.row]), \
             patch.object(logs.timezone, 'localdate', return_value=date(2027, 1, 1)):
            self.assertEqual(list(logs.current_months(self.learner)), ['2026-09'])

    def test_signed_month_remains_if_its_last_source_row_is_removed(self):
        signature = {'report_month': '2026-09', 'signer_role': 'learner', 'signer_name': 'Learner',
                     'signed_at': '2026-10-01', 'url': 'saved', 'snapshot_hash': logs.old.digest([self.row])}
        with patch.object(sources, 'activity_rows', return_value=[]), \
             patch.object(logs, 'signatures', return_value=[signature]), \
             patch.object(logs, 'legacy_summary', return_value={'months': []}), \
             patch.object(logs.old_repo, 'report_profile', return_value={}):
            summary = logs.summary_data(self.learner)
            report = logs.detail_data(self.learner, '2026-09')
        self.assertEqual([m['month'] for m in summary['months']], ['2026-09'])
        self.assertEqual(report['rows'], [])
        self.assertEqual(report['status'], 'complete')
        self.assertEqual(report['student_signature']['url'], 'saved')

    def test_existing_signature_is_not_replaced_after_source_updates(self):
        report = {**logs.month_state('2026-09', [self.row], []), 'rows': [self.row],
                  'student_signature': {'url': 'saved', 'signed_at': '2026-10-01'}}
        request = self.request('post', snapshot_digest='old', confirmed='true', capture_method='draw',
                               signature=SimpleUploadedFile('signature.png', b'fake', content_type='image/png'))
        with patch.object(logs, 'scope', return_value=(self.learner, 'learner')), \
             patch.object(logs.storage, 'sanitize', return_value=b'clean'), \
             patch.object(logs.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(logs.old_repo, 'query', return_value=[]) as query, \
             patch.object(logs, 'detail_data', return_value=report):
            response = unwrap(logs.sign)(request, 7, '2026-09')
        self.assertEqual(json.loads(response.content)['student_signature']['url'], 'saved')
        self.assertFalse(any('INSERT' in call.args[0] for call in query.call_args_list))

    def test_reflection_enriches_progress_without_adding_hours_twice(self):
        reflection = {'id': 'r1', 'progress_entry_id': 1, 'submitted_at': '2026-09-12',
                      'learning_reflection': 'My reflection', 'actual_time_hours': '1', 'ksb_codes': ['K1']}
        rows = [deepcopy(self.row)]
        with patch.object(sources, 'query', return_value=[{'payload': reflection}]):
            sources._reflections(self.learner, rows)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['completion_note'], 'My reflection')
        self.assertEqual(rows[0]['ksb_codes'], ['K1'])
        self.assertEqual(rows[0]['actual_hours'], 1)

    def test_new_attempts_never_reuse_audited_hours(self):
        records = [{'id': 'a1', 'activity_id': 12, 'group_id': 2, 'submitted_at': '2026-09-12',
                    'completed': True, 'score_percent': 100, 'passed': True,
                    'definition': {'title': 'Quiz', 'quiz': {}}, 'group_name': 'Module'}]
        with patch.object(sources, 'query', side_effect=[[{'table_name': 'ready'}], records]):
            rows = sources._attempts(self.learner)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_hours'], 0)
        self.assertEqual(rows[0]['results'][0]['quiz_score'], 100)

    def test_changed_month_cannot_be_signed_and_does_not_insert(self):
        request = self.request('post', snapshot_digest='earlier', confirmed='true', capture_method='draw',
                               signature=SimpleUploadedFile('signature.png', b'fake', content_type='image/png'))
        report = {**logs.month_state('2026-09', [self.row], []), 'rows': [self.row]}
        with patch.object(logs, 'scope', return_value=(self.learner, 'learner')), \
             patch.object(logs.storage, 'sanitize', return_value=b'clean'), \
             patch.object(logs.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(logs.old_repo, 'query', return_value=[]) as query, \
             patch.object(logs, 'detail_data', return_value=report):
            with self.assertRaises(ServiceError) as result:
                unwrap(logs.sign)(request, 7, '2026-09')
        self.assertEqual(result.exception.code, 'record_changed')
        self.assertFalse(any('INSERT' in call.args[0] for call in query.call_args_list))

    def test_signing_uses_authenticated_role_and_distinct_immutable_revision(self):
        report = {**logs.month_state('2026-09', [self.row], []), 'rows': [self.row]}
        request = self.request('post', snapshot_digest=report['snapshot_digest'], confirmed='true', capture_method='draw',
                               signature=SimpleUploadedFile('signature.png', b'fake', content_type='image/png'))
        with patch.object(logs, 'scope', return_value=(self.learner, 'coach')), \
             patch.object(logs.storage, 'sanitize', return_value=b'clean'), \
             patch.object(logs.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(logs.old_repo, 'query', return_value=[]) as query, \
             patch.object(logs, 'detail_data', return_value=report):
            unwrap(logs.sign)(request, 7, '2026-09')
        insert = next(call for call in query.call_args_list if 'INSERT' in call.args[0])
        self.assertEqual(insert.args[1][0], 'lms:7')
        self.assertEqual(insert.args[1][3], 'coach')
        self.assertIn(report['snapshot_digest'], insert.args[1][1])
        self.assertIn('DO NOTHING', insert.args[0])
        capture = json.loads(insert.args[1][5])
        self.assertEqual(capture['rows'], [self.row])
        self.assertEqual(capture['actor_account_id'], self.account.id)

    def test_coach_signing_first_does_not_claim_the_content_changed(self):
        signature = {'report_month': '2026-09', 'signer_role': 'coach', 'signer_name': 'Coach',
                     'signed_at': '2026-09-12', 'url': 'saved', 'snapshot_hash': logs.old.digest([self.row])}
        state = logs.month_state('2026-09', [self.row], [signature])
        self.assertEqual(state['status'], 'awaiting_signature')
        self.assertIsNotNone(state['coach_signature'])

    def test_saved_native_quiz_answers_are_scoped_to_progress_and_learner(self):
        quiz = {'title': 'Knowledge check', 'questions': [{'id': 8, 'text': 'Choose a strategy',
                'answers': [{'id': 2, 'text': 'Selected option'}, {'id': 3, 'text': 'Other option'}]}]}
        answer = {'question_ref': 8, 'chosen_answer_ref': 2, 'is_correct': True, 'selected': []}
        with patch('learner_api.quizzes._fetch_quiz', return_value=quiz), \
             patch.object(sources, 'query', return_value=[answer]) as query:
            part = sources._progress_quiz(self.learner, {**self.row, 'quiz_ref': '4'})
        self.assertIn('Selected option', part['html'])
        self.assertNotIn('Other option', part['html'])
        self.assertEqual(query.call_args.args[1], ['1', 7])

    def test_unknown_activity_content_does_not_resolve_material(self):
        with patch.object(logs, 'scope', return_value=(self.learner, 'learner')), \
             patch.object(logs, 'detail_data', return_value={'source': 'lms', 'rows': [self.row]}), \
             patch.object(sources, 'activity_content') as content:
            with self.assertRaises(ServiceError):
                unwrap(logs.content)(self.request(), 7, '2026-09', 999)
        content.assert_not_called()

    def test_monthly_target_uses_the_saved_plan_without_inventing_missing_hours(self):
        learner = {**self.learner, 'planned_hours_monthly': '{"2026-09":"12.5","2026-10":null}'}
        self.assertEqual(sources.monthly_target(learner, '2026-09'), 12.5)
        self.assertIsNone(sources.monthly_target(learner, '2026-10'))
        self.assertIsNone(sources.monthly_target(learner, '2026-11'))
