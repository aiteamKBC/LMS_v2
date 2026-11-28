"""Run directly with Python. No database, credentials, network or Microsoft writes.

The Teams calendar write routes refuse every caller without an admin/staff LMS
account -- anonymous, a learner, a tutor, and a Django admin-site session with
no LMS account (which the API gate admits, and which used to be recorded as
"System" with nobody named). The view behind the route never runs for them.
"""
import ast
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
URLS = BACKEND / 'curriculum_api' / 'urls.py'

#: Every Teams route that moves a date, changes who is invited, changes how a
#: meeting runs or creates a meeting, and has no require_role of its own.
GUARDED_ROUTES = {
    'curriculum-module-teams-meeting-restore',
    'curriculum-module-teams-links-replace',
    'curriculum-week-teams-meeting',
    'curriculum-week-teams-meeting-detail',
    'curriculum-live-session-meeting-scope',
    'curriculum-teams-meeting',
    'curriculum-teams-create-draft',
    'curriculum-teams-meeting-schedule',
    'curriculum-teams-meeting-occurrence-schedule',
}


class Response:
    def __init__(self, data, status):
        self.data, self.status_code = data, status


class Account:
    def __init__(self, role):
        self.role = role


def load_guard(account, gate_enabled=True):
    sessions = types.ModuleType('login.sessions')
    sessions.authenticate_request = lambda request: account
    permissions = types.ModuleType('login.permissions')
    permissions._unauthenticated = lambda request=None: Response({'code': 'unauthenticated'}, 401)
    permissions._forbidden = lambda roles: Response({'code': 'forbidden', 'requiredRole': list(roles)}, 403)
    api_gate = types.ModuleType('login.api_gate')
    api_gate._enabled = lambda: gate_enabled
    modules = {'login': types.ModuleType('login'), 'login.sessions': sessions,
               'login.permissions': permissions, 'login.api_gate': api_gate}
    spec = importlib.util.spec_from_file_location('teams_endpoint_guard', BACKEND / 'curriculum_api' / 'teams_endpoint_guard.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, modules


class TeamsEndpointGuardTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)

    def call(self, account, method='PATCH', gate_enabled=True):
        guard, modules = load_guard(account, gate_enabled)
        reached = []

        def view(request, live_session_id):
            reached.append(live_session_id)
            return Response({'updated': True}, 200)

        view.csrf_exempt = True
        wrapped = guard.teams_staff_required(view)
        with patch.dict(sys.modules, modules):
            response = wrapped(types.SimpleNamespace(method=method), 'LIVE-1')
        return response, reached, wrapped

    def test_anonymous_caller_is_refused_and_the_view_never_runs(self):
        for method in ('PATCH', 'POST', 'DELETE', 'GET'):
            with self.subTest(method=method):
                response, reached, _ = self.call(None, method)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(reached, [])

    def test_django_admin_session_without_an_lms_account_is_refused(self):
        # The API gate admits this caller; the guard resolves only LMS accounts.
        response, reached, _ = self.call(None)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(reached, [])

    def test_learner_tutor_and_employer_roles_are_forbidden(self):
        for role in ('learner', 'tutor', 'coach', 'employer', ''):
            with self.subTest(role=role):
                response, reached, _ = self.call(Account(role))
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.data['requiredRole'], ['admin', 'staff'])
                self.assertEqual(reached, [])

    def test_staff_and_admin_reach_the_view(self):
        for role in ('staff', 'admin'):
            with self.subTest(role=role):
                response, reached, _ = self.call(Account(role))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(reached, ['LIVE-1'])

    def test_cors_preflight_is_not_refused(self):
        response, reached, _ = self.call(None, 'OPTIONS')
        self.assertEqual(response.status_code, 200)

    def test_only_a_gate_switched_off_by_configuration_relaxes_it(self):
        # API_REQUIRE_AUTH=0 is set by config.settings for `manage.py test` only.
        response, reached, _ = self.call(None, gate_enabled=False)
        self.assertEqual(response.status_code, 200)

    def test_wrapping_keeps_the_view_csrf_behaviour_unchanged(self):
        _, _, wrapped = self.call(Account('staff'))
        self.assertTrue(getattr(wrapped, 'csrf_exempt', False))
        self.assertTrue(wrapped.teams_staff_required)

    def test_every_teams_write_route_is_wrapped(self):
        tree = ast.parse(URLS.read_text(encoding='utf-8'))
        wrapped, seen = set(), set()
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and getattr(node.func, 'id', '') == 'path'):
                continue
            name = next((kw.value.value for kw in node.keywords if kw.arg == 'name'), '')
            if name not in GUARDED_ROUTES:
                continue
            seen.add(name)
            view = node.args[1]
            if isinstance(view, ast.Call) and getattr(view.func, 'id', '') == 'teams_staff_required':
                wrapped.add(name)
        self.assertEqual(seen, GUARDED_ROUTES)
        self.assertEqual(wrapped, GUARDED_ROUTES)


if __name__ == '__main__':
    unittest.main()
