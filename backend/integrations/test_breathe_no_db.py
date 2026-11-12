"""Integration regressions with mocked persistence and HTTP; no database required."""
import io
import json
from contextlib import ExitStack, nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.http import JsonResponse
from django.middleware.csrf import CsrfViewMiddleware
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import resolve

from .breathe import BreatheApiError, BreatheClient
from .permissions import integration_access
from .services import api_key_for, encrypt_api_key, process_sync_run
from .signatories import employer_can_sign_progress_review
from .views import create_connection, create_signatory_grant, csrf_token
# CI discovers *_no_db.py; retain the original feature cases there too.
from .tests import (BreatheClientTests, NormalizerTests, SchedulingConflictTests,
                    ServiceSignatureTests, SignatoryGrantTests, _Response)


class BreatheTransportSafetyTests(SimpleTestCase):
    def test_rejects_untrusted_base_origins_before_http(self):
        for url in ['http://api.breathehr.com', 'https://example.test',
                    'https://api.breathehr.com/path', 'https://api.breathehr.com@evil.test',
                    'https://api.breathehr.com:bad']:
            with self.subTest(url=url), self.assertRaises(BreatheApiError):
                BreatheClient(url, 'sandbox-test')

    def test_external_pagination_never_receives_the_key(self):
        session = Mock()
        session.request.return_value = _Response(payload={'employees': []}, headers={
            'Link': '<https://example.test/collect>; rel="next"'})
        with self.assertRaises(BreatheApiError):
            list(BreatheClient('https://api.breathehr.com', 'sandbox-test', session=session).list_resource('employees'))
        self.assertEqual(session.request.call_count, 1)
        self.assertFalse(session.request.call_args.kwargs['allow_redirects'])

    def test_redirect_is_not_followed_or_reported_as_success(self):
        session = Mock()
        session.request.return_value = _Response(status_code=302, payload={'id': 'fake'}, headers={'Location': 'https://example.test'})
        with self.assertRaises(BreatheApiError):
            BreatheClient('https://api.breathehr.com', 'sandbox-test', session=session).account()
        self.assertEqual(session.request.call_count, 1)

    def test_actual_account_envelope_is_unwrapped(self):
        session = Mock()
        session.request.return_value = _Response(payload={'account': {'id': 42}})
        self.assertEqual(BreatheClient('https://api.breathehr.com', 'sandbox-test', session=session).account(), {'id': 42})

    def test_repeated_next_page_stops(self):
        session = Mock()
        session.request.return_value = _Response(payload={'employees': []}, headers={'Link': '</v1/employees?page=2>; rel="next"'})
        with self.assertRaises(BreatheApiError):
            list(BreatheClient('https://api.breathehr.com', 'sandbox-test', session=session).list_resource('employees'))
        self.assertEqual(session.request.call_count, 2)


class SecretReferenceTests(SimpleTestCase):
    @patch.dict('os.environ', {'CREDENTIAL_ENCRYPTION_KEY': 'company-key'}, clear=False)
    def test_company_api_key_is_encrypted_and_resolved_without_plaintext_storage(self):
        ciphertext = encrypt_api_key('company-api-key')
        self.assertNotIn('company-api-key', ciphertext)
        self.assertEqual(api_key_for(SimpleNamespace(secret_ref='encrypted', secret_ciphertext=ciphertext)), 'company-api-key')

    def test_unrelated_environment_secret_cannot_be_selected(self):
        with self.assertRaises(BreatheApiError):
            api_key_for(SimpleNamespace(secret_ref='env:DJANGO_SECRET_KEY'))

    @patch.dict('os.environ', {'BREATHE_API_KEY_UNIT': 'sandbox-test'})
    def test_only_breathe_environment_names_are_resolved(self):
        self.assertEqual(api_key_for(SimpleNamespace(secret_ref='env:BREATHE_API_KEY_UNIT')), 'sandbox-test')


