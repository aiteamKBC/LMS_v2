"""Owned plan-count reads without DB mutations, provisioning or external calls."""
from contextlib import ExitStack
from datetime import datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from learner_api import journal_sources
from coach_api import dashboard_activity_plan as endpoint


class DashboardActivityPlanTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.path = '/coach_api/coach/dashboard/learners/7/activity-plan'
        self.source = SimpleNamespace(pk=107)
        self.profile = SimpleNamespace(pk=7, enrolment_id=107, _caseload_source=self.source)
        self.plan = {'completed': 3, 'total': 12, 'percent': 25.0}
        self.now = datetime(2026, 11, 12, 12, tzinfo=timezone.utc)

    def test_counts_use_all_distinct_catalogue_modules_and_restore_journal_context(self):
        def facts(source, profile, *, as_of):
            self.assertTrue(journal_sources.enabled())
            self.assertIs(source, self.source)
            self.assertIs(profile, self.profile)
            self.assertEqual(as_of, self.now)
            return {'modules': [{'completed': 2, 'total': 8}, {'completed': 1, 'total': 4}],
                    'mainActivities': {'completedNativeComponents': 1, 'nativeComponents': []}}
        previous = journal_sources.enabled()
        with patch.object(endpoint, 'dashboard_activity_facts', side_effect=facts):
            self.assertEqual(endpoint.plan_activity_counts(self.source, self.profile, as_of=self.now), self.plan)
        self.assertEqual(journal_sources.enabled(), previous)

    def test_zero_and_empty_plans_are_not_calculation_failures(self):
        for total, percent in ((12, 0.0), (0, None)):
            with patch.object(endpoint, 'dashboard_activity_facts', return_value={'modules': [{'completed': 0, 'total': total}]}):
                self.assertEqual(endpoint.plan_activity_counts(self.source, self.profile, as_of=self.now),
                                 {'completed': 0, 'total': total, 'percent': percent})

    def test_inconsistent_counts_and_read_errors_do_not_become_zero(self):
        previous = journal_sources.enabled()
        for module in ({'completed': 13, 'total': 12}, {'completed': -1, 'total': 12},
                       {'completed': 1.5, 'total': 12}, {'completed': None, 'total': 12}):
            with patch.object(endpoint, 'dashboard_activity_facts', return_value={'modules': [module]}):
                with self.assertRaises(ValueError):
                    endpoint.plan_activity_counts(self.source, self.profile, as_of=self.now)
        with patch.object(endpoint, 'dashboard_activity_facts', side_effect=RuntimeError('Synthetic failure')):
            with self.assertRaises(RuntimeError):
                endpoint.plan_activity_counts(self.source, self.profile, as_of=self.now)
        self.assertEqual(journal_sources.enabled(), previous)

    def request(self, *, role='coach', params=None, authenticated=True, method='get', batch=False):
        request = getattr(self.factory, method)(self.path, params or {})
        account = SimpleNamespace(subject_type='staff', subject_id=1, role='staff')
        request.login_account = account
        staff = SimpleNamespace(id=1, email='coach-a@example.invalid', access=role)
        with ExitStack() as stack:
            stack.enter_context(patch('login.permissions.authenticate_request', return_value=account if authenticated else None))
            stack.enter_context(patch('login.permissions._accesses_of', return_value=frozenset({role})))
            stack.enter_context(patch('coach_api.auth._staff_access', side_effect=lambda user: user.access))
            users = stack.enter_context(patch('coach_api.auth.StaffUser.objects'))
            users.filter.return_value.only.return_value.first.return_value = staff
            stack.enter_context(patch('coach_api.auth._find_coach_staff', return_value=SimpleNamespace(
                id=2, email='coach-b@example.invalid', access='coach')))
            return endpoint.coach_dashboard_activity_plans(request) if batch else endpoint.coach_dashboard_activity_plan(request, 7)

    def test_route_and_coach_or_admin_view_as_keep_owner_scope_and_learner_types(self):
        self.assertIs(resolve(self.path).func, endpoint.coach_dashboard_activity_plan)
        for kind in ('commercial', 'apprenticeship'):
            self.source.learner_type = kind
            for role, params, owner in (
                    ('coach', {}, 'coach-a@example.invalid'),
                    ('super-admin', {'viewAsCoach': 'coach-b@example.invalid'}, 'coach-b@example.invalid')):
                with self.subTest(kind=kind, role=role), \
                     patch.object(endpoint, 'activity_plan_profiles', return_value=[self.profile]) as load, \
                     patch.object(endpoint, 'plan_activity_counts', return_value=self.plan) as counts:
                    response = self.request(role=role, params=params)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content)['activityPlan'], self.plan)
                self.assertEqual(response['Cache-Control'], 'private, no-store')
                load.assert_called_once_with(owner, [7])
                self.assertIs(counts.call_args.args[0], self.source)

    def test_unauthenticated_other_roles_and_foreign_coach_are_denied_before_loading(self):
        cases = [({'authenticated': False}, 401), ({'role': 'tutor'}, 403),
                 ({'role': 'super-admin'}, 403), ({'params': {'viewAsCoach': 'coach-b@example.invalid'}}, 403)]
        with patch.object(endpoint, 'activity_plan_profiles') as load:
            for kwargs, status in cases:
                self.assertEqual(self.request(**kwargs).status_code, status)
        load.assert_not_called()

    def test_foreign_missing_and_unlinked_learner_never_load_a_catalogue(self):
        for rows in ([], [SimpleNamespace(pk=8)], [SimpleNamespace(pk=7, _caseload_source=None)]):
            with patch.object(endpoint, 'activity_plan_profiles', return_value=rows), \
                 patch.object(endpoint, 'plan_activity_counts') as counts:
                self.assertEqual(self.request().status_code, 404)
            counts.assert_not_called()

    def test_failure_is_retryable_without_fabricated_counts_or_private_details(self):
        with patch.object(endpoint, 'activity_plan_profiles', return_value=[self.profile]), \
             patch.object(endpoint, 'plan_activity_counts', side_effect=RuntimeError('private test detail')), \
             patch.object(endpoint.log, 'exception'):
            response = self.request()
        self.assertEqual(response.status_code, 503)
        self.assertTrue(json.loads(response.content)['retryable'])
        self.assertNotIn('activityPlan', json.loads(response.content))
        self.assertNotIn('private test detail', response.content.decode())

    def test_mutating_methods_are_rejected(self):
        with patch.object(endpoint, 'activity_plan_profiles') as load:
            response = self.request(method='post')
        self.assertEqual(response.status_code, 405)
        load.assert_not_called()

    def test_profile_read_has_owner_filter_and_no_unrelated_prefetches(self):
        self.profile.username = 'synthetic'
        query = MagicMock()
        query.filter.return_value = [self.profile]
        with patch.object(endpoint.LearnerProfile.objects, 'annotate', return_value=query), \
             patch.object(endpoint, 'fetch_source_schedule_rows', return_value=({}, {})) as sources, \
             patch.object(endpoint, 'resolve_caseload_source_row', return_value=self.source):
            self.assertEqual(endpoint.activity_plan_profiles(' COACH-A@example.invalid ', [7]), [self.profile])
        query.filter.assert_called_once_with(coach_email_key='coach-a@example.invalid', id__in=[7])
        sources.assert_called_once_with([self.profile])

    def test_batch_route_rejects_invalid_and_unbounded_requests_before_reading(self):
        self.assertIs(resolve('/coach_api/coach/dashboard/activity-plans').func, endpoint.coach_dashboard_activity_plans)
        with patch.object(endpoint, 'activity_plan_profiles') as load:
            for value in ('', '1,2,3,4,5', '-1', '0', '7,x', '1.5', '9' * 100, str(2**63)):
                self.assertEqual(self.request(batch=True, params={'learnerIds': value}).status_code, 400)
        load.assert_not_called()

    def test_batch_roles_and_view_as_retain_server_side_authorization(self):
        with patch.object(endpoint, 'activity_plan_profiles', return_value=[]) as load:
            for kwargs, status in (({'authenticated': False}, 401), ({'role': 'tutor'}, 403),
                                   ({'role': 'super-admin'}, 403), ({'method': 'post'}, 405)):
                self.assertEqual(self.request(batch=True, params={'learnerIds': '7'}, **kwargs).status_code, status)
            self.assertEqual(self.request(batch=True, params={'learnerIds': '7', 'viewAsCoach': 'coach-b@example.invalid'}).status_code, 403)
            load.assert_not_called()
            response = self.request(batch=True, role='super-admin',
                                    params={'learnerIds': '7', 'viewAsCoach': 'coach-b@example.invalid'})
        self.assertEqual(response.status_code, 200)
        load.assert_called_once_with('coach-b@example.invalid', [7])

    def test_batch_deduplicates_authorises_and_isolates_failed_rows(self):
        other = SimpleNamespace(pk=8, _caseload_source=SimpleNamespace(pk=108))
        unlinked = SimpleNamespace(pk=10, _caseload_source=None)
        def read(profile, as_of):
            released.assert_called()
            if profile.pk == 8:
                raise RuntimeError('private failure')
            return self.plan
        with patch.object(endpoint, 'activity_plan_profiles', return_value=[self.profile, other, unlinked]) as load, \
             patch.object(endpoint.connections, 'close_all') as released, \
             patch.object(endpoint, '_read_plan', side_effect=read) as counts, \
             patch.object(endpoint.log, 'exception'):
            response = self.request(batch=True, params={'learnerIds': '7,8,9,10'})
            duplicate = self.request(batch=True, params={'learnerIds': '7,7'})
        self.assertEqual(load.call_args_list[0].args, ('coach-a@example.invalid', [7, 8, 9, 10]))
        self.assertEqual(load.call_args_list[1].args, ('coach-a@example.invalid', [7]))
        rows = json.loads(response.content)['results']
        self.assertEqual(rows[0]['activityPlan'], self.plan)
        self.assertTrue(rows[1]['retryable'])
        self.assertFalse(rows[2]['retryable'])
        self.assertFalse(rows[3]['retryable'])
        self.assertTrue(all('activityPlan' not in row for row in rows[1:]))
        self.assertCountEqual([call.args[0].pk for call in counts.call_args_list], [7, 8, 7])
        self.assertEqual(len(json.loads(duplicate.content)['results']), 1)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertNotIn('private failure', response.content.decode())

    def test_worker_releases_connections_and_restores_journal_mode_after_failure(self):
        previous = journal_sources.enabled()
        with patch.object(endpoint, 'close_old_connections') as opened, \
             patch.object(endpoint.connections, 'close_all') as closed, \
             patch.object(endpoint, 'dashboard_activity_facts', side_effect=RuntimeError('synthetic')):
            with self.assertRaises(RuntimeError):
                endpoint._read_plan(self.profile, self.now)
        opened.assert_called_once()
        closed.assert_called_once()
        self.assertEqual(journal_sources.enabled(), previous)

    def test_batch_ownership_failure_does_not_start_workers_or_return_fake_counts(self):
        with patch.object(endpoint, 'activity_plan_profiles', side_effect=RuntimeError('private detail')), \
             patch.object(endpoint, '_read_plan') as read, patch.object(endpoint.log, 'exception'):
            response = self.request(batch=True, params={'learnerIds': '7'})
        self.assertEqual(response.status_code, 503)
        self.assertTrue(json.loads(response.content)['retryable'])
        read.assert_not_called()
        self.assertNotIn('private detail', response.content.decode())
