"""Entry integration: no database writes or production learner data."""
import json
from unittest.mock import patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase, override_settings

from . import entry, repository as repo, service
from .tests import account


@override_settings(OLD_OTJH_ENABLED=True)
class LearnerEntryTests(SimpleTestCase):
    def setUp(self):
        self.user = account()
        self.student = patch.object(repo, 'student', return_value={'id': 7, 'aptem_id': '42'}).start()
        self.resolve = patch.object(service, 'resolve_authenticated_learner', return_value={'id': 7, 'aptem_id': 42}).start()
        self.summary = patch.object(service, 'summary', return_value={'can_access_lms': False, 'total_months': 2, 'completed_months': 0}).start()
        self.addCleanup(patch.stopall)

    def response(self, suffix=''):
        request = RequestFactory().get('/login_api/learner-entry/' + suffix)
        request.login_account = self.user
        return entry.entry_status(request)

    def test_existing_unsigned_learner_opens_the_lms_without_signing(self):
        # Signing the previous record is optional; it does not gate entry.
        body = json.loads(self.response().content)
        self.assertEqual(body['classification'], 'existing')
        self.assertFalse(body['required'])
        self.assertTrue(body['canAccess'])
        self.assertEqual(body['reviewHref'], '/old-otjh/months')
        self.summary.assert_not_called()

    def test_empty_aptem_conventions_do_not_invoke_signing(self):
        for value in (None, '', ' ', '\t\r\n'):
            with self.subTest(value=value):
                self.student.return_value = {'id': 7, 'aptem_id': value}
                body = json.loads(self.response().content)
                self.assertEqual(body['classification'], 'new')
                self.assertTrue(body['canAccess'])
                self.assertFalse(body['required'])
        self.resolve.assert_not_called()
        self.summary.assert_not_called()

    def test_missing_incomplete_and_failed_profiles_fail_closed(self):
        for value in (None, {'id': 7}):
            self.student.return_value = value
            self.assertEqual(self.response().status_code, 503)
        self.student.side_effect = DatabaseError('private database details')
        response = self.response()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(b'private database', response.content)
        self.assertEqual(response['Retry-After'], '5')

    def test_browser_assertions_cannot_select_identity(self):
        body = json.loads(self.response('?learner_id=8&aptem_id=&signed=true&version=new').content)
        self.student.assert_called_once_with(7)
        self.assertEqual(body['classification'], 'existing')

    def test_learner_profile_edits_cannot_clear_aptem_id(self):
        from learner_api.mappers import restrict_to_self_writable
        allowed, rejected = restrict_to_self_writable({'phone': '01234', 'aptem_id': '', 'aptemId': None})
        self.assertEqual(allowed, {'phone': '01234'})
        self.assertEqual(set(rejected), {'aptem_id', 'aptemId'})

    def test_required_signature_version_is_used_by_the_repository(self):
        with patch.object(repo, 'query', return_value=[]) as query:
            repo.signatures({'id': 7, 'aptem_id': 42})
        sql, params = query.call_args.args
        self.assertIn('audit_version=%s', sql)
        self.assertIn('review_confirmed IS TRUE', sql)
        self.assertEqual(params, ['42', 'otjh-transition:7', 'old-otjh-transition-v1'])

    @patch.dict('os.environ', {'API_REQUIRE_AUTH': '1'})
    def test_unsigned_record_does_not_block_learning_apis(self):
        from old_otjh.gate import refusal
        for path in ('/learner_api/learner-summary/apprenticeship/7/',
                     '/learner_api/monthly-logs/7/', '/learner_api/metrics/apprenticeship/7/',
                     '/learner_api/student-activity/', '/curriculum_api/curriculum/uploads/test.pdf',
                     '/engagement_api/rewards/'):
            with self.subTest(path=path):
                self.assertIsNone(refusal(path, account()))
        self.summary.assert_not_called()
        for path in ('/login_api/logout/', '/login_api/learner-entry/', '/api/chat/conversations/',
                     '/audit_api/old-otjh/me/summary/'):
            self.assertIsNone(refusal(path, account()))

    def test_signature_service_failure_does_not_block_entry(self):
        self.summary.side_effect = DatabaseError('unreachable signature database')
        self.assertTrue(json.loads(self.response().content)['canAccess'])

    def test_staff_and_admin_do_not_query_learner_records(self):
        for role in ('staff', 'admin'):
            self.user = account(role)
            self.assertEqual(json.loads(self.response().content)['classification'], 'not_applicable')
        self.student.assert_not_called()

    @override_settings(OLD_OTJH_ENABLED=False)
    def test_respects_existing_feature_configuration(self):
        body = json.loads(self.response().content)
        self.assertFalse(body['enabled'])
        self.assertFalse(body['required'])
        self.summary.assert_not_called()

    def test_read_is_private_and_never_cached(self):
        response = self.response()
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(response['Vary'], 'Cookie')

    def test_api_method_is_read_only(self):
        request = RequestFactory().post('/login_api/learner-entry/', {'signed': True})
        request.login_account = self.user
        self.assertEqual(entry.entry_status(request).status_code, 405)
