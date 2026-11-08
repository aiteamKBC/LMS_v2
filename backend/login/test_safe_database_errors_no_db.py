"""Slice 02: password reset and invitation endpoints never return database text.

Database, mail and network are prohibited; every service is mocked and no real
reset or invitation workflow runs.
"""
import json
import logging
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import psycopg
import psycopg.errors
from django.db import DataError, DatabaseError, IntegrityError, InterfaceError, OperationalError, ProgrammingError
from django.test import RequestFactory, SimpleTestCase

from . import errors, permissions, views
from .invitations import TokenError
from .security import PasswordPolicyError

#: Strings a leaked exception could carry; none may reach a response or a log.
SECRETS = (
    'SELECT', 'Created_users', 'login_passwordreset', 'db.internal', '5432',
    'synthetic-secret', 'person@example.test', 'private/path', 'tok-abc123',
)
LEAKY = 'SELECT * FROM "Created_users" host=db.internal port=5432 password=synthetic-secret ' \
        'person@example.test /private/path tok-abc123'

GENERIC = {'error': views.DATABASE_UNAVAILABLE_ERROR}
INVALID_TOKEN = 'This link is invalid or has expired. Please request a new one.'


def database_failures():
    """One instance of every database failure class the endpoints must handle."""
    wrapped = OperationalError(LEAKY)
    wrapped.__cause__ = psycopg.errors.UndefinedColumn(LEAKY)
    return [
        OperationalError(LEAKY), ProgrammingError(LEAKY), IntegrityError(LEAKY),
        DataError(LEAKY), DatabaseError(LEAKY), InterfaceError(LEAKY),
        psycopg.OperationalError(LEAKY), psycopg.errors.UndefinedColumn(LEAKY), wrapped,
    ]


class SafeResponseAssertions(SimpleTestCase):
    factory = RequestFactory()

    def post(self, view, body, *, csrf=True):
        headers = {'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'} if csrf else {}
        request = self.factory.post('/', data=json.dumps(body), content_type='application/json', **headers)
        return view(request)

    def get(self, view, **params):
        return view(self.factory.get('/', params))

    def assert_safe_failure(self, call, operation):
        with self.assertLogs('login.views', level='ERROR') as logs:
            response = call()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(json.loads(response.content), GENERIC)
        self.assertEqual(len(logs.records), 1)
        record = logs.records[0]
        self.assertIsNone(record.exc_info)
        self.assertRegex(record.getMessage(), rf'^Authentication database failure: operation={operation} '
                                              r'type=\w+ sqlstate=(\d{5}|[0-9A-Z]{5}|unknown)$')
        for text in (response.content.decode(), record.getMessage()):
            for secret in SECRETS:
                self.assertNotIn(secret, text)
        return record