class ConnectorIsolationTests(SimpleTestCase):
    @override_settings(BREATHE_INTEGRATIONS_ENABLED=False)
    @patch('integrations.permissions.authenticate_request')
    def test_forwarded_and_legacy_routes_share_the_disabled_gate(self, authenticate):
        for prefix in ['/login_api/hr-integrations', '/integrations_api']:
            path = prefix + '/breathe/connections'
            response = resolve(path).func(RequestFactory().get(path))
            self.assertEqual(response.status_code, 503)
            self.assertEqual(json.loads(response.content)['code'], 'breathe_not_enabled')
        authenticate.assert_not_called()

    def test_only_the_new_integration_subtree_uses_its_own_session_or_hmac_gate(self):
        from login.api_gate import rule_for
        self.assertIsNone(rule_for('/login_api/hr-integrations/breathe/connections'))
        self.assertIsNotNone(rule_for('/learner_api/learners/'))

    @override_settings(BREATHE_INTEGRATIONS_ENABLED=False)
    @patch('integrations.permissions.authenticate_request')
    def test_disabled_connector_does_not_touch_auth_or_database(self, authenticate):
        view = integration_access()(lambda request: JsonResponse({'should_not_run': True}))
        response = view(RequestFactory().get('/integrations_api/breathe/connections'))
        self.assertEqual(response.status_code, 503)
        authenticate.assert_not_called()

    @override_settings(BREATHE_INTEGRATIONS_ENABLED=True)
    @patch('integrations.permissions.authenticate_request')
    def test_signatory_mutation_is_not_available_to_employers(self, authenticate):
        authenticate.return_value = SimpleNamespace(role='employer', subject_type='employer')
        response = create_signatory_grant(RequestFactory().post('/integration'), 'tenant')
        self.assertEqual(response.status_code, 403)

    @override_settings(BREATHE_INTEGRATIONS_ENABLED=True)
    @patch('integrations.permissions.authenticate_request')
    def test_standard_csrf_rejects_missing_token_and_accepts_issued_token(self, authenticate):
        authenticate.return_value = SimpleNamespace(role='admin')
        factory = RequestFactory()
        token_request = factory.get('/integrations_api/breathe/csrf')
        token = json.loads(csrf_token(token_request).content)['csrfToken']
        middleware = CsrfViewMiddleware(lambda request: JsonResponse({}))
        missing = factory.post('/integrations_api/breathe/connections/create', '{}', content_type='application/json')
        self.assertEqual(middleware.process_view(missing, create_connection, (), {}).status_code, 403)
        valid = factory.post('/integrations_api/breathe/connections/create', '{}', content_type='application/json', HTTP_X_CSRFTOKEN=token)
        valid.COOKIES['csrftoken'] = token_request.META['CSRF_COOKIE']
        self.assertIsNone(middleware.process_view(valid, create_connection, (), {}))

    @override_settings(BREATHE_INTEGRATIONS_ENABLED=True)
    @patch('integrations.views.IntegrationTenant')
    @patch('integrations.permissions.authenticate_request')
    def test_bad_origin_is_rejected_before_tenant_creation(self, authenticate, tenants):
        authenticate.return_value = SimpleNamespace(role='admin')
        request = RequestFactory().post('/integration', json.dumps({
            'tenant_key': 'demo', 'external_account_id': '42',
            'secret_ref': 'env:BREATHE_API_KEY_UNIT', 'base_url': 'https://example.test',
        }), content_type='application/json')
        self.assertEqual(create_connection(request).status_code, 400)
        tenants.objects.get_or_create.assert_not_called()

    @patch('integrations.signatories.IntegrationTenant')
    def test_grant_lookup_failure_never_grants_signing(self, tenants):
        tenants.objects.filter.side_effect = DatabaseError('unavailable')
        self.assertFalse(employer_can_sign_progress_review(SimpleNamespace(role='employer', subject_id=7)))


class RetentionPreviewTests(SimpleTestCase):
    def test_dry_run_counts_but_never_deletes_or_deactivates(self):
        from .management.commands import purge_breathe_integration_data as module
        tenant = SimpleNamespace(id='tenant', save=Mock())
        queries = []
        with ExitStack() as stack:
            tenants = stack.enter_context(patch.object(module, 'IntegrationTenant'))
            tenants.objects.filter.return_value = [tenant]
            for name in ['AvailabilityBlock', 'DepartmentMapping', 'ExternalPersonLink',
                         'ExternalTrainingRecord', 'ManagerRelationship', 'ManagerSignatoryGrant',
                         'SchedulingConflict', 'IntegrationSyncRun', 'IntegrationConnection']:
                model = stack.enter_context(patch.object(module, name))
                query = model.objects.filter.return_value
                query.count.return_value = 2
                queries.append(query)
            output = io.StringIO()
            module.Command(stdout=output).handle(dry_run=True)
        self.assertIn('Would purge 18', output.getvalue())
        tenant.save.assert_not_called()
        for query in queries:
            query.delete.assert_not_called()


class SyncHealthTests(SimpleTestCase):
    def execute(self, *, dry_run=False, failure=False, wrong_account=False):
        run = SimpleNamespace(connection_id='connection', resources=['employees'], dry_run=dry_run, save=Mock())
        connection = SimpleNamespace(external_account_id='42', save=Mock())
        client = Mock()
        client.account.return_value = {'id': 99 if wrong_account else 42}
        client.list_resource.return_value = [{'id': 'demo'}]
        if failure:
            client.list_resource.side_effect = BreatheApiError('Provider unavailable', status=503)
        with patch('integrations.services.IntegrationSyncRun') as runs, \
                patch('integrations.services.IntegrationConnection') as connections, \
                patch('integrations.services.transaction.atomic', return_value=nullcontext()), \
                patch('integrations.company_training.apply_rules'), \
                patch('integrations.services._save_employees', return_value=1) as save_employees:
            runs.objects.get.return_value = run
            connections.objects.get.return_value = connection
            if failure or wrong_account:
                with self.assertRaises(BreatheApiError):
                    process_sync_run('run', client=client)
            else:
                process_sync_run('run', client=client)
        return run, connection, save_employees

    def test_completed_import_updates_connection_health(self):
        run, connection, _ = self.execute()
        self.assertEqual(run.status, 'completed')
        self.assertEqual(connection.status, 'active')
        self.assertEqual(connection.last_sync_at, run.finished_at)
        self.assertEqual(connection.last_verified_at, run.finished_at)
        self.assertEqual(connection.last_error, '')

    def test_failed_import_sets_attention(self):
        run, connection, save = self.execute(failure=True)
        self.assertEqual(run.status, 'failed')
        self.assertEqual(connection.status, 'attention')
        save.assert_not_called()

    def test_dry_run_does_not_write_projections_or_claim_a_live_sync(self):
        run, connection, save = self.execute(dry_run=True)
        self.assertEqual(run.counts, {'employees': 1})
        connection.save.assert_not_called()
        save.assert_not_called()

    def test_different_account_is_rejected_before_importing_people(self):
        run, connection, save = self.execute(wrong_account=True)
        self.assertEqual(run.status, 'failed')
        self.assertEqual(connection.status, 'attention')
        save.assert_not_called()
