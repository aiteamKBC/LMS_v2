"""Monitoring tests run without creating a database or changing real records."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, RequestFactory, override_settings
from django.http import JsonResponse
from django.db import DatabaseError
from login.api_gate import refusal_for
from login.identity import account_payload
from . import monitoring, repository as repo, service, views


def learner(ident=1, **changes):
    return dict(enrolment_id=ident, id=ident + 40, name=f'Learner {ident}',
        email=f'learner{ident}@example.org', programme='Programme', enrolment_status='Delivery',
        audit_status='Active', coach_name='Coach', coach_email='coach@example.org',
        enrolment_links=1, audit_links=1, **changes)


def source(aptem=41, month='2026-07'):
    return dict(aptem_id=aptem, month=month, row_count=1, planned_hours=1,
                actual_hours=1, not_accepted_hours=0)


def signer(role, month='2026-07'):
    return dict(enrolment_id=1, report_month=month, signer_role=role, signed_at='2026-09-08T09:00:00Z')


class MonitoringCountsTests(SimpleTestCase):
    def setUp(self):
        self.learners = [learner()]
        self.sources = [source(), source(month='2026-08')]
        self.transitions = [dict(learner_id=1, aptem_id=41, required_months=['2026-07', '2026-08'])]
        self.signs, self.finals, self.pending = [], [], []

    def rows(self):
        return monitoring.assemble(self.learners, self.sources, self.transitions, self.signs, self.finals, self.pending)

    def test_partial_learner_and_coach_signatures_are_separate(self):
        self.signs = [signer('learner'), signer('coach', '2026-08')]
        row = self.rows()[0]
        self.assertEqual((row['learner_signed_months'], row['coach_signed_months']), (1, 1))
        self.assertEqual(row['completed_months'], 0)
        self.assertEqual(row['status'], 'awaiting_both')

    def test_both_signatures_require_finalization(self):
        self.signs = [signer(role, month) for role in ('learner', 'coach') for month in ('2026-07', '2026-08')]
        self.assertEqual(self.rows()[0]['status'], 'ready_to_complete')
        self.finals = [dict(aptem_id=41, report_month=month, event_type='finalized') for month in ('2026-07', '2026-08')]
        self.assertEqual(self.rows()[0]['status'], 'completed')
        self.finals[1]['event_type'] = 'reopened'
        self.assertEqual(self.rows()[0]['completed_months'], 1)
        self.assertFalse(self.rows()[0]['can_access_lms'])

    def test_learner_record_signoff_is_complete_without_coach_signatures(self):
        self.signs = [signer('learner', month) for month in ('2026-07', '2026-08')]
        self.finals = [dict(aptem_id=41, report_month=month, event_type='finalized') for month in ('2026-07', '2026-08')]
        row = self.rows()[0]
        self.assertEqual(row['status'], 'completed')
        self.assertEqual(row['completed_months'], 2)
        self.assertEqual(row['coach_signed_months'], 0)
        self.assertTrue(row['can_access_lms'])

    def test_unstarted_reviews_are_counted_without_provisioning(self):
        self.transitions = []
        self.pending = [dict(aptem_id=41, month='2026-07', count=2)]
        row = self.rows()[0]
        self.assertEqual(row['total_months'], 2)
        self.assertEqual(row['status'], 'not_started')
        self.assertTrue(monitoring.matches_status(row, 'pending_revisions'))
        self.assertTrue(monitoring.matches_status(row, 'needs_attention'))

    def test_frozen_required_months_and_new_months_are_not_conflated(self):
        self.transitions[0]['required_months'] = '["2026-07"]'
        row = self.rows()[0]
        self.assertEqual((row['total_months'], row['additional_months']), (1, 1))

    def test_deleted_month_and_empty_record_do_not_count_as_signed(self):
        self.sources = []
        self.assertEqual(self.rows()[0]['empty_months'], 2)
        self.transitions = []
        row = self.rows()[0]
        self.assertEqual(row['status'], 'no_data')
        self.assertFalse(monitoring.matches_status(row, 'learner_signed'))

    def test_ambiguous_or_changed_identity_never_borrows_signatures(self):
        self.signs = [signer('learner')]
        for field in ('enrolment_links', 'audit_links'):
            self.learners[0][field] = 2
            row = self.rows()[0]
            self.assertEqual(row['status'], 'link_issue')
            self.assertFalse(row['can_open'])
            self.assertEqual(row['learner_signed_months'], 0)
            self.learners[0][field] = 1
        self.transitions[0]['aptem_id'] = 99
        self.assertEqual(self.rows()[0]['status'], 'link_issue')

    def test_search_filters_pagination_and_global_counts(self):
        records = monitoring.assemble([learner(i) for i in range(1, 32)],
            [source(i + 40) for i in range(1, 32)], [], [], [], [])
        with patch.object(monitoring, 'load_records', return_value=records):
            self.assertEqual(len(monitoring.dashboard({'page': '2'})['learners']), 6)
            result = monitoring.dashboard({'search': 'LEARNER31@EXAMPLE.ORG', 'page': '99'})
            self.assertEqual((result['total'], result['page'], result['stats']['total_learners']), (1, 1, 31))
            self.assertEqual(monitoring.dashboard({'search': "' OR 1=1 --"})['total'], 0)
            self.assertEqual(monitoring.dashboard({'coach': ''})['total'], 0)
            self.assertEqual(monitoring.dashboard({'status': 'completed'})['total'], 0)

    def test_invalid_filters_are_rejected(self):
        for params in ({'page': 'bad'}, {'status': 'invented'}):
            with self.assertRaises(service.ServiceError): monitoring.dashboard(params)


@override_settings(OLD_OTJH_ENABLED=True)
class MonitoringAccessTests(SimpleTestCase):
    def setUp(self):
        self.account = SimpleNamespace(id=700, is_active=True, role='staff', subject_type='staff',
            subject_id=70, email='monitor@example.org', display_name='Record monitor',
            _staff_access='record-monitor', has_password=True, last_login_at=None)
        self.staff = patch.object(repo, 'staff', return_value={'access': 'record-monitor', 'email': 'monitor@example.org'})
        self.staff.start()
        self.addCleanup(self.staff.stop)

    def test_account_lands_on_monitor_with_view_permission_only(self):
        payload = account_payload(self.account, subject=SimpleNamespace(access='record-monitor', position='Admin'))
        self.assertEqual(payload['accessHome'], '/old-otjh/monitor')
        self.assertEqual(payload['permissions'], ['previous_records.view'])

    def test_session_reloads_the_monitor_grant_and_fails_closed_if_unreadable(self):
        from login.sessions import _refresh_staff_role
        with patch('learner_api.models.StaffUser.objects') as manager:
            manager.filter.return_value.only.return_value.first.return_value = SimpleNamespace(access='record-monitor', position='Admin')
            _refresh_staff_role(self.account)
            self.assertEqual(self.account._staff_access, 'record-monitor')
            manager.filter.side_effect = DatabaseError('Unavailable')
            _refresh_staff_role(self.account)
            self.assertEqual(refusal_for('/learner_api/users/', self.account).status_code, 503)

    def test_monitor_cannot_use_other_platform_apis_including_batch(self):
        for path in ('/learner_api/users/', '/audit_api/last-audit/activities/', '/api/batch/',
                     '/login_api/admin/accounts/', '/enrolment_api/anything/'):
            self.assertEqual(refusal_for(path, self.account).status_code, 403)
        self.assertIsNone(refusal_for('/audit_api/old-otjh/monitor/', self.account))
        self.assertIsNone(refusal_for('/login_api/logout/', self.account))

    def test_monitor_cannot_reach_legacy_dispatch_without_transition_flag(self):
        old = lambda request: JsonResponse({'unsafe': True})
        safe = lambda request: JsonResponse({'safe': True})
        request = RequestFactory().get('/audit_api/last-audit/manual/rows')
        with patch.object(views, 'authenticate_request', return_value=self.account):
            self.assertJSONEqual(views.dispatch(old, safe)(request).content, {'safe': True})

    def test_monitor_cannot_write_even_if_controls_are_bypassed(self):
        for path, view, args in (
            ('/audit_api/old-otjh/start/', views.start, ()),
            ('/audit_api/learners/41/signoff/', views.signoff, (41,)),
            ('/audit_api/last-audit/manual/finalization', views.finalization, ()),
            ('/audit_api/old-otjh/refresh-months/', views.refresh_months, ()),
        ):
            request = RequestFactory().post(path, {}, content_type='application/json')
            request.login_account = self.account
            request._dont_enforce_csrf_checks = True
            with patch('login.permissions.authenticate_request', return_value=self.account):
                self.assertEqual(view(request, *args).status_code, 403)
        with self.assertRaises(service.ServiceError): service.start({}, self.account, 'monitor')
        with self.assertRaises(service.ServiceError): service.sign({}, '', self.account, 'monitor', b'', '', {})

    def test_only_active_linked_learners_can_be_opened(self):
        history = [{'coach_email': 'unrelated@example.org', 'programme_status': 'Active'}]
        with patch.object(repo, 'historical_learner', return_value=history), patch.object(repo, 'linked_learners', return_value=[{'id': 1}]), patch.object(service, 'resolve_record', return_value={'id': 1, 'aptem_id': 41}):
            record, role = service.coach_learner(self.account, 41)
            self.assertTrue(record['_read_only'])
            self.assertEqual(role, 'monitor')
            history[0]['programme_status'] = 'Withdrawn'
            with self.assertRaises(service.ServiceError): service.coach_learner(self.account, 41)

    def test_unstarted_month_can_be_read_without_any_insert(self):
        record = {'id': 1, 'aptem_id': 41, 'name': 'Learner', 'programme': 'Programme', '_read_only': True}
        with patch.object(repo, 'transition', return_value=None), patch.object(repo, 'source_months', return_value=[source()]), patch.object(repo, 'signatures', return_value=[]), patch.object(repo, 'finalizations', return_value=[]), patch.object(repo, 'pending_revisions', return_value=[]), patch.object(repo, 'month_rows', return_value=[]), patch.object(repo, 'report_profile', return_value={}), patch.object(repo, 'create_transition') as create:
            self.assertTrue(service.summary(record)['needs_start'])
            self.assertEqual(service.month_detail(record, '2026-07')['month'], '2026-07')
            create.assert_not_called()
            with self.assertRaises(service.ServiceError): service.month_detail(record, '2026-09')
            record.pop('_read_only')
            with self.assertRaises(service.ServiceError): service.month_detail(record, '2026-07')