class HelperTests(SimpleTestCase):
    def test_sqlstate_comes_from_the_driver_error_or_its_wrapper_only_when_well_formed(self):
        wrapped = OperationalError(LEAKY)
        wrapped.__cause__ = psycopg.errors.UndefinedColumn(LEAKY)
        self.assertEqual(errors.safe_sqlstate(wrapped), '42703')
        self.assertEqual(errors.safe_sqlstate(psycopg.errors.UndefinedColumn(LEAKY)), '42703')
        self.assertEqual(errors.safe_sqlstate(psycopg.OperationalError(LEAKY)), 'unknown')
        for bad in ('4270', '42703; DROP', 'abcde', None, 42703):
            cause = RuntimeError()
            cause.sqlstate = bad
            failure = DatabaseError()
            failure.__cause__ = cause
            self.assertEqual(errors.safe_sqlstate(failure), 'unknown')

    def test_only_allow_listed_context_is_logged_and_never_the_message(self):
        logger = logging.getLogger('login.test_errors')
        with self.assertLogs(logger, level='ERROR') as logs:
            response = errors.database_unavailable(
                'op', OperationalError(LEAKY), message='Try again.', logger=logger, area='Test',
                context={'kind': 'commercial', 'learner_id': 7, 'email': 'person@example.test',
                         'token': 'tok-abc123'})
        self.assertEqual((response.status_code, json.loads(response.content)), (502, {'error': 'Try again.'}))
        self.assertEqual(logs.records[0].getMessage(),
                         'Test database failure: operation=op type=OperationalError sqlstate=unknown '
                         'kind=commercial learner_id=7')

    def test_untrusted_context_values_are_redacted(self):
        logger = logging.getLogger('login.test_errors')
        with self.assertLogs(logger, level='ERROR') as logs:
            errors.database_unavailable('op', DatabaseError(), message='x', logger=logger, area='Test',
                                        context={'kind': 'person@example.test', 'learner_id': '7; DROP'})
        self.assertTrue(logs.records[0].getMessage().endswith('kind=redacted learner_id=redacted'))

    def test_the_classification_is_database_errors_only(self):
        for failure in database_failures():
            self.assertIsInstance(failure, errors.DATABASE_ERRORS)
        for other in (ValueError(), TokenError(), PasswordPolicyError('weak'), RuntimeError(), KeyError()):
            self.assertNotIsInstance(other, errors.DATABASE_ERRORS)

    def test_existing_wrapper_keeps_its_signature_and_contract(self):
        failure = DatabaseError(LEAKY)
        cause = RuntimeError()
        cause.sqlstate = '42703'
        failure.__cause__ = cause
        with self.assertLogs('login.views', level='ERROR') as logs:
            response = views._database_unavailable('login', failure)
        self.assertEqual((response.status_code, json.loads(response.content)), (502, GENERIC))
        self.assertEqual(logs.records[0].getMessage(),
                         'Authentication database failure: operation=login type=DatabaseError sqlstate=42703')


class ForgotPasswordTests(SafeResponseAssertions):
    def setUp(self):
        self.exhausted = self.enterContext(patch.object(views, 'reset_requests_exhausted', return_value=False))
        self.enterContext(patch.object(views, 'record'))

    def call(self, email='person@example.test', **kwargs):
        return self.post(views.forgot_password, {'email': email}, **kwargs)

    def test_every_database_failure_is_the_same_safe_502(self):
        for failure in database_failures():
            with self.subTest(failure=type(failure).__name__), \
                 patch.object(views, 'request_password_link', side_effect=failure):
                self.assert_safe_failure(self.call, 'forgot_password')

    def test_a_failure_in_the_throttle_read_is_handled_the_same_way(self):
        self.exhausted.side_effect = OperationalError(LEAKY)
        self.assert_safe_failure(self.call, 'forgot_password')

    known = SimpleNamespace(subject_type='staff', has_password=True, email='person@example.test', id=1)

    def run_service(self, *, account, failure=None):
        """Run the real request_password_link with its database touchpoints mocked.

        A known address fails where it writes (the reset row); an unknown one
        fails where it reads (the duplicate-account check).
        """
        from learner_api.models import EnrolmentUser
        from . import invitations, models
        learners = MagicMock()
        learners.values_list.return_value.__getitem__.return_value = []
        with patch('login.identity.account_for_email', return_value=account), \
             patch.object(invitations, 'send_reset',
                          side_effect=failure if account is not None else None) as reset, \
             patch.object(models.LoginAccount.objects, 'filter',
                          side_effect=failure if account is None else None,
                          return_value=MagicMock(exists=MagicMock(return_value=False))), \
             patch.object(EnrolmentUser.all_learners, 'filter', return_value=learners):
            if failure is None:
                return self.call(), reset
            responses = []
            self.assert_safe_failure(lambda: responses.append(self.call()) or responses[0], 'forgot_password')
            return responses[0], reset

    def test_known_and_unknown_addresses_fail_with_identical_public_responses(self):
        known_response, reset = self.run_service(account=self.known, failure=IntegrityError(LEAKY))
        reset.assert_called_once()
        unknown_response, _ = self.run_service(account=None, failure=OperationalError(LEAKY))
        self.assertEqual(known_response.status_code, unknown_response.status_code)
        self.assertEqual(known_response.content, unknown_response.content)
        self.assertEqual(json.loads(known_response.content), GENERIC)

    def test_ordinary_success_is_uniform_for_known_and_unknown_addresses(self):
        bodies = []
        for account in (self.known, None):
            response, reset = self.run_service(account=account)
            self.assertEqual(response.status_code, 200)
            bodies.append(json.loads(response.content))
            self.assertEqual(reset.called, account is not None)
        self.assertEqual(bodies[0], bodies[1])
        self.assertEqual(bodies[0]['ok'], True)
        self.assertNotIn('person@example.test', json.dumps(bodies[0]))

    def test_throttled_request_keeps_the_uniform_body(self):
        self.exhausted.return_value = True
        with patch.object(views, 'request_password_link') as service:
            response = self.call()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(json.loads(response.content)['ok'])
        service.assert_not_called()

    def test_validation_and_csrf_are_unchanged(self):
        with patch.object(views, 'request_password_link') as service:
            self.assertEqual(json.loads(self.call('not-an-email').content), {'error': 'Enter a valid email address.'})
            missing = self.call(csrf=False)
            self.assertEqual((missing.status_code, json.loads(missing.content)['code']), (403, 'csrf'))
            bad = views.forgot_password(self.factory.post('/', data='{', content_type='application/json',
                                                          HTTP_X_REQUESTED_WITH='XMLHttpRequest'))
            self.assertEqual(bad.status_code, 400)
        service.assert_not_called()

    def test_programming_defects_still_propagate(self):
        with patch.object(views, 'request_password_link', side_effect=ValueError('bug')):
            with self.assertRaisesRegex(ValueError, 'bug'):
                self.call()


