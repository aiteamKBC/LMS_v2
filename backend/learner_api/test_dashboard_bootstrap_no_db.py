"""Bootstrap identity/permission parity without presentation or database I/O."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase, RequestFactory
from django.db import DatabaseError
from . import dashboard_header as header


class BootstrapTests(SimpleTestCase):
    def test_bootstrap_module_query_excludes_contact_join(self):
        cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(header, 'connections', {'enrolment': connection}), \
             patch.object(header, '_effective_plan_ids', return_value=['M']), \
             patch.object(header.canonical_learning, 'curriculum_module_ids_for', return_value=[]), \
             patch.object(header, 'rows', return_value=[]):
            header.dashboard_modules(object(), {}, include_coach=False)
        sql, params = cursor.execute.call_args.args
        self.assertNotIn('coach_name', sql)
        self.assertNotIn('curriculum.groups', sql)
        self.assertEqual(params, [['M']])

    def test_canonical_routes_do_not_require_or_obey_legacy_version_negotiation(self):
        from django.urls import resolve
        for path, flag in [('header/presentation/', 'presentation'), ('monthly/plan/', 'canonical_contract')]:
            route = resolve('/learner_api/dashboard/commercial/7/' + path)
            self.assertIs(route.kwargs[flag], True)

    def test_all_weekly_routes_use_one_view_without_format_flags(self):
        from django.urls import resolve
        from .dashboard_weekly import dashboard_weekly
        for path in ('weekly/plan/', 'weekly/plan/slot:M:1/', 'weekly/', 'weekly/slot:M:1/'):
            route = resolve('/learner_api/dashboard/commercial/7/' + path)
            self.assertIs(route.func, dashboard_weekly)
            self.assertNotIn('canonical', route.kwargs)

    def test_canonical_monthly_dispatch_uses_same_authorized_calculations(self):
        from . import dashboard_tabs, dashboard_monthly, identity
        source = SimpleNamespace(pk=7)
        with patch.object(dashboard_tabs.canonical, 'require_profile', return_value={'id': 9}), \
             patch.object(identity, 'learner_profile_for_source', return_value=SimpleNamespace(pk=9, enrolment_id=7)), \
             patch.object(dashboard_monthly, 'read_monthly', return_value={'version': 2}) as read:
            result = dashboard_tabs.read_tab(source, 'commercial', 'monthly', RequestFactory().get('/?version=1'), canonical_contract=True)
        self.assertEqual(result, {'version': 2})
        self.assertTrue(read.call_args.kwargs['canonical_contract'])

    def test_only_identity_and_navigation_are_built(self):
        source = SimpleNamespace(programme='P', cohort='C', group='G')
        identity = {'id': '7', 'programmeStatus': 'Active', 'programmeStartDate': '2026-10-01'}
        module = {'id': 'M', 'title': 'Module', 'start_date': '2026-10-01', 'end_date': '2026-10-31',
                  'sessions_number': 1, 'week_count': 1}
        with patch.object(header, 'header_identity', return_value=identity), \
             patch.object(header, 'header_profile', return_value=(object(), {'id': 9})), \
             patch.object(header, 'dashboard_modules', return_value=(['M'], [module])), \
             patch.object(header, 'plan_reviews', side_effect=AssertionError('No reviews')), \
             patch.object(header, 'header_sessions', side_effect=AssertionError('No sessions')), \
             patch.object(header, 'upcoming_assignment_deadlines', side_effect=AssertionError('No assignments')):
            result = header.build_dashboard_bootstrap(source, 7)
        self.assertEqual(result, {'learner': identity, 'weeklyCandidates': header.weekly_header_candidates([module], source)})

    def test_fresh_learner_does_not_read_delivery_identity_or_tables(self):
        with patch.object(header, 'header_identity', return_value={'programmeStatus': 'Fresh user'}), \
             patch.object(header, 'header_profile', side_effect=AssertionError('No delivery read')):
            self.assertEqual(header.build_dashboard_bootstrap(object(), 7)['weeklyCandidates'], [])

    def test_authorization_and_failures_are_shared_with_header_for_both_kinds(self):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        for kind in ('commercial', 'apprenticeship'):
            for account, status in [(SimpleNamespace(role='learner', subject_id=7), 200),
                                    (SimpleNamespace(role='staff', subject_id=1), 200),
                                    (SimpleNamespace(role='learner', subject_id=8), 404),
                                    (SimpleNamespace(role='employer', subject_id=7), 403), (None, 401)]:
                with self.subTest(kind=kind, status=status), \
                     patch('login.permissions.authenticate_request', return_value=account), \
                     patch.dict(header.SOURCE_MODELS, {kind: model}), \
                     patch.object(header, 'read_header_source') as read, \
                     patch.object(header, 'build_dashboard_bootstrap', return_value={'learner': {'id': '7'}, 'weeklyCandidates': []}):
                    request = RequestFactory().get('/')
                    request.login_account = account
                    response = header.dashboard_bootstrap(request, kind=kind, pk=7)
                    self.assertEqual(response.status_code, status)
                    self.assertEqual(read.call_count, int(status == 200))
        with patch.object(header, 'read_header_source', side_effect=DatabaseError('private')), \
             patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')):
            response = header.dashboard_bootstrap(RequestFactory().get('/'), 'commercial', 7)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(b'private', response.content)

    def test_presentation_route_drops_duplicate_identity_and_version_fields(self):
        request = RequestFactory().get('/')
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
             patch.object(header, 'read_header_source'), patch.object(header, 'build_dashboard_header'), \
             patch.object(header, 'compact_header', return_value={'version': 2, 'learner': {}, 'weeklyCandidates': [], 'nextReview': None}):
            result = header.dashboard_header(request, 'commercial', 7, presentation=True)
        self.assertJSONEqual(result.content, {'nextReview': None})
        self.assertEqual(result['Vary'], 'Cookie')
