"""Workspace switching retains server grants, monitoring scope and admin gates."""
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase, override_settings

from login.api_gate import refusal_for
from login.identity import account_payload
from login.permissions import require_access
from login.sessions import _refresh_staff_role
from old_otjh import repository, service, views


def account(primary='record-monitor'):
    return SimpleNamespace(id=7, subject_type='staff', subject_id=17, role='staff',
        email='coach@example.test', display_name='Test staff', is_active=True,
        has_password=True, last_login_at=None, _staff_access=primary)


class WorkspaceGrantTests(SimpleTestCase):
    def setUp(self):
        self.account = account()
        self.staff = SimpleNamespace(position='Admin', access='record-monitor', access_extra='coach')

    def refresh(self):
        with patch('learner_api.models.StaffUser.objects') as manager:
            manager.filter.return_value.only.return_value.first.return_value = self.staff
            _refresh_staff_role(self.account)

    def test_monitor_with_coach_uses_normal_endpoint_grants(self):
        self.refresh()
        self.assertEqual(self.account._staff_accesses, {'record-monitor', 'coach'})
        with patch.dict('os.environ', {'API_REQUIRE_AUTH': '1'}), patch('learner_api.programme_access.refusal', return_value=None):
            self.assertIsNone(refusal_for('/coach_api/coach/caseload/', self.account))
            self.assertIsNone(refusal_for('/api/batch/', self.account))
        request = RequestFactory().get('/coach_api/coach/caseload/')
        with patch('login.permissions.authenticate_request', return_value=self.account), \
                patch('learner_api.models.StaffUser.objects') as manager:
            manager.filter.return_value.only.return_value.first.return_value = self.staff
            view = lambda request: JsonResponse({'ok': True})
            self.assertEqual(require_access('coach')(view)(request).status_code, 200)
            self.assertEqual(require_access('curriculum')(view)(request).status_code, 403)
            self.assertEqual(require_access('super-admin')(view)(request).status_code, 403)

    def test_revoking_extra_access_restores_monitor_only_restrictions(self):
        self.refresh()
        self.staff.access_extra = ''
        self.refresh()
        for path in ('/coach_api/coach/caseload/', '/api/batch/', '/login_api/admin/accounts/'):
            self.assertEqual(refusal_for(path, self.account).status_code, 403)
        self.assertIsNone(refusal_for('/login_api/me/', self.account))

    def test_unreadable_grants_never_reuse_the_cached_multi_access(self):
        self.refresh()
        with patch('learner_api.models.StaffUser.objects') as manager:
            manager.filter.side_effect = DatabaseError('Unavailable')
            _refresh_staff_role(self.account)
        self.assertEqual(refusal_for('/coach_api/coach/caseload/', self.account).status_code, 503)

    def test_advanced_admin_stays_restricted_with_extra_grants(self):
        self.account._staff_access = 'advanced-admin'
        self.account._staff_accesses = {'advanced-admin', 'coach', 'record-monitor'}
        for path in ('/coach_api/coach/caseload/', '/api/batch/', '/audit_api/old-otjh/monitor/'):
            self.assertEqual(refusal_for(path, self.account).status_code, 403)
        self.assertIsNone(refusal_for('/login_api/advanced-admin/learners/', self.account))

    def test_monitor_and_advanced_admin_alone_do_not_open_other_apis(self):
        self.account._staff_accesses = {'record-monitor', 'advanced-admin'}
        self.assertEqual(refusal_for('/coach_api/coach/caseload/', self.account).status_code, 403)

    def test_payload_includes_both_grants_without_admin_permissions(self):
        with patch('login.learner_enrolment.existing_learner_record', return_value=None):
            payload = account_payload(self.account, subject=self.staff)
        self.assertEqual({workspace['access'] for workspace in payload['accessWorkspaces']}, {'coach', 'record-monitor'})
        self.assertNotIn('accounts.manage', payload['permissions'])
        self.assertNotEqual(payload['permissions'], ['previous_records.view'])


@override_settings(OLD_OTJH_ENABLED=True)
class MonitoringWorkspaceGrantTests(SimpleTestCase):
    def setUp(self):
        self.account = account('coach')
        self.staff = {'access': 'coach', 'access_extra': 'record-monitor', 'email': self.account.email}
        self.history = [{'coach_email': self.account.email, 'programme_status': 'Active'}]
        for target, value in (
            ('staff', self.staff), ('historical_learner', self.history), ('linked_learners', [{'id': 12}]),
        ):
            patcher = patch.object(repository, target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(service, 'resolve_record', side_effect=lambda *a, **kw: {'id': 12, 'aptem_id': 42})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_monitoring_grant_can_be_secondary(self):
        self.assertEqual(service.coach_actor(self.account, monitoring=True)['role'], 'monitor')
        self.staff.update(access='support', access_extra='record-monitor')
        self.assertTrue(service.is_monitor(self.account))
        self.assertEqual(service.coach_actor(self.account)['role'], 'monitor')

    def test_primary_monitor_can_coach_own_learners_with_coach_grant(self):
        self.staff.update(access='record-monitor', access_extra='coach')
        record, role = service.coach_learner(self.account, 42)
        self.assertEqual(role, 'coach')
        self.assertNotIn('_read_only', record)
        self.assertFalse(service.is_monitor(self.account))

    def test_explicit_monitoring_is_read_only_even_for_own_coaching_record(self):
        request = RequestFactory().get('/audit_api/last-audit/manual/summary?aptem_id=42&workspace=monitor')
        request.login_account = self.account
        record, role = views.scope(request)
        self.assertTrue(record['_read_only'])
        self.assertEqual(role, 'monitor')
        with self.assertRaises(service.ServiceError):
            service.require_writer(role)

    def test_other_coaches_active_records_are_read_only(self):
        self.history[0]['coach_email'] = 'other@example.test'
        with self.assertRaises(service.ServiceError):
            service.coach_learner(self.account, 42)
        record, role = service.coach_learner(self.account, 42, monitoring=True)
        self.assertTrue(record['_read_only'])
        with self.assertRaises(service.ServiceError):
            service.require_writer(role)
        self.history[0]['programme_status'] = 'Withdrawn'
        with self.assertRaises(service.ServiceError):
            service.coach_learner(self.account, 42, monitoring=True)

    def test_coach_without_monitor_grant_cannot_impersonate_monitor(self):
        self.staff['access_extra'] = ''
        with self.assertRaises(service.ServiceError):
            service.coach_learner(self.account, 42, monitoring=True)
        self.history[0]['coach_email'] = 'other@example.test'
        with self.assertRaises(service.ServiceError):
            service.coach_learner(self.account, 42)

    def test_monitoring_requests_refuse_writes_before_running_view(self):
        request = RequestFactory().post('/audit_api/old-otjh/start/?workspace=monitor', {})
        request.login_account = self.account
        request._dont_enforce_csrf_checks = True
        with patch('login.permissions.authenticate_request', return_value=self.account), \
                patch.object(views, 'is_clone', return_value=False), patch.object(service, 'start') as start:
            self.assertEqual(views.start(request).status_code, 403)
        start.assert_not_called()