class TokenEndpointTests(SafeResponseAssertions):
    """reset_info, reset_password, invitation_info and accept_invitation_view."""

    cases = (
        ('reset_info', 'peek_reset', 'get'),
        ('invitation_info', 'peek_invitation', 'get'),
        ('reset_password', 'complete_reset', 'post'),
        ('accept_invitation_view', 'accept_invitation', 'post'),
    )
    operations = {'reset_info': 'reset_info', 'invitation_info': 'invitation_info',
                  'reset_password': 'reset_password', 'accept_invitation_view': 'accept_invitation'}

    def call(self, view_name, method, token='tok-abc123', password='Correct-Horse-9'):
        view = getattr(views, view_name)
        if method == 'get':
            return self.get(view, **({'token': token} if token is not None else {}))
        return self.post(view, {'token': token or '', 'password': password})

    def test_every_database_failure_is_the_same_safe_502(self):
        for view_name, service, method in self.cases:
            for failure in database_failures():
                with self.subTest(view=view_name, failure=type(failure).__name__), \
                     patch.object(views, service, side_effect=failure):
                    self.assert_safe_failure(lambda: self.call(view_name, method), self.operations[view_name])

    def test_invalid_or_expired_tokens_keep_their_uniform_400(self):
        for view_name, service, method in self.cases:
            with self.subTest(view=view_name), patch.object(views, service, side_effect=TokenError(INVALID_TOKEN)):
                response = self.call(view_name, method)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(json.loads(response.content), {'error': INVALID_TOKEN, 'code': 'invalid_token'})

    def test_missing_token_and_weak_password_keep_their_responses(self):
        for view_name, service, method in self.cases:
            with self.subTest(view=view_name), patch.object(views, service) as called:
                response = self.call(view_name, method, token=None if method == 'get' else '')
                self.assertEqual(response.status_code, 400)
                self.assertIn('token is required', json.loads(response.content)['error'])
                called.assert_not_called()
        for view_name, service, method in self.cases[2:]:
            with self.subTest(view=view_name), \
                 patch.object(views, service, side_effect=PasswordPolicyError('Use at least 12 characters.')):
                response = self.call(view_name, method)
            self.assertEqual(json.loads(response.content),
                             {'error': 'Use at least 12 characters.', 'code': 'weak_password'})

    def test_valid_tokens_keep_their_success_payloads(self):
        info = {'email': 'learner@example.test', 'displayName': 'Learner', 'expiresAt': '2026-11-09T00:00:00Z'}
        for view_name, service in (('reset_info', 'peek_reset'), ('invitation_info', 'peek_invitation')):
            with self.subTest(view=view_name), patch.object(views, service, return_value=info):
                response = self.call(view_name, 'get')
            self.assertEqual((response.status_code, json.loads(response.content)), (200, info))
        for view_name, service in (('reset_password', 'complete_reset'), ('accept_invitation_view', 'accept_invitation')):
            with self.subTest(view=view_name), patch.object(views, service):
                response = self.call(view_name, 'post')
            self.assertEqual(json.loads(response.content),
                             {'ok': True, 'message': 'Your password has been set. You can now sign in.'})

    def test_post_endpoints_keep_csrf(self):
        for view_name, service, method in self.cases[2:]:
            with self.subTest(view=view_name), patch.object(views, service) as called:
                response = self.post(getattr(views, view_name), {'token': 't', 'password': 'p'}, csrf=False)
            self.assertEqual((response.status_code, json.loads(response.content)['code']), (403, 'csrf'))
            called.assert_not_called()

    def test_programming_defects_still_propagate(self):
        for view_name, service, method in self.cases:
            with self.subTest(view=view_name), patch.object(views, service, side_effect=KeyError('bug')):
                with self.assertRaises(KeyError):
                    self.call(view_name, method)


