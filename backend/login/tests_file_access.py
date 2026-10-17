"""Upload session recovery tests: no real database, storage or user sessions."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError, InterfaceError, OperationalError
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase

from .middleware import LoginSessionMiddleware, _authenticate_with_file_retry
from .sessions import session_unreadable


class UploadSessionRecoveryTests(SimpleTestCase):
    def setUp(self):
        self.request = RequestFactory().get('/curriculum_api/curriculum/uploads/MOD/COMP/reading.docx')
        self.connection = MagicMock(in_atomic_block=False)
        self.connections = patch('login.middleware.connections', {'enrolment': self.connection})
        self.connections.start()
        self.addCleanup(self.connections.stop)
        self.route = patch('login.middleware.router.db_for_read', return_value='enrolment').start()
        self.addCleanup(patch.stopall)

    def test_read_reconnects_once_and_rechecks_identity(self):
        account = SimpleNamespace(role='learner')
        for error in (OperationalError, InterfaceError):
            with self.subTest(error=error), patch('login.middleware.authenticate_request',
                    side_effect=[error('connection closed'), account]) as auth:
                self.assertIs(_authenticate_with_file_retry(self.request), account)
                self.assertEqual(auth.call_count, 2)
        self.assertEqual(self.connection.close.call_count, 2)

    def test_repeated_failure_remains_unreadable_and_cannot_admit_view(self):
        def gate(request):
            return HttpResponse(status=503 if session_unreadable(request) else 200)
        with patch('login.middleware.authenticate_request', side_effect=OperationalError('offline')) as auth, \
                patch('login.middleware.close_old_connections'), \
                patch('login.middleware.refresh_session_cookie'):
            response = LoginSessionMiddleware(gate)(self.request)
        self.assertEqual(response.status_code, 503)
        self.assertTrue(session_unreadable(self.request))
        self.assertIsNone(self.request.login_account)
        self.assertEqual(auth.call_count, 2)

    def test_revoked_or_missing_session_after_reconnect_is_still_anonymous(self):
        with patch('login.middleware.authenticate_request', side_effect=[OperationalError(), None]) as auth:
            self.assertIsNone(_authenticate_with_file_retry(self.request))
        self.assertEqual(auth.call_count, 2)

    def test_normal_read_does_not_reconnect(self):
        with patch('login.middleware.authenticate_request', return_value=None) as auth:
            self.assertIsNone(_authenticate_with_file_retry(self.request))
        auth.assert_called_once_with(self.request)
        self.connection.close.assert_not_called()

    def test_range_and_head_requests_keep_their_original_parameters(self):
        for method in ('GET', 'HEAD'):
            request = RequestFactory().generic(method, self.request.path, HTTP_RANGE='bytes=10-99')
            with self.subTest(method=method), patch('login.middleware.authenticate_request',
                    side_effect=[OperationalError(), None]) as auth:
                self.assertIsNone(_authenticate_with_file_retry(request))
                self.assertEqual(auth.call_args_list[0], auth.call_args_list[1])
                self.assertEqual(request.META['HTTP_RANGE'], 'bytes=10-99')
                self.assertEqual(request.method, method)

    def test_writes_and_unrelated_gets_are_never_retried(self):
        for method, path in [('POST', self.request.path),
                             ('GET', '/curriculum_api/curriculum/overview/'),
                             ('GET', '/learner_api/components/1/complete/')]:
            request = RequestFactory().generic(method, path)
            with self.subTest(method=method, path=path), \
                    patch('login.middleware.authenticate_request', side_effect=OperationalError()) as auth:
                with self.assertRaises(OperationalError):
                    _authenticate_with_file_retry(request)
                auth.assert_called_once()
        self.connection.close.assert_not_called()

    def test_renewal_failure_is_not_retried_or_admitted(self):
        def failed_renewal(request):
            request.login_account = SimpleNamespace(role='staff')
            raise OperationalError('renewal failed')
        with patch('login.middleware.authenticate_request', side_effect=failed_renewal) as auth:
            with self.assertRaises(OperationalError):
                _authenticate_with_file_retry(self.request)
        auth.assert_called_once()
        self.connection.close.assert_not_called()

    def test_transaction_or_non_connection_failure_is_not_retried(self):
        for atomic, error in [(True, OperationalError()), (False, DatabaseError())]:
            self.connection.in_atomic_block = atomic
            with self.subTest(atomic=atomic), patch('login.middleware.authenticate_request', side_effect=error) as auth:
                with self.assertRaises(DatabaseError):
                    _authenticate_with_file_retry(self.request)
                auth.assert_called_once()
        self.connection.close.assert_not_called()
