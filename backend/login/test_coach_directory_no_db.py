"""Run directly with Python; no database, network, or production settings loaded."""
import json
import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
if not settings.configured:
    settings.configure(INSTALLED_APPS=['login'], DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}, SECRET_KEY='isolated-test', DEFAULT_CHARSET='utf-8')
import django
django.setup()
from django.test import RequestFactory
from login import coach_directory as views


class DirectoryTests(unittest.TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.cursor = MagicMock()
        self.connection = MagicMock()
        self.connection.cursor.return_value.__enter__.return_value = self.cursor
        self.stack = []
        for target, value in [('login.coach_directory.connections', {'enrolment': self.connection}),
                              ('login.coach_directory.transaction.atomic', lambda **kw: nullcontext()),
                              ('socket.socket', MagicMock(side_effect=AssertionError('No network allowed')))]:
            mock = patch(target, value); mock.start(); self.addCleanup(mock.stop)

    def request(self, method='post', data=None, role='admin', ajax=True, pk=None):
        req = self.factory.generic(method.upper(), '/login_api/admin/coach-directory/', data=json.dumps(data or {}), content_type='application/json', **({'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'} if ajax else {}))
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role=role) if role else None):
            return views.directory(req, pk)

    def test_only_admin_can_manage_even_when_request_claims_admin(self):
        for role in (None, 'learner', 'staff', 'employer'):
            for method in ('get', 'post', 'put', 'delete'):
                response = self.request(method, {'role': 'admin'}, role=role)
                self.assertIn(response.status_code, (401, 403))
        self.connection.cursor.assert_not_called()

    def test_csrf_header_required(self):
        self.assertEqual(self.request(ajax=False).status_code, 403)
        self.connection.cursor.assert_not_called()

    def test_public_get_only_and_only_public_fields(self):
        self.cursor.fetchall.return_value = [(1, 'Example Coach', 'example', '{}', 2)]
        response = views.public_coach(self.factory.get('/'), 'example')
        self.assertEqual(set(json.loads(response.content)), {'name', 'slug', 'links'})
        self.assertEqual(views.public_coach(self.factory.post('/'), 'example').status_code, 405)
        self.cursor.fetchall.return_value = []
        self.assertEqual(views.public_coach(self.factory.get('/'), 'missing').status_code, 404)

    def test_reject_unsafe_urls_and_accept_blank_optional_links(self):
        for url in ('javascript:alert(1)', 'data:text/html,test', '//example.org', 'https://user:pass@example.org', 'https://example.org:bad', 'https://example.org/ bad', 'https://example.org\\x'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                views.validated({'name': 'Example Coach', 'links': {'first_session': url}})
        name, links = views.validated({'name': ' Example Coach ', 'links': {'first_session': 'https://example.org/book'}})
        self.assertEqual(name, 'Example Coach')
        self.assertEqual(links['support_session'], '')

    def test_create_and_edit_preserve_stable_page_slug(self):
        self.cursor.fetchall.return_value = [(1, 'Example Coach', 'example-coach', {}, 1)]
        self.assertEqual(self.request(data={'name': 'Example Coach', 'links': {}}).status_code, 201)
        self.assertEqual(self.request('put', {'name': 'Renamed Coach', 'links': {}, 'version': 1}, pk=1).status_code, 200)
        sql, params = self.cursor.execute.call_args.args
        self.assertNotIn('slug=', sql)
        self.assertEqual(params[-2:], [1, 1])

    def test_stale_edit_and_delete_are_not_silent_successes(self):
        self.cursor.fetchall.return_value = []
        self.cursor.fetchone.return_value = None
        self.assertEqual(self.request('put', {'name': 'Example', 'version': 1}, pk=1).status_code, 409)
        self.assertEqual(self.request('delete', {'version': 1}, pk=1).status_code, 409)
        self.assertEqual(self.request('delete', {}, pk=1).status_code, 400)


if __name__ == '__main__':
    unittest.main()
