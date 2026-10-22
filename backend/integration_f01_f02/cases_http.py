"""Real URL resolution/middleware cases. Not collected by ordinary test discovery."""
import unittest
from unittest.mock import patch
from .bootstrap import require_active
from .fixtures import Fixtures, PASSWORD, PNG

RUN_ID = None


class HttpCases(unittest.TestCase):
    def setUp(self):
        require_active()
        from django.test import Client
        self.f = Fixtures(RUN_ID)
        self.client = Client(enforce_csrf_checks=True)
        self.addCleanup(self.f.cleanup)

    def as_account(self, account, state='active'):
        from django.test import Client
        client = Client(enforce_csrf_checks=True)
        _, token = self.f.session(account, state)
        client.cookies['kbc_session'] = token
        return client

    def send(self, client, method, path, data=None):
        kwargs = {'content_type': 'application/json', 'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'}
        if 'csrftoken' in client.cookies:
            kwargs['HTTP_X_CSRFTOKEN'] = client.cookies['csrftoken'].value
        response = getattr(client, method)(path, data=data or {}, **kwargs)
        self.assertIn('application/json', response.headers.get('Content-Type', ''))
        return response

    def test_login_cookie_refresh_logout_and_invalid_session(self):
        learner = self.f.learner()
        response = self.send(self.client, 'post', '/login_api/login/',
                             {'email': learner.account.email, 'password': PASSWORD, 'remember': True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['subjectId'], learner.source.pk)
        self.assertTrue(response.cookies['kbc_session']['httponly'])
        self.assertEqual(self.client.get('/login_api/me/').status_code, 200)
        self.assertEqual(self.send(self.client, 'post', '/login_api/logout/').status_code, 200)
        self.assertEqual(self.client.get('/login_api/me/').status_code, 401)

    def test_expired_and_revoked_sessions(self):
        learner = self.f.learner()
        for state in ('expired', 'revoked'):
            with self.subTest(state=state):
                self.assertEqual(self.as_account(learner.account, state).get('/login_api/me/').status_code, 401)

    def test_temporary_session_failure_preserves_cookie_then_retry(self):
        from django.db import OperationalError
        learner = self.f.learner()
        client = self.as_account(learner.account)
        token = client.cookies['kbc_session'].value
        # Inject only the storage failure seam. Real middleware still handles it.
        with patch('login.middleware.authenticate_request', side_effect=OperationalError('synthetic outage')):
            response = client.get('/learner_api/learning-plan/%s/' % learner.source.pk)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(client.cookies['kbc_session'].value, token)
        self.assertEqual(client.get('/login_api/me/').status_code, 200)

    def test_owner_get_patch_put_and_cross_owner_denial(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                own, other = self.f.learner(kind), self.f.learner(kind)
                client = self.as_account(own.account)
                path = f'/learner_api/learning-plan/{own.source.pk}/'
                self.assertEqual(client.get(path).status_code, 200)
                for method in ('patch', 'put'):
                    response = self.send(client, method, path, {'modules': []})
                    self.assertEqual(response.status_code, 200)
                    self.assertNotIn('error', response.json())
                    denied = self.send(client, method, f'/learner_api/learning-plan/{other.source.pk}/', {'modules': []})
                    self.assertEqual(denied.status_code, 404)
                other.source.refresh_from_db(using='enrolment')
                self.assertEqual(other.source.learning_plan, [])

    def test_staff_primary_additional_combined_and_revoked_grants(self):
        learner = self.f.learner()
        # The enrolment gate owns Access/Access_extra. Learning-plan reads
        # intentionally allow staff by role and are not a grant-revocation probe.
        path = f'/enrolment_api/commercial-users/{learner.source.pk}/board/'
        for primary, extra in [('enrolment', ''), ('coach', 'enrolment'), ('enrolment', 'coach')]:
            with self.subTest(primary=primary, additional=extra):
                staff, account = self.f.staff(primary, extra)
                client = self.as_account(account)
                self.assertEqual(client.get(path).status_code, 200)
                staff.access = ''
                staff.access_extra = ''
                staff.save(using='enrolment', update_fields=['access', 'access_extra'])
                response = client.get(path)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json(), {'error': 'Not found.'})

    def test_first_login_csrf_ownership_completion_and_onboarding(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                learner, unrelated = self.f.learner(kind), self.f.learner(kind)
                client = self.as_account(learner.account)
                path = f'/learner_api/first-login-details/{learner.source.pk}/'
                initial = client.get(path)
                self.assertEqual(initial.status_code, 200)
                self.assertTrue(initial.json()['required'], 'Provision required first-login columns; do not accept silent fallback')
                self.assertEqual(client.get(f'/learner_api/first-login-details/{unrelated.source.pk}/').status_code, 404)
                self.assertEqual(client.post(path, {}, content_type='application/json').status_code, 403)
                data = {'title': 'Mr', 'dateOfBirth': '2000-05-17', 'phone': '07700900123',
                        'country': 'United Kingdom', 'postcode': 'CT11AA', 'addressLine1': '1 Synthetic Street',
                        'addressLine2': '', 'townCity': 'Canterbury', 'county': 'Kent', 'signature': PNG}
                self.assertEqual(self.send(client, 'post', path, data).status_code, 200)
                self.assertFalse(client.get(path).json()['required'])
                learner.source.refresh_from_db(using='enrolment')
                self.assertEqual(learner.source.programme_status, 'Onboarding')

    def test_curriculum_assignment_and_unassignment_contract(self):
        module = self.f.catalogue()
        learner = self.f.learner()
        _, account = self.f.staff('curriculum')
        from django.urls import reverse
        path = reverse('curriculum-module-learner-assignments', kwargs={'identifier': module.pk})
        client = self.as_account(account)
        for method in ('post', 'delete'):
            response = self.send(client, method, path, {'learnerIds': [learner.source.pk]})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['failedIds'], [])
            self.assertEqual(response.json()['assignedCount'], 1)
        self.assertEqual(self.send(self.as_account(learner.account), 'post', path,
                                  {'learnerIds': [learner.source.pk]}).status_code, 403)

    def test_document_issue_sign_withdraw_and_employer_permissions(self):
        employer, employer_account = self.f.employer()
        _, outsider = self.f.employer()
        learner = self.f.learner('apprenticeship', employer=employer)
        _, staff = self.f.staff()
        path = f'/learner_api/training-plan-document/{learner.source.pk}/'
        provider = self.as_account(staff)
        self.assertEqual(self.send(provider, 'post', path+'issue/').status_code, 200)
        from learner_api.models import TrainingPlanDocument
        document = TrainingPlanDocument.objects.using('enrolment').get(learner_id=learner.source.pk, status='active')
        self.f.receipts.append((TrainingPlanDocument, document.pk))
        frozen = document.programme
        self.assertEqual(self.send(self.as_account(outsider), 'post', path+'sign/',
                                  {'party': 'employer', 'signature': PNG}).status_code, 404)
        for account, party in [(learner.account, 'apprentice'), (employer_account, 'employer'), (staff, 'provider')]:
            response = self.send(self.as_account(account), 'post', path+'sign/',
                                 {'party': party, 'signature': PNG, 'name': self.f.namespace, 'position': 'Synthetic'})
            self.assertEqual(response.status_code, 200)
        document.refresh_from_db(using='enrolment')
        self.assertTrue(document.fully_signed)
        response = self.send(self.as_account(learner.account), 'post', path+'sign/', {'party': 'apprentice', 'signature': ''})
        self.assertEqual(response.status_code, 200)
        document.refresh_from_db(using='enrolment')
        self.assertEqual(document.programme, frozen)
        self.assertFalse(document.apprentice_signature)
        self.assertTrue(document.employer_signature)
        self.assertTrue(document.provider_signature)
