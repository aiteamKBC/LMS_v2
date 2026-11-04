"""Learner entry reads only id and aptem_id; shared student() is unchanged.

No database or network: repository.query is replaced with a recorder, so the
real entry_learner SQL and the real entry_status view run without a connection.
"""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase, override_settings

from . import entry, repository as repo, service

ENTRY_SQL = 'SELECT id, aptem_id FROM enrolment."Created_users" WHERE id=%s'
STUDENT_SQL = ('SELECT id, "Email" AS email, "Username" AS name, '
               '"Programme" AS programme, aptem_id '
               'FROM enrolment."Created_users" WHERE id=%s')


def learner(kind='apprenticeship', subject_id=7, *, role='learner', subject_type='learner', active=True):
    return SimpleNamespace(id=101, is_active=active, role=role, subject_type=subject_type,
                           subject_id=subject_id, learner_type=kind, email='learner@example.test')


class EntryLearnerQueryTests(SimpleTestCase):
    def test_reads_only_id_and_aptem_id_with_a_bound_parameter(self):
        with patch.object(repo, 'query', return_value=[{'id': 7, 'aptem_id': '42'}]) as query:
            self.assertEqual(repo.entry_learner(7), {'id': 7, 'aptem_id': '42'})
        query.assert_called_once_with(ENTRY_SQL, [7])
        sql = query.call_args.args[0]
        for removed_or_unneeded in ('"Programme"', '"Cohort"', '"Group"', '"Email"', '"Username"', '%s' * 2):
            self.assertNotIn(removed_or_unneeded, sql)

    def test_missing_row_is_none(self):
        with patch.object(repo, 'query', return_value=[]):
            self.assertIsNone(repo.entry_learner(7))

    def test_query_errors_propagate_to_the_caller(self):
        with patch.object(repo, 'query', side_effect=DatabaseError('private details')), \
                self.assertRaises(DatabaseError):
            repo.entry_learner(7)

    def test_shared_student_selector_is_unchanged(self):
        with patch.object(repo, 'query', return_value=[]) as query:
            repo.student(7)
        query.assert_called_once_with(STUDENT_SQL, [7])


@override_settings(OLD_OTJH_ENABLED=True)
class EntryStatusTests(SimpleTestCase):
    def setUp(self):
        self.rows = [{'id': 7, 'aptem_id': '42'}]
        self.query = patch.object(repo, 'query', side_effect=lambda sql, params=(): list(self.rows)).start()
        # Entry must no longer touch the shared selector, whatever it would return.
        self.student = patch.object(repo, 'student', side_effect=AssertionError('entry used student()')).start()
        self.addCleanup(patch.stopall)

    def call(self, account):
        request = RequestFactory().get('/login_api/learner-entry/?learner_id=8&aptem_id=99')
        request.login_account = account
        response = entry.entry_status(request)
        return response, json.loads(response.content)

    def test_both_learner_kinds_are_classified_from_the_entry_row(self):
        for kind in ('apprenticeship', 'commercial'):
            for aptem, expected in (('42', 'existing'), (' 0042 ', 'existing'), (42, 'existing'),
                                    ('', 'new'), ('   ', 'new'), (None, 'new')):
                with self.subTest(kind=kind, aptem=aptem):
                    self.rows = [{'id': 7, 'aptem_id': aptem}]
                    response, body = self.call(learner(kind))
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(body, {'classification': expected, 'enabled': True, 'required': False,
                                            'canAccess': True, 'reviewHref': '/old-otjh/months',
                                            'supportHref': '/messages'})
                    self.assertEqual(response['Cache-Control'], 'private, no-store')
                    self.assertEqual(response['Vary'], 'Cookie')
        # The session's subject id is used; browser query parameters are ignored.
        self.assertTrue(all(call.args == (ENTRY_SQL, [7]) for call in self.query.call_args_list))
        self.student.assert_not_called()

    def test_missing_row_fails_closed_with_retry(self):
        self.rows = []
        response, body = self.call(learner())
        self.assertEqual((response.status_code, body['code']), (503, 'profile_unavailable'))
        self.assertEqual(response['Retry-After'], '5')

    def test_a_row_without_aptem_id_key_fails_closed(self):
        self.rows = [{'id': 7}]
        response, body = self.call(learner())
        self.assertEqual((response.status_code, body['code']), (503, 'profile_unavailable'))

    def test_query_error_is_a_private_503_with_retry(self):
        self.query.side_effect = DatabaseError('column "Programme" does not exist')
        response, body = self.call(learner())
        self.assertEqual((response.status_code, body['code']), (503, 'records_unavailable'))
        self.assertNotIn('Programme', response.content.decode())
        self.assertEqual(response['Retry-After'], '5')

    def test_staff_and_admin_bypass_without_any_learner_query(self):
        for role in ('staff', 'admin'):
            with self.subTest(role=role):
                response, body = self.call(learner(role=role, subject_type='staff'))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(body, {'classification': 'not_applicable', 'required': False, 'canAccess': True})
        self.query.assert_not_called()

    def test_invalid_learner_sessions_are_forbidden_without_a_query(self):
        for account in (learner(subject_type='staff'), learner(active=False)):
            with self.subTest(account=account):
                response, body = self.call(account)
                self.assertEqual((response.status_code, body['code']), (403, 'forbidden'))
                self.assertNotIn('Retry-After', response)
        self.query.assert_not_called()

    @override_settings(OLD_OTJH_ENABLED=False)
    def test_feature_flag_is_still_reported(self):
        _, body = self.call(learner())
        self.assertFalse(body['enabled'])
        self.assertFalse(body['required'])

    def test_non_get_requests_keep_their_guard(self):
        request = RequestFactory().post('/login_api/learner-entry/')
        request.login_account = learner()
        self.assertEqual(entry.entry_status(request).status_code, 405)
        self.query.assert_not_called()


class EntryStateServiceTests(SimpleTestCase):
    def test_entry_state_uses_entry_learner_with_the_session_subject(self):
        with patch.object(repo, 'entry_learner', return_value={'id': 9, 'aptem_id': ''}) as entry_learner, \
                patch.object(repo, 'student') as student, \
                patch.object(service, 'enabled', return_value=True):
            state = entry.entry_state(learner(subject_id=9))
        entry_learner.assert_called_once_with(9)
        student.assert_not_called()
        self.assertEqual(state['classification'], 'new')