class InvitationLinkTests(SafeResponseAssertions):
    """The staff-only copy-link endpoint."""

    def call(self, *, account=None, csrf=True):
        def authenticate(request):
            request.login_account = account
            return account

        with patch.object(permissions, 'authenticate_request', side_effect=authenticate):
            return self.post(views.invitation_link_view, {'subjectType': 'learner', 'subjectId': 7}, csrf=csrf)

    staff = SimpleNamespace(role='staff', email='staff@example.test', id=3)

    def test_every_database_failure_is_the_same_safe_502(self):
        for failure in database_failures():
            with self.subTest(failure=type(failure).__name__), \
                 patch.object(views, 'issue_invitation_link', side_effect=failure):
                self.assert_safe_failure(lambda: self.call(account=self.staff), 'invitation_link')

    def test_success_payload_and_no_store_are_unchanged(self):
        outcome = {'link': 'https://lms.example/set-password?token=t', 'expiresAt': '2026-11-09T00:00:00Z',
                   'accountCreated': False, 'error': None, 'forbidden': False}
        with patch.object(views, 'issue_invitation_link', return_value=outcome):
            response = self.call(account=self.staff)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(json.loads(response.content), {'ok': True, 'link': outcome['link'],
                                                        'expiresAt': outcome['expiresAt'], 'accountCreated': False})

    def test_permissions_and_csrf_are_unchanged(self):
        with patch.object(views, 'issue_invitation_link') as service, \
             patch.object(permissions, 'session_unreadable', return_value=False):
            self.assertEqual(self.call(account=None).status_code, 401)
            learner = SimpleNamespace(role='learner', email='l@example.test', id=4)
            forbidden = self.call(account=learner)
            self.assertEqual((forbidden.status_code, json.loads(forbidden.content)['code']), (403, 'forbidden'))
            missing = self.call(account=self.staff, csrf=False)
            self.assertEqual((missing.status_code, json.loads(missing.content)['code']), (403, 'csrf'))
        service.assert_not_called()

    def test_an_unreadable_session_stays_503_not_a_database_502(self):
        with patch.object(views, 'issue_invitation_link') as service, \
             patch.object(permissions, 'session_unreadable', return_value=True):
            response = self.call(account=None)
        self.assertEqual((response.status_code, json.loads(response.content)['code']), (503, 'session_unavailable'))
        service.assert_not_called()

    def test_service_refusals_keep_their_responses(self):
        refusals = (({'link': None, 'error': 'Not allowed.', 'forbidden': True}, 403),
                    ({'link': None, 'error': 'Set-password links can only be copied for learners.',
                      'forbidden': False}, 400))
        for outcome, status in refusals:
            with self.subTest(status=status), patch.object(views, 'issue_invitation_link', return_value=outcome):
                response = self.call(account=self.staff)
            self.assertEqual(response.status_code, status)
            self.assertEqual(json.loads(response.content)['error'], outcome['error'])
