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
from . import monthly_logs as logs, monthly_log_sources as sources, mcm_signoff as signoff


class MonthlyLogsTests(SimpleTestCase):
    def setUp(self):
        # These cases exercise the retained path for a learner with no canonical
        # identity. Canonical behavior has its own isolated regression suite.
        profile = patch.object(logs.canonical, 'profile', return_value=None)
        profile.start()
        self.addCleanup(profile.stop)
        today = patch.object(logs.timezone, 'localdate', return_value=date(2026, 10, 1))
        today.start()
        self.addCleanup(today.stop)
        self.account = SimpleNamespace(id=1, role='learner', subject_type='learner', subject_id=7, is_active=True,
                                       display_name='Learner', email='learner@example.test')
        self.learner = {'id': 7, 'aptem_id': 42, 'name': 'Learner', 'programme': 'Programme',
                        'email': 'learner@example.test', 'coach_email': 'coach@example.test',
                        '_profile': None, '_view_as': False}
        required_profile = patch.object(logs.canonical, 'require_profile', return_value={
            **self.learner, 'id': 70, 'enrolment_id': 7, 'programme_id': 'P1',
        })
        required_profile.start()
        self.addCleanup(required_profile.stop)
        self.row = sources.row('progress:1', '2026-09-12T10:00:00Z', 'Reading', 'Reading', hours=1)
        unlocked = {'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None}
        # Keep this SimpleTestCase a true unit suite as the production journal
        # gains canonical/history persistence dependencies. Those integrations
        # have dedicated tests; these cases exercise monthly-log orchestration.
        dependencies = [
            patch.object(logs.canonical, 'enabled', return_value=False),
            patch.object(logs.history, 'later_rows', return_value={}),
            patch.object(logs.history, 'summary', side_effect=lambda learner: logs.old.summary(learner)),
            patch.object(logs.history, 'detail', side_effect=lambda learner, month, demo=False: logs.old.month_detail(learner, month)),
            patch.object(logs, 'lock_state', return_value={
                'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None,
            }),
            patch.object(logs, 'lock_states', side_effect=lambda _learner_id, months, **_kwargs: {
                month: dict(unlocked) for month in months
            }),
        ]
        for dependency in dependencies:
            dependency.start()
            self.addCleanup(dependency.stop)

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

    def test_canonical_source_lineage_does_not_discard_accepted_hours(self):
        legacy = {**self.row, 'source_system': 'old_lms'}
        state = logs.month_state('2026-09', [self.row, legacy], [])
        self.assertEqual(state['actual_hours'], 2)
        self.assertEqual(state['not_accepted_hours'], 0)
        self.assertEqual(state['total_actual_hours'], 2)
        self.assertEqual(
            logs.month_state('2026-09', [self.row], [])['snapshot_digest'],
            logs.month_state('2026-09', [legacy], [])['snapshot_digest'],
        )

    def test_old_report_is_returned_with_existing_signatures_and_iframe_rows(self):
        historical = {'month': '2026-08', 'rows': [], 'student_signature': {'file_id': 'saved',
                       'signed_at': '2026-09-01', 'signer_name': 'Learner'}, 'coach_signature': None}
        with patch.object(logs.old, 'month_detail', return_value=historical), \
             patch.object(logs, 'signed_training_plan_targets', return_value={'2026-08': 20}), \
             patch.object(logs.old, 'start') as start:
            detail = logs.detail_data(self.learner, '2026-08')
        self.assertEqual(detail['student_signature']['url'], '/audit_api/old-otjh/signatures/saved/')
        self.assertEqual(detail['source'], 'legacy')
        self.assertEqual(detail['training_plan_target'], 20)
        self.assertEqual(detail['training_plan_target_source'], 'signed_training_plan')
        start.assert_not_called()

    def test_historical_summary_uses_history_service_targets(self):
        historical = {'months': [
            {'month': '2026-01', 'training_plan_target': 1},
            {'month': '2026-02', 'training_plan_target': 30},
        ]}
        historical['months'][0]['training_plan_target'] = 3
        historical['months'][0]['training_plan_target_source'] = 'signed_training_plan'
        with patch.object(logs.history, 'summary', return_value=historical):
            summary = logs.legacy_summary(self.learner)

        self.assertEqual(summary['months'][0]['training_plan_target'], 3)
        self.assertEqual(summary['months'][0]['training_plan_target_source'], 'signed_training_plan')
        self.assertEqual(summary['months'][1]['training_plan_target'], 30)

    def test_month_after_august_keeps_using_the_lms_source(self):
        with patch.object(logs.old, 'month_detail') as audit_detail, \
             patch.object(logs, 'signed_training_plan_targets') as contract_targets, \
             patch.object(logs, 'signatures', return_value=[]), \
             patch.object(sources, 'activity_rows', return_value=[self.row]), \
             patch.object(logs, 'lock_state', return_value={'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None}), \
             patch.object(logs.old_repo, 'report_profile', return_value={}):
            detail = logs.detail_data(self.learner, '2026-09')

        self.assertEqual(detail['source'], 'lms')
        self.assertEqual(detail['rows'], [self.row])
        audit_detail.assert_not_called()
        contract_targets.assert_not_called()

    def test_summary_includes_retained_and_current_months(self):
        retained = {'month': '2026-08', 'status': 'complete', 'student_signature': {'url': 'saved'}}
        with patch.object(logs, 'legacy_summary', return_value={'months': [retained]}), \
             patch.object(logs, 'signatures', return_value=[]), \
             patch.object(logs, 'current_months', return_value={'2026-09': [self.row]}):
            summary = logs.summary_data(self.learner)
        self.assertEqual([m['month'] for m in summary['months']], ['2026-08', '2026-09'])
        self.assertEqual(summary['months'][0]['student_signature']['url'], 'saved')
        self.assertEqual(summary['completed_months'], 1)

    def test_canonical_summary_exposes_one_programme_accepted_and_plan_total(self):
        owner = {'id': 70, 'enrolment_id': 7, 'programme_id': 'P1'}
        record = {'id': 1, 'accepted': True, 'actual_seconds': 186300, 'ksbs': [], 'segments': []}
        with patch.object(logs.canonical, 'entries_for', return_value=[record]), \
             patch.object(logs.canonical, 'signatures_for', return_value=[]), \
             patch.object(logs.canonical, 'targets_for', return_value={'2026-08': 12, '2026-09': 15}), \
             patch.object(logs.canonical, 'rows_for', return_value=[self.row]):
            summary = logs.summary_data({**self.learner, '_canonical_profile': owner})
        self.assertEqual(summary['training_plan_totals'], {
            'accepted_hours': 51.75, 'planned_hours': 27,
        })

    def test_reporting_segments_count_as_one_activity_in_a_month(self):
        split = [{**self.row, 'progress_id': 90, 'source_ref': 'canonical:90:segment:1'},
                 {**self.row, 'progress_id': 90, 'source_ref': 'canonical:90:segment:2'}]
        state = logs.month_state('2026-09', split, [])
        self.assertEqual(state['row_count'], 1)
        self.assertEqual(state['actual_hours'], 2)

    def test_summary_exposes_audit_planned_end_date(self):
        learner = {**self.learner, '_profile': {'coach_name': 'Coach', 'end_date': date(2026, 1, 31)}}
        with patch.object(logs, 'legacy_summary', return_value={
                 'months': [], 'profile': {'planned_end_date': date(2027, 10, 17)}}), \
             patch.object(logs, 'signatures', return_value=[]), \
             patch.object(logs, 'current_months', return_value={}):
            summary = logs.summary_data(learner)
        self.assertEqual(summary['learner']['planned_end_date'], date(2027, 10, 17))

    def test_lms_month_appears_only_after_month_end_with_all_its_activities(self):
        last_day = sources.row('progress:2', '2026-09-30', 'End-of-month reflection', 'Assignment')
        future = sources.row('progress:3', '2026-10-01', 'Next month', 'Reading')
        with patch.object(sources, 'activity_rows', return_value=[last_day, self.row, future]):
            with patch.object(logs.timezone, 'localdate', return_value=date(2026, 9, 30)):
                self.assertEqual(logs.current_months(self.learner), {})
            self.assertEqual(logs.current_months(self.learner), {'2026-09': [self.row, last_day]})

    def test_open_month_is_available_as_a_live_unsigned_log(self):
        learner = {**self.learner, 'aptem_id': None}
        with patch.object(logs.timezone, 'localdate', return_value=date(2026, 9, 15)), \
             patch.object(sources, 'activity_rows', return_value=[self.row]), \
             patch.object(logs, 'legacy_summary', return_value={'months': []}), \
             patch.object(logs, 'signatures', return_value=[]), \
             patch.object(logs, 'lock_state', return_value={'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None}), \
             patch.object(sources, 'first_evidence_date', return_value=None):
            summary = logs.summary_data(learner, include_open=True)
            detail = logs.detail_data(learner, '2026-09', include_open=True)
        self.assertEqual([month['month'] for month in summary['months']], ['2026-09'])
        self.assertTrue(summary['months'][0]['is_open'])
        self.assertTrue(detail['is_open'])
        self.assertEqual(detail['rows'], [self.row])

    def test_mcm_month_is_visible_before_signature_even_without_activity(self):
        learner = {**self.learner, 'aptem_id': None}
        with patch.object(sources, 'activity_rows', return_value=[]), \
             patch.object(logs, 'legacy_summary', return_value={'months': []}), \
             patch.object(logs, 'signatures', return_value=[]), \
             patch.object(logs, 'lock_state', return_value={
                 'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None,
             }), \
             patch.object(sources, 'first_evidence_date', return_value=None), \
             patch.object(logs.old_repo, 'report_profile', return_value={}):
            summary = logs.summary_data(learner, include_open=True, ensure_month='2026-09')
            detail = logs.detail_data(learner, '2026-09', include_open=True, ensure_month='2026-09')

        self.assertEqual([month['month'] for month in summary['months']], ['2026-09'])
        self.assertEqual(summary['months'][0]['row_count'], 0)
        self.assertEqual(detail['rows'], [])
        self.assertEqual(detail['status'], 'awaiting_signature')

    def test_mcm_future_month_can_be_loaded_and_signed(self):
        learner = {**self.learner, 'aptem_id': None}
        with patch.object(logs.timezone, 'localdate', return_value=date(2026, 9, 29)), \
             patch.object(sources, 'activity_rows', return_value=[]), \
             patch.object(logs, 'legacy_summary', return_value={'months': []}), \
             patch.object(logs, 'signatures', return_value=[]), \
             patch.object(logs, 'lock_state', return_value={
                 'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None,
             }), \
             patch.object(sources, 'first_evidence_date', return_value=None), \
             patch.object(logs.old_repo, 'report_profile', return_value={}):
            detail = logs.detail_data(learner, '2026-10', include_open=True,
                                      include_future=True, ensure_month='2026-10')

        self.assertEqual(detail['month'], '2026-10')
        self.assertFalse(detail['is_open'])
        self.assertEqual(detail['rows'], [])

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

    def test_mcm_signature_is_copied_to_the_matching_open_lms_month(self):
        report = {'source': 'lms', 'rows': [self.row], 'profile': None,
                  'snapshot_digest': 'mcm-digest'}
        learner = {**self.learner, 'aptem_id': None}
        with patch.object(logs, 'detail_data', return_value=report), \
             patch.object(logs.canonical, 'enabled', return_value=False), \
             patch.object(logs.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(logs.old_repo, 'query', return_value=[]) as query:
            result = logs.mirror_mcm_learner_signature(
                learner, '2026-09', 'data:image/png;base64,mcm', 'Learner',
            )

        self.assertEqual(result['status'], 'synced')
        self.assertEqual(result['month'], '2026-09')
        insert = next(call for call in query.call_args_list if 'INSERT INTO' in call.args[0])
        self.assertIn('monthly_audit_signoffs', insert.args[0])
        self.assertIn('data:image/png;base64,mcm', insert.args[1][4])
        self.assertIn('mcm-digest', insert.args[1])

    def test_mcm_signature_mirror_accepts_a_future_target_month(self):
        report = {'source': 'lms', 'rows': [], 'profile': None,
                  'snapshot_digest': 'future-mcm-digest'}
        learner = {**self.learner, 'aptem_id': None}
        with patch.object(logs.timezone, 'localdate', return_value=date(2026, 9, 29)), \
             patch.object(logs, 'detail_data', return_value=report), \
             patch.object(logs.canonical, 'enabled', return_value=False), \
             patch.object(logs.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(logs.old_repo, 'query', return_value=[]) as query:
            result = logs.mirror_mcm_learner_signature(
                learner, '2026-10', 'data:image/png;base64,mcm', 'Learner',
            )

        self.assertEqual(result['status'], 'synced')
        self.assertEqual(result['month'], '2026-10')
        self.assertTrue(any('INSERT INTO' in call.args[0] for call in query.call_args_list))

    def test_canonical_mcm_signature_uses_the_table_scope_conflict_key(self):
        report = {'source': 'lms', 'rows': [self.row], 'profile': None,
                  'snapshot_digest': 'canonical-mcm-digest'}
        learner = {**self.learner, 'aptem_id': None}
        owner = {'id': 683, 'enrolment_id': 7, 'aptem_id': None}
        with patch.object(logs, 'detail_data', return_value=report), \
             patch.object(logs.canonical, 'enabled', return_value=True), \
             patch.object(logs.canonical, 'profile', return_value=owner), \
             patch.object(logs.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(logs.old_repo, 'query', return_value=[]) as query:
            result = logs.mirror_mcm_learner_signature(
                learner, '2026-09', 'data:image/png;base64,mcm', 'Learner',
            )

        self.assertEqual(result['status'], 'synced')
        insert = next(call for call in query.call_args_list if 'INSERT INTO' in call.args[0])
        self.assertIn('source_learner_id,programme_key', insert.args[0])
        self.assertIn('ON CONFLICT (source_learner_id,programme_key,report_month,signer_role)', insert.args[0])
        self.assertEqual(insert.args[1][-2:], ['7', 'lms:7'])

    def test_canonical_monthly_log_signing_uses_the_same_table_scope(self):
        report = {**logs.month_state('2026-09', [self.row], []), 'rows': [self.row]}
        learner = {**self.learner, 'aptem_id': None}
        owner = {'id': 683, 'enrolment_id': 7, 'aptem_id': None}
        request = self.request(
            'post', snapshot_digest=report['snapshot_digest'], confirmed='true', capture_method='draw',
            signature=SimpleUploadedFile('signature.png', b'fake', content_type='image/png'),
        )
        with patch.object(logs, 'scope', return_value=(learner, 'learner')), \
             patch.object(logs.storage, 'sanitize', return_value=b'clean'), \
             patch.object(logs, 'detail_data', return_value=report), \
             patch.object(logs, 'lock_if_fully_signed'), \
             patch.object(logs.canonical, 'enabled', return_value=True), \
             patch.object(logs.canonical, 'profile', return_value=owner), \
             patch.object(logs.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(logs.old_repo, 'query', return_value=[]) as query:
            response = unwrap(logs.sign)(request, 7, '2026-09')

        self.assertEqual(response.status_code, 200)
        insert = next(call for call in query.call_args_list if 'INSERT INTO' in call.args[0])
        self.assertIn('ON CONFLICT (source_learner_id,programme_key,report_month,signer_role)', insert.args[0])
        self.assertEqual(insert.args[1][-2:], ['7', 'lms:7'])

    def test_mcm_signoff_uses_target_month_when_booking_is_later(self):
        record = SimpleNamespace(
            target_date=date(2026, 12, 16),
            scheduled_date=date(2026, 9, 28),
        )

        self.assertEqual(signoff._month_for(record), '2026-12')

    def test_mcm_signature_copy_is_idempotent_when_monthly_signature_exists(self):
        report = {'source': 'lms', 'rows': [self.row], 'profile': None,
                  'snapshot_digest': 'mcm-digest'}
        learner = {**self.learner, 'aptem_id': None}
        with patch.object(logs, 'detail_data', return_value=report), \
             patch.object(logs.canonical, 'enabled', return_value=False), \
             patch.object(logs.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(logs.old_repo, 'query', side_effect=[[], [{'id': 9}]]) as query:
            result = logs.mirror_mcm_learner_signature(
                learner, '2026-09', 'data:image/png;base64,mcm', 'Learner',
            )

        self.assertEqual(result, {'status': 'already-synced', 'month': '2026-09'})
        self.assertEqual(query.call_count, 2)

    def test_admin_learner_workspace_allows_actions_and_ignores_a_stale_coach_selection(self):
        self.account.role = 'admin'
        with patch.object(logs.old, 'coach_actor', return_value={'role': 'admin', 'email': 'admin@example.test'}), \
             patch.object(logs.old, 'resolve_record', return_value=self.learner), \
             patch.object(sources, 'profile', return_value=None), \
             patch('coach_api.auth._requested_view_as_email', return_value='other@example.test') as view_as:
            learner, role = logs.scope(self.request(perspective='learner'), 7)
            self.assertFalse(learner['_view_as'])
            self.assertEqual(role, 'learner')
            view_as.assert_not_called()
            request = self.request('post')
            request.GET = {'perspective': 'learner'}
            learner, role = logs.scope(request, 7)
            self.assertFalse(learner['_view_as'])
            self.assertEqual(role, 'learner')
            self.assertIs(request.login_account, self.account)
            self.assertEqual(request.login_account.role, 'admin')
            self.assertTrue(request.admin_learner_action)
            self.assertEqual(request.admin_learner_id, 7)

    def test_admin_completion_uses_the_selected_record_and_real_actor(self):
        self.account.role = 'admin'
        request = self.request('post')
        report = {'month': '2026-08', 'status': 'complete', 'rows': []}
        with patch.object(logs, 'scope', return_value=(self.learner, 'learner')), \
             patch.object(logs.old, 'complete', return_value=report) as complete:
            response = unwrap(logs.complete)(request, 7, '2026-08')
        self.assertEqual(response.status_code, 200)
        complete.assert_called_once_with(self.learner, '2026-08', self.account, 'learner')

    def test_coach_cannot_complete_a_month_as_the_learner(self):
        with patch.object(logs, 'scope', return_value=(self.learner, 'coach')), \
             patch.object(logs.old, 'complete') as complete:
            with self.assertRaises(ServiceError) as result:
                unwrap(logs.complete)(self.request('post'), 7, '2026-08')
            self.assertEqual(result.exception.status, 403)
            complete.assert_not_called()

    def test_admin_completion_requires_csrf_before_writing(self):
        self.account.role = 'admin'
        request = self.request('post')
        request.GET = {'perspective': 'learner'}
        with patch('login.permissions.authenticate_request', return_value=self.account), \
             patch.object(logs.old, 'complete') as complete:
            self.assertEqual(logs.complete(request, 7, '2026-08').status_code, 403)
            complete.assert_not_called()

    def test_coach_preview_cannot_read_an_unassigned_learner(self):
        self.account.role = 'staff'
        with patch.object(logs.old, 'coach_actor', return_value={'role': 'coach', 'email': 'other@example.test'}), \
             patch.object(logs.old, 'resolve_record', return_value=self.learner), \
             patch.object(sources, 'profile', return_value=None):
            with self.assertRaises(ServiceError) as result:
                logs.scope(self.request(perspective='learner'), 7)
            self.assertEqual(result.exception.status, 404)

    def studying_staff(self, record_id=7):
        self.account.role = 'staff'
        self.account.subject_type = 'staff'
        self.account.subject_id = 3
        self.account.is_active = True
        return patch('login.learner_enrolment.existing_learner_record',
                     return_value=SimpleNamespace(pk=record_id))

    def test_staff_member_is_the_learner_on_their_own_record(self):
        with self.studying_staff(), \
             patch.object(logs.old, 'coach_actor') as coach_actor, \
             patch.object(logs.old, 'resolve_record', return_value=self.learner), \
             patch.object(sources, 'profile', return_value=None):
            request = self.request('post')
            request.GET = {'perspective': 'learner'}
            learner, role = logs.scope(request, 7)
        self.assertEqual(role, 'learner')
        self.assertFalse(learner['_view_as'])
        self.assertFalse(request.admin_learner_action)
        coach_actor.assert_not_called()

    def test_staff_member_keeps_coach_rules_on_another_learner(self):
        with self.studying_staff(record_id=9), \
             patch.object(logs.old, 'coach_actor', return_value={'role': 'coach', 'email': 'other@example.test'}), \
             patch.object(logs.old, 'resolve_record', return_value=self.learner), \
             patch.object(sources, 'profile', return_value=None):
            with self.assertRaises(ServiceError) as result:
                logs.scope(self.request(perspective='learner'), 7)
        self.assertEqual(result.exception.status, 404)

    def test_own_record_outside_the_learner_workspace_is_not_learner_access(self):
        with self.studying_staff() as lookup, \
             patch.object(logs.old, 'coach_actor', return_value={'role': 'coach', 'email': 'other@example.test'}), \
             patch.object(logs.old, 'resolve_record', return_value=self.learner), \
             patch.object(sources, 'profile', return_value=None):
            with self.assertRaises(ServiceError) as result:
                logs.scope(self.request(), 7)
        self.assertEqual(result.exception.status, 404)
        lookup.assert_not_called()

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


class MonthlyLogLockBatchTests(SimpleTestCase):
    def test_summary_lock_states_are_loaded_in_one_query(self):
        with patch.object(logs.old_repo, 'query', return_value=[{
            'report_month': '2026-09', 'locked_at': date(2026, 10, 1),
            'unlocked_at': None, 'unlocked_by': None,
        }]) as query:
            states = logs.lock_states(
                7, ['2026-08', '2026-09'], canonical_owner={'id': 70},
            )
        query.assert_called_once()
        self.assertFalse(states['2026-08']['locked'])
        self.assertTrue(states['2026-09']['locked'])
