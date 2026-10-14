"""Profile contract/security regressions: no database or external services."""
import json
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from . import learner_detail as detail


class DashboardProfileTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.source = SimpleNamespace(
            id=265, username='Synthetic Learner', email='learner@example.invalid', phone_number='',
            programme='Example Programme', programme_status='Active', onboarding_status='',
            cohort='', group='', employer='', employer_id=None, organization='',
            learner_type='commercial', aptem_id=None, start_date=None, end_date=None,
            learner_start_date=None, learner_end_date=None, practical_period_end_date=None,
            apprenticeship_end_date=None,
        )
        self.model = MagicMock()
        self.model.all_learners.only.return_value.get.return_value = self.source
        self.stack.enter_context(patch.object(detail, 'SOURCE_MODELS', {'commercial': self.model, 'apprenticeship': self.model}))
        self.gate = self.stack.enter_context(patch.object(detail, 'access_gate', return_value={
            'blocked': True, 'reasons': ['plan'], 'startDate': '', 'outstandingDocuments': []}))
        self.learning = self.stack.enter_context(patch.object(detail, 'learning_access', return_value={'blocked': True, 'startDate': ''}))
        self.stack.enter_context(patch.object(detail, 'programme_status', side_effect=lambda source: source.programme_status))
        self.stack.enter_context(patch.object(detail, '_first_session_unlocked', return_value=False))
        self.graph = self.stack.enter_context(patch.object(detail, 'build_learner_detail', side_effect=AssertionError('full detail loaded')))
        self.stack.enter_context(patch('login.permissions._auth_gate_enabled', return_value=True))
        self.auth = self.stack.enter_context(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=265)))

    def request(self, profile=True, kind='commercial', pk=265, method='get'):
        view = detail.learner_dashboard_profile if profile else detail.learner_summary
        return view(getattr(RequestFactory(), method)('/'), kind=kind, pk=pk)

    def test_legacy_contract_and_profile_values_match(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                old = json.loads(self.request(False, kind).content)
                new = json.loads(self.request(True, kind).content)
                self.assertEqual(set(old) - set(new), {'phone', 'employerId', 'isActive'})
                self.assertEqual(new, {key: value for key, value in old.items() if key in new})
                self.assertEqual(len(new), 19)
                self.assertEqual(new['learnerEndDate'], '')
                self.assertEqual(new['programmeEndDate'], '')
                selected = self.model.all_learners.only.call_args.args
                self.assertIn('learner_end_date', selected)
                self.assertNotIn('phone_number', selected)
                self.assertNotIn('employer_id', selected)
        self.graph.assert_not_called()

    def test_access_and_activity_values_are_not_fabricated(self):
        for blocked in (True, False):
            with self.subTest(blocked=blocked):
                self.gate.return_value = {'blocked': blocked, 'reasons': ['documents'] if blocked else [],
                                          'startDate': '2026-10-01', 'outstandingDocuments': ['ILR'] if blocked else []}
                self.learning.return_value = {'blocked': blocked, 'startDate': '2026-10-01'}
                self.source.aptem_id = '123' if blocked else None
                body = json.loads(self.request().content)
                self.assertEqual(body['accessGate'], self.gate.return_value)
                self.assertEqual(body['learningAccess'], self.learning.return_value)
                self.assertEqual(body['studentActivityAvailable'], blocked)

    def test_authentication_and_ownership_for_both_routes(self):
        for profile in (False, True):
            for account, expected in ((None, 401), (SimpleNamespace(role='learner', subject_id=266), 404),
                                      (SimpleNamespace(role='employer'), 403),
                                      (SimpleNamespace(role='staff'), 200), (SimpleNamespace(role='admin'), 200),
                                      (SimpleNamespace(role='learner', subject_id=265), 200)):
                with self.subTest(profile=profile, account=account):
                    self.auth.return_value = account
                    self.assertEqual(self.request(profile).status_code, expected)

    def test_routes_and_invalid_inputs(self):
        self.assertIs(resolve('/learner_api/learner-summary/commercial/265/').func, detail.learner_summary)
        self.assertIs(resolve('/learner_api/dashboard/commercial/265/profile/').func, detail.learner_dashboard_profile)
        self.assertEqual(self.request(kind='unknown').status_code, 404)
        self.assertEqual(self.request(method='post').status_code, 405)
